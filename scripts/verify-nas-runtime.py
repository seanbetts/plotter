#!/usr/bin/env python3
"""Synthetic Linux acceptance in the existing guarded no-host-mount Mac VM only.

No NAS, real app store, provider key, host bind or published web port is used.
The supplied old bundle is a disposable build of the prior committed source.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import uuid

IMAGE = 'node@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9'
PROBE = r'''
import {request} from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base = process.argv[2], phase = process.argv[3];
const common = {host:'plotter.fixture.ts.net','x-forwarded-proto':'https',origin:'https://plotter.fixture.ts.net'};
async function call(path,method='GET',body,extra={}) {
 let bytes,headers={...common,...extra};
 if(body instanceof FormData) {const encoded=new Response(body);bytes=Buffer.from(await encoded.arrayBuffer());headers['content-type']=encoded.headers.get('content-type');}
 else if(body!==undefined){bytes=Buffer.from(JSON.stringify(body));headers['content-type']='application/json';}
 if(method!=='GET'&&method!=='HEAD'){headers['x-plotter-write']='1';headers['content-type']??='application/json';}
 if(bytes)headers['content-length']=String(bytes.length);
 return await new Promise((resolve,reject)=>{const req=request(base+path,{method,headers,timeout:5000},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const bytes=Buffer.concat(chunks);let data;try{data=JSON.parse(bytes)}catch{}resolve({status:res.statusCode,data,bytes})});});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('timeout')));req.end(bytes);});
}
let ready=phase==='spoof';for(let i=0;!ready&&i<80;i++){try{if((await call('/healthz')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'service readiness');
if(phase==='spoof'){assert.equal((await call('/api/v1/trips')).status,403);console.log(JSON.stringify({untrustedProxyRejected:true}));process.exit(0);}
const hash=v=>createHash('sha256').update(v).digest('hex');
if(phase==='new') {
 assert.equal((await call('/api/v1/trips','POST',{expectedRevision:0,name:'forbidden'},{origin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/v1/trips','GET',undefined,{'x-forwarded-proto':'http'})).status,403);
 const created=await call('/api/v1/trips','POST',{expectedRevision:0,name:'Synthetic NAS trip'});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.trip.id;
 const destination={id:'destination-fixture',name:'Synthetic stop',countryRegion:'Fixture',coordinates:{lat:59.9,lng:10.7},routingAnchors:{},location:{placeName:'Fixture',regionName:'Fixture',countryName:'Fixture',countryCode:'NO',sourceLabel:'Fixture',sourceProvider:'maptiler'},order:0,status:'planned',priority:'high',timing:{idealMonths:['March'],expectedStayDays:2,provisionalStartDate:'',provisionalEndDate:''},why:{summary:'',highlights:'',personalRationale:''},media:[],research:{notes:'',links:[],bookReferences:[]},activities:{items:[]},routeContext:{previousNextNotes:'',drivingNotes:'',borderShippingNotes:'',notes:''},tags:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
 assert.equal((await call(`/api/v1/trips/${id}/mutations`,'POST',{expectedRevision:0,mutation:{type:'save-destination',destination}})).status,200);
 const form=new FormData();form.set('expectedRevision','1');form.set('file',new File(['synthetic media bytes'],'fixture.png',{type:'image/png'}));
 const uploaded=await call(`/api/v1/trips/${id}/destinations/${destination.id}/media`,'POST',form);assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));
 const mediaId=uploaded.data.mediaItem.id;
 assert.equal((await call(`/api/v1/media/${mediaId}/content`)).bytes.toString(),'synthetic media bytes');
 const backupResponse=await call('/api/v1/backups','POST');assert.equal(backupResponse.status,201,JSON.stringify(backupResponse.data));const backup=backupResponse.data.backup;
 assert.equal((await call(`/api/v1/backups/${backup.id}`)).status,200);
 assert.equal((await call(`/api/v1/trips/${id}`,'PATCH',{expectedRevision:1,patch:{name:'temporary before restore'}})).status,200);
 assert.equal((await call(`/api/v1/backups/${backup.id}/restore`,'POST',{confirmation:`RESTORE ${backup.id}`})).status,200);
 const directory=(await call('/api/v1/trips')).data;
 assert.equal((await call(`/api/v1/trips/${id}`,'PATCH',{expectedRevision:directory.revision,patch:{name:'NAS latest retained'}})).status,200);
 assert.equal((await call('/api/v1/trips','POST',{expectedRevision:0,name:'stale revision'})).status,409);
}
const directory=(await call('/api/v1/trips')).data;assert.equal(directory.trips[0].name,'NAS latest retained');
const id=directory.trips[0].id,context=await call(`/api/v1/trips/${id}/context`);assert.equal(context.status,200);
assert.equal(context.data.destinations.length,1);
const media=(await call(`/api/v1/trips/${id}/destinations/destination-fixture/media`)).data.mediaItems;assert.equal(media.length,1);
const content=await call(`/api/v1/media/${media[0].id}/content`);assert.equal(content.bytes.toString(),'synthetic media bytes');
assert((await call('/api/v1/backups')).data.backups.length>=1);
console.log(JSON.stringify({phase,contextSha256:hash(context.bytes),mediaSha256:hash(content.bytes),backupRestore:true,postWriteRetention:true}));
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-harness', type=Path, required=True)
    parser.add_argument('--old-service', type=Path, required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('nas_fixture_guard', args.fixture_harness.resolve(strict=True))
    guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
    docker, environment = guard.fixture_runtime()
    if docker != ['docker', '--context', 'colima-nas-media-worker-test']:
        raise ValueError('Only the existing guarded fixture context is supported')
    root = Path(__file__).resolve().parents[1]
    new = root / 'server-dist/service.mjs'; old = args.old_service.resolve(strict=True)
    if not new.is_file() or not old.is_file(): raise ValueError('Build both synthetic service bundles first')
    prefix = 'plotter-fixture-' + uuid.uuid4().hex[:12]
    names = {key: prefix + '-' + key for key in ('seed', 'new', 'old', 'network', 'code', 'state', 'secrets', 'return')}
    def run(*arguments, check=True):
        result = subprocess.run([*docker, *arguments], env=environment, capture_output=True, text=True,
                                check=False, timeout=120)
        if check and result.returncode:
            raise RuntimeError('Synthetic fixture command failed: ' + (result.stdout + result.stderr)[-4000:])
        return (result.stdout + (result.stderr if arguments[0] == 'logs' else '')).strip()
    containers, volumes, network = [], [], False
    try:
        # Docker rejects overlapping existing subnets; no existing network is changed.
        subnet = None
        for octet in (245, 246, 247):
            try:
                run('network', 'create', '--internal', '--subnet', f'172.31.{octet}.0/24', names['network'])
                subnet = f'172.31.{octet}'; network = True; break
            except subprocess.CalledProcessError: pass
        if subnet is None: raise ValueError('No selected fixture subnet is available')
        proxy, app = subnet + '.2', subnet + '.3'
        for key in ('code', 'state', 'secrets', 'return'):
            run('volume', 'create', names[key]); volumes.append(names[key])
        mounts = sum((['--mount', f'type=volume,src={names[key]},dst=/{key}'] for key in ('code','state','secrets','return')), [])
        run('run', '-d', '--name', names['seed'], '--platform', 'linux/amd64', '--network', 'none',
            '--read-only', *mounts, '--entrypoint', 'node', IMAGE, '-e', 'setInterval(()=>{},1000)')
        containers.append(names['seed'])
        run('exec', names['seed'], 'node', '-e',
            'const f=require("fs"); for(const p of ["/code/new/server","/code/new/public","/code/old/server","/code/old/user-data"]){f.mkdirSync(p,{recursive:true});f.chmodSync(p,0o755)} f.symlinkSync("new","/code/current");f.writeFileSync("/code/old/.env","");f.chmodSync("/code/old/.env",0o644);f.writeFileSync("/secrets/plotter.env","");f.chmodSync("/secrets/plotter.env",0o400); for(const p of ["/state","/return","/secrets","/secrets/plotter.env"])f.chownSync(p,10001,10001);f.chmodSync("/state",0o700);f.chmodSync("/secrets",0o700)')
        with tempfile.TemporaryDirectory(prefix='plotter-fixture-probe-') as temporary:
            probe = Path(temporary) / 'probe.mjs'; probe.write_text(PROBE)
            run('cp', str(new), names['seed'] + ':/code/new/server/service.mjs')
            run('cp', str(old), names['seed'] + ':/code/old/server/service.mjs')
            run('cp', str(probe), names['seed'] + ':/code/probe.mjs')
        common = ['--platform','linux/amd64','--read-only','--user','10001:10001','--cap-drop','ALL',
                  '--security-opt','no-new-privileges:true','--cpus','1','--memory','512m','--tmpfs','/tmp:rw,nosuid,nodev']
        run('run','-d','--name',names['new'],*common,'--network',names['network'],'--ip',app,
            '--mount',f'type=volume,src={names["code"]},dst=/app,readonly',
            '--mount',f'type=volume,src={names["state"]},dst=/state',
            '--mount',f'type=volume,src={names["secrets"]},dst=/run/secrets,readonly',
            '--entrypoint','node',IMAGE,'/app/current/server/service.mjs','--runtime','nas-docker','--port','4174',
            '--data-dir','/state','--env-file','/run/secrets/plotter.env','--bind-host','0.0.0.0',
            '--public-origin','https://plotter.fixture.ts.net','--proxy-address',proxy)
        containers.append(names['new'])
        def probe(phase, address, ip):
            return json.loads(run('run','--rm',*common,'--network',names['network'],'--ip',ip,
                '--mount',f'type=volume,src={names["code"]},dst=/app,readonly',
                '--entrypoint','node',IMAGE,'/app/probe.mjs',address,phase))
        fresh = probe('new',f'http://{app}:4174',proxy)
        # Reuse the already-ready new service; a different bridge peer cannot spoof Caddy.
        spoof = probe('spoof',f'http://{app}:4174',subnet+'.4')
        run('stop','--time','10',names['new'])
        run('exec',names['seed'],'node','-e',
            'const f=require("fs"),p=require("path");f.cpSync("/state","/return",{recursive:true});function own(x){f.chownSync(x,10001,10001);if(f.statSync(x).isDirectory())for(const n of f.readdirSync(x))own(p.join(x,n))}own("/return")')
        run('run','-d','--name',names['old'],*common,'--network','none',
            '--mount',f'type=volume,src={names["code"]},dst=/app,readonly',
            '--mount',f'type=volume,src={names["return"]},dst=/app/old/user-data',
            '--entrypoint','node',IMAGE,'/app/old/server/service.mjs','--port','4174',
            '--data-dir','/app/old/user-data','--env-file','/app/old/.env')
        containers.append(names['old'])
        previous = json.loads(run('exec',names['old'],'node','/app/probe.mjs','http://127.0.0.1:4174','old'))
        if any(fresh[key] != previous[key] for key in ('contextSha256','mediaSha256')):
            raise ValueError('Old code did not retain the latest NAS fixture data/media')
        # Repatriate only this fenced synthetic store, and read it with the
        # previous code on the native Mac runtime as well as Linux.
        run('stop','--time','10',names['old'])
        with tempfile.TemporaryDirectory(prefix='plotter-return-copy-') as temporary:
            local = Path(temporary).resolve()
            (local / 'server').mkdir(); (local / 'user-data').mkdir(mode=0o700)
            (local / 'server/service.mjs').write_bytes(old.read_bytes())
            (local / '.env').write_text(''); (local / '.env').chmod(0o600)
            (local / 'probe.mjs').write_text(PROBE)
            run('cp', names['seed'] + ':/return/.', str(local / 'user-data'))
            with socket.socket() as selected:
                selected.bind(('127.0.0.1', 0)); port = selected.getsockname()[1]
            node = shutil.which('node')
            if not node: raise ValueError('Native Node is required for the return-copy fixture')
            child_environment = dict(PATH=os.environ.get('PATH', ''), HOME=str(local), LANG='C', LC_ALL='C')
            child = subprocess.Popen([node, str(local / 'server/service.mjs'), '--port', str(port),
                '--data-dir', str(local / 'user-data'), '--env-file', str(local / '.env')],
                cwd=local, env=child_environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                result = subprocess.run([node, str(local / 'probe.mjs'), f'http://127.0.0.1:{port}', 'old'],
                    cwd=local, env=child_environment, capture_output=True, text=True, timeout=30, check=True)
                native_previous = json.loads(result.stdout)
            finally:
                child.terminate()
                try: child.communicate(timeout=10)
                except subprocess.TimeoutExpired: child.kill(); child.communicate(timeout=5)
            if any(fresh[key] != native_previous[key] for key in ('contextSha256','mediaSha256')):
                raise ValueError('The native previous code did not preserve the return-copy state/media')
        print(json.dumps(dict(linuxRuntime=True, noHostMounts=True, noPublishedPorts=True,
                              copiedPostWriteState=True, fresh=fresh, previous=previous,
                              nativeMacPrevious=native_previous, **spoof), sort_keys=True))
    except Exception:
        for app in ('new', 'old'):
            if names[app] in containers:
                print(app + ': ' + run('logs', names[app], check=False)[-4000:], file=__import__('sys').stderr)
        raise
    finally:
        for name in reversed(containers): run('rm','-f',name,check=False)
        if network: run('network','rm',names['network'],check=False)
        for name in reversed(volumes): run('volume','rm',name,check=False)


if __name__ == '__main__': main()
