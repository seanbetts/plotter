import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { acceptsIngress, validateIngress } from './nasIngress';

const policy = { publicOrigin: 'https://plotter.example.ts.net', proxyAddress: '172.30.200.2' };
function request(headers: Record<string, string | undefined>, address = policy.proxyAddress) {
  return { headers, socket: { remoteAddress: address } } as unknown as IncomingMessage;
}

describe('NAS ingress', () => {
  it('accepts exact canonical HTTPS forwarded by the selected proxy', () => {
    expect(acceptsIngress(request({ host: 'plotter.example.ts.net', 'x-forwarded-proto': 'https' }), policy)).toBe(true);
    expect(acceptsIngress(request({ host: 'plotter.example.ts.net', 'x-forwarded-proto': 'https', origin: policy.publicOrigin }), policy)).toBe(true);
  });
  it('rejects spoofed scheme, wrong Host and cross-origin mutations', () => {
    for (const headers of [
      { host: 'wrong.example', 'x-forwarded-proto': 'https' },
      { host: 'plotter.example.ts.net', 'x-forwarded-proto': 'http' },
      { host: 'plotter.example.ts.net', 'x-forwarded-proto': 'https, http' },
      { host: 'plotter.example.ts.net', 'x-forwarded-proto': 'https', origin: 'https://evil.example' },
    ]) expect(acceptsIngress(request(headers), policy)).toBe(false);
    expect(acceptsIngress(request({ host: 'plotter.example.ts.net', 'x-forwarded-proto': 'https' }, '172.30.200.9'), policy)).toBe(false);
    expect(acceptsIngress(request({ host: 'plotter.example.ts.net', 'x-forwarded-proto': 'https' }, '127.0.0.1'), policy)).toBe(false);
  });
  it('keeps the existing Mac handler defaults when no NAS policy is supplied', () => {
    expect(acceptsIngress(request({ host: 'localhost:5175' }, '127.0.0.1'))).toBe(true);
  });
  it('requires a canonical HTTPS origin and one explicit proxy address', () => {
    expect(validateIngress(policy.publicOrigin, policy.proxyAddress)).toEqual(policy);
    for (const origin of ['http://plotter.example', 'https://plotter.example/', 'https://user:secret@plotter.example']) {
      expect(() => validateIngress(origin, policy.proxyAddress)).toThrow();
    }
    expect(() => validateIngress(policy.publicOrigin, 'localhost')).toThrow();
  });
});
