import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export type IngressPolicy = { publicOrigin: string; proxyAddress: string };

export function validateIngress(publicOrigin: string | undefined, proxyAddress: string | undefined): IngressPolicy {
  if (!publicOrigin || !proxyAddress || isIP(proxyAddress) !== 4) throw new Error('Invalid NAS ingress configuration.');
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password) {
    throw new Error('Invalid NAS ingress configuration.');
  }
  return { publicOrigin, proxyAddress };
}

export function acceptsIngress(request: IncomingMessage, policy?: IngressPolicy): boolean {
  if (!policy) return true;
  const address = request.socket.remoteAddress?.replace(/^::ffff:/, '');
  if (address !== policy.proxyAddress || request.headers['x-forwarded-proto'] !== 'https'
      || request.headers.host !== new URL(policy.publicOrigin).host) return false;
  // Node CLI callers have no Origin; browser requests must retain exact origin.
  const origin = request.headers.origin;
  return origin === undefined || origin === policy.publicOrigin;
}
