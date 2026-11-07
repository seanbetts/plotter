import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { requireMacWriterAuthority } from './writerAuthority';
import { parseServiceArguments, resolveRequestedDataDirectory } from './args';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root,{recursive:true,force:true})));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'plotter-writer-authority-')));
  roots.push(root);
  writeFileSync(join(root,'local-web.json'),JSON.stringify({id:'plotter'}));
  return { root, options:{port:43123,dataDir:join(root,'user-data')} };
}
const mac = {schemaVersion:1,appId:'plotter',targetKind:'macos',baseUrl:'https://local.example.ts.net/plotter',profileRevision:'a'.repeat(64)};
it('permits only current Mac authority before a production state directory exists', () => {
  const {root,options}=fixture();
  const lookup=vi.fn(() => mac);
  requireMacWriterAuthority(options,root,lookup);
  expect(lookup).toHaveBeenCalledWith(root);
  for (const load of [() => ({...mac,targetKind:'nas-docker'}),() => {throw Error('unavailable');},() => ({...mac,appId:'other'})]) {
    expect(() => requireMacWriterAuthority(options,root,load)).toThrow('Mac production writer authority is unavailable');
  }
});
it('does not mistake explicit disposable state for production and never queries Mac metadata in NAS mode', () => {
  const {root,options}=fixture();
  const lookup=vi.fn(() => {throw Error('must not query');});
  requireMacWriterAuthority({...options,dataDir:join(root,'tests','.tmp','copy')},root,lookup);
  requireMacWriterAuthority({...options,dataDir:'/state',runtime:'nas-docker'},root,lookup);
  expect(lookup).not.toHaveBeenCalled();
});
it('protects descendant state and aliases of canonical production state', () => {
  const {root,options}=fixture();
  mkdirSync(options.dataDir);
  const alias=join(root,'copy-alias');symlinkSync(options.dataDir,alias);
  const load=() => ({...mac,targetKind:'nas-docker'});
  expect(() => requireMacWriterAuthority({...options,dataDir:alias},root,load)).toThrow();
  expect(() => requireMacWriterAuthority({...options,dataDir:join(alias,'nested')},root,load)).toThrow();
});

it('derives source authority from selected production state instead of an env-file parent or relocated module root', () => {
  const {root,options}=fixture();mkdirSync(options.dataDir);
  const load=vi.fn(() => ({...mac,targetKind:'nas-docker'}));
  expect(() => requireMacWriterAuthority(options,options.dataDir,load)).toThrow();
  expect(load).toHaveBeenCalledWith(root);
});

it('protects a lexically selected production root that links outward even with a different env-file root', () => {
  const {root,options}=fixture();
  const outside=realpathSync(mkdtempSync(join(tmpdir(),'plotter-outward-copy-')));roots.push(outside);
  symlinkSync(outside,options.dataDir);
  for(const selected of [options.dataDir,join(options.dataDir,'nested')]) {
    const load=vi.fn(() => ({...mac,targetKind:'nas-docker'}));
    expect(() => requireMacWriterAuthority({...options,dataDir:selected},outside,load)).toThrow();
    expect(load).toHaveBeenCalledWith(root);
  }
});

it('uses Git ownership and committed target metadata when the working manifest is missing', () => {
  const {root,options}=fixture();rmSync(join(root,'local-web.json'));mkdirSync(join(root,'.git'));mkdirSync(options.dataDir);
  const alias=join(root,'alias');symlinkSync(options.dataDir,alias);
  for(const selected of [options.dataDir,alias,join(alias,'nested')]) {
    const load=vi.fn(() => ({...mac,targetKind:'nas-docker'}));
    expect(() => requireMacWriterAuthority({...options,dataDir:selected},options.dataDir,load)).toThrow();
    expect(load).toHaveBeenCalledWith(root);
    requireMacWriterAuthority({...options,dataDir:selected},options.dataDir,() => mac);
  }
});

it('retains requested production identity after parser canonicalization through an outward link', () => {
  const {root,options}=fixture();
  const outside=realpathSync(mkdtempSync(join(tmpdir(),'plotter-parser-outward-')));roots.push(outside);
  symlinkSync(outside,options.dataDir);
  const argv=['--port','43123','--data-dir',options.dataDir,'--env-file',join(outside,'.env')];
  const parsed=parseServiceArguments(argv,outside);
  expect(parsed.dataDir).toBe(outside);
  const load=vi.fn(() => ({...mac,targetKind:'nas-docker'}));
  expect(() => requireMacWriterAuthority({...parsed,dataDir:resolveRequestedDataDirectory(argv,outside)},outside,load)).toThrow();
  expect(load).toHaveBeenCalledWith(root);
});
