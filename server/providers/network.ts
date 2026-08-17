import { lookup as nodeLookup } from 'node:dns/promises';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type ProviderFetchInit = RequestInit & {
  headers?: ConstructorParameters<typeof Headers>[0];
};

export type ProviderFetch = (
  url: URL,
  init: ProviderFetchInit,
  resolvedAddresses: ResolvedAddress[],
) => Promise<Response>;

export type ProviderBoundaryDependencies = {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
  fetch: ProviderFetch;
  scheduleTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearScheduledTimeout(handle: ReturnType<typeof setTimeout>): void;
};

type UrlValidationMessages = {
  invalid: string;
  protocol: string;
  nonPublic: string;
  unresolved: string;
};

function hasPrefix(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  const remainder = bits % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return ((bytes[fullBytes] ?? 0) & mask) === ((prefix[fullBytes] ?? 0) & mask);
}

function parseIpv4(address: string): Uint8Array | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => /^\d+$/.test(part) ? Number(part) : Number.NaN);
  if (!bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return undefined;
  }
  return Uint8Array.from(bytes);
}

function parseIpv6Part(part: string): number[] | undefined {
  if (!part) return [];
  const pieces = part.split(':');
  const values: number[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.includes('.')) {
      if (index !== pieces.length - 1) return undefined;
      const ipv4 = parseIpv4(piece);
      if (!ipv4) return undefined;
      values.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
      continue;
    }
    if (!/^[\da-f]{1,4}$/i.test(piece)) return undefined;
    values.push(Number.parseInt(piece, 16));
  }
  return values;
}

function parseIpv6(address: string): Uint8Array | undefined {
  const normalized = address.replace(/^\[|\]$/g, '').split('%', 1)[0] ?? '';
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const head = parseIpv6Part(halves[0] ?? '');
  const tail = parseIpv6Part(halves[1] ?? '');
  if (!head || !tail) return undefined;
  let hextets: number[];
  if (halves.length === 1) {
    if (head.length !== 8) return undefined;
    hextets = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return undefined;
    hextets = [...head, ...Array<number>(missing).fill(0), ...tail];
  }
  const bytes = new Uint8Array(16);
  hextets.forEach((value, index) => {
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function isPublicIpv4(address: string): boolean {
  const bytes = parseIpv4(address);
  if (!bytes) return false;
  const blocked: Array<[number[], number]> = [
    [[0], 8],
    [[10], 8],
    [[100, 64], 10],
    [[127], 8],
    [[169, 254], 16],
    [[172, 16], 12],
    [[192, 0, 0], 24],
    [[192, 0, 2], 24],
    [[192, 31, 196], 24],
    [[192, 52, 193], 24],
    [[192, 88, 99], 24],
    [[192, 168], 16],
    [[192, 175, 48], 24],
    [[198, 18], 15],
    [[198, 51, 100], 24],
    [[203, 0, 113], 24],
    [[224], 4],
    [[240], 4],
  ];
  return !blocked.some(([prefix, bits]) => hasPrefix(bytes, prefix, bits));
}

function embeddedIpv4(bytes: Uint8Array): string | undefined {
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  const nat64 = hasPrefix(bytes, [0x00, 0x64, 0xff, 0x9b], 96);
  if (!mapped && !compatible && !nat64) return undefined;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const embedded = embeddedIpv4(bytes);
  if (embedded) return isPublicIpv4(embedded);
  const blocked: Array<[number[], number]> = [
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 128],
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128],
    [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48],
    [[0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 64],
    [[0x20, 0x01, 0x00, 0x00], 32],
    [[0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48],
    [[0x20, 0x01, 0x0d, 0xb8], 32],
    [[0x20, 0x01, 0x00, 0x10], 28],
    [[0x20, 0x01, 0x00, 0x20], 28],
    [[0x20, 0x02], 16],
    [[0x3f, 0xff, 0x00], 20],
    [[0x5f, 0x00], 16],
    [[0xfc], 7],
    [[0xfe, 0x80], 10],
    [[0xfe, 0xc0], 10],
    [[0xff], 8],
  ];
  return !blocked.some(([prefix, bits]) => hasPrefix(bytes, prefix, bits));
}

function isPublicAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').split('%', 1)[0] ?? '';
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

export async function validatePublicHttpUrl(
  rawUrl: string,
  dependencies: ProviderBoundaryDependencies,
  messages: UrlValidationMessages,
  signal?: AbortSignal,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(messages.invalid);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(messages.protocol);
  }
  if (url.username || url.password) throw new Error(messages.invalid);

  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === 'local'
    || hostname.endsWith('.local')
  ) {
    throw new Error(messages.nonPublic);
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicAddress(hostname)) throw new Error(messages.nonPublic);
    return { url, addresses: [{ address: hostname, family: literalFamily }] };
  }

  let addresses: ResolvedAddress[];
  try {
    if (signal?.aborted) throw new Error('Provider request aborted.');
    const resolution = dependencies.resolve(hostname);
    addresses = signal ? await new Promise<ResolvedAddress[]>((resolve, reject) => {
      const abort = () => reject(new Error('Provider request aborted.'));
      signal.addEventListener('abort', abort, { once: true });
      resolution.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    }) : await resolution;
  } catch {
    throw new Error(messages.unresolved);
  }
  if (addresses.length === 0) throw new Error(messages.unresolved);
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error(messages.nonPublic);
  }
  return { url, addresses };
}

export function createBoundarySignal(
  externalSignal: AbortSignal,
  dependencies: ProviderBoundaryDependencies,
  timeoutMs: number,
): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal.aborted) abort();
  else externalSignal.addEventListener('abort', abort, { once: true });
  const timer = dependencies.scheduleTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      dependencies.clearScheduledTimeout(timer);
      externalSignal.removeEventListener('abort', abort);
    },
  };
}

export async function cancelResponse(response: Response, reason?: unknown): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel(reason);
  } catch {
    // Cancellation is best-effort; preserve the provider validation failure.
  }
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await nodeLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap(({ address, family }) => family === 4 || family === 6
    ? [{ address, family }]
    : []);
}

const defaultFetch: ProviderFetch = (url, init, resolvedAddresses) => new Promise((resolve, reject) => {
  const selected = resolvedAddresses[0];
  if (!selected) {
    reject(new Error('No resolved provider address.'));
    return;
  }
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const transport = url.protocol === 'https:' ? requestHttps : requestHttp;
  const request = transport(url, {
    method: init.method ?? 'GET',
    headers,
    signal: init.signal ?? undefined,
    lookup(_hostname, options, callback) {
      if (typeof options === 'object' && options.all) {
        callback(null, resolvedAddresses);
        return;
      }
      callback(null, selected.address, selected.family);
    },
  }, (incoming) => {
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
      else if (value !== undefined) responseHeaders.set(name, value);
    }
    const status = incoming.statusCode ?? 500;
    const emptyBody = status === 204 || status === 205 || status === 304;
    const body = emptyBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    resolve(new Response(body, {
      status,
      statusText: incoming.statusMessage,
      headers: responseHeaders,
    }));
  });
  request.once('error', reject);
  request.end();
});

export const defaultProviderBoundaryDependencies: ProviderBoundaryDependencies = {
  resolve: defaultResolve,
  fetch: defaultFetch,
  scheduleTimeout: setTimeout,
  clearScheduledTimeout: clearTimeout,
};
