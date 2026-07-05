type Resolver = (hostname: string) => string[] | Promise<string[]>;
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ImportImageResult = {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  thumbnailUrl: string;
  imageUrl: string;
  width?: number;
  height?: number;
};

type FetchImportImageInput = {
  imageUrl: string;
  fetcher?: Fetcher;
  resolver?: Resolver;
};

type FetchImportUserInput = {
  supabaseUrl: string;
  apiKey: string;
  authorization: string;
  fetcher?: Fetcher;
};

const allowedProtocols = new Set(["http:", "https:"]);
const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const maxImageBytes = 50 * 1024 * 1024;
const maxRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const userAgent = "WorldTourImageImport/1.0";
const bearerTokenPattern = /^Bearer\s+(.+)$/i;
const defaultFetcher: Fetcher = (input, init) => globalThis.fetch(input, init);
const defaultUuid = () => globalThis.crypto.randomUUID();

export function normalizeImportResult(value: unknown): ImportImageResult {
  if (!isRecord(value)) {
    throw new Error("Choose a valid image result.");
  }

  const result: ImportImageResult = {
    id: stringField(value.id),
    title: stringField(value.title),
    sourceName: stringField(value.sourceName),
    sourceUrl: stringField(value.sourceUrl),
    thumbnailUrl: stringField(value.thumbnailUrl),
    imageUrl: stringField(value.imageUrl),
  };

  const width = numberField(value.width);
  const height = numberField(value.height);
  if (width !== undefined) {
    result.width = width;
  }
  if (height !== undefined) {
    result.height = height;
  }

  if (
    !result.id ||
    !result.title ||
    !result.sourceName ||
    !isHttpUrl(result.sourceUrl) ||
    !isHttpUrl(result.thumbnailUrl) ||
    !isHttpUrl(result.imageUrl)
  ) {
    throw new Error("Choose a valid image result.");
  }

  return result;
}

export function requireBearerJwt(authorization: string) {
  const token = authorization.match(bearerTokenPattern)?.[1]?.trim() ?? "";

  if (!token.startsWith("eyJ")) {
    throw new Error("Sign in before importing images.");
  }

  return token;
}

export async function fetchImportUser({
  supabaseUrl,
  apiKey,
  authorization,
  fetcher = defaultFetcher,
}: FetchImportUserInput) {
  if (!supabaseUrl || !apiKey) {
    throw new Error("Sign in before importing images.");
  }

  let response: Response;
  try {
    response = await fetcher(new URL("/auth/v1/user", supabaseUrl), {
      headers: {
        apikey: apiKey,
        authorization,
      },
    });
  } catch {
    throw new Error("Sign in before importing images.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Sign in before importing images.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Sign in before importing images.");
  }

  if (!response.ok || !isRecord(body) || typeof body.id !== "string" || !body.id) {
    throw new Error("Sign in before importing images.");
  }

  return { id: body.id };
}

export async function validatePublicImageUrl(
  rawUrl: string,
  resolver: Resolver = resolveHostname,
) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid image URL.");
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error("Image URLs must use http or https.");
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    throw new Error("Enter a public image URL.");
  }

  if (shouldResolveHostname(parsed.hostname)) {
    const resolvedAddresses = await resolver(parsed.hostname);
    if (resolvedAddresses.length === 0) {
      throw new Error("Unable to resolve image URL host.");
    }

    if (resolvedAddresses.some((address) => isLocalOrPrivateHost(address))) {
      throw new Error("Enter a public image URL.");
    }
  }

  return parsed.toString();
}

export async function fetchImportImage({
  imageUrl,
  fetcher = defaultFetcher,
  resolver = resolveHostname,
}: FetchImportImageInput) {
  const response = await fetchImportImageResponse(imageUrl, fetcher, resolver);

  if (!response.ok) {
    throw new Error("Unable to fetch image.");
  }

  const contentType =
    response.headers.get("content-type")?.split(";", 1)[0].trim()
      .toLowerCase() ?? "";
  if (!allowedImageTypes.has(contentType)) {
    throw new Error("Selected result did not return a supported image.");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
    throw new Error("Selected image is too large.");
  }

  const bytes = await readResponseBodyUpTo(response, maxImageBytes);
  if (bytes.byteLength === 0) {
    throw new Error("Selected image was empty.");
  }

  return { bytes, contentType };
}

async function fetchImportImageResponse(
  initialUrl: string,
  fetcher: Fetcher,
  resolver: Resolver,
) {
  let currentUrl = initialUrl;

  for (
    let redirectCount = 0;
    redirectCount <= maxRedirects;
    redirectCount += 1
  ) {
    // Deno fetch does not let us pin DNS results to the connection, so this
    // narrows rebinding exposure by resolving at the last application boundary.
    const safeUrl = await validatePublicImageUrl(currentUrl, resolver);
    const response = await fetcher(safeUrl, {
      headers: {
        accept:
          "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8",
        "User-Agent": userAgent,
      },
      redirect: "manual",
    });

    if (!redirectStatuses.has(response.status)) {
      return response;
    }

    if (redirectCount >= maxRedirects) {
      throw new Error("Too many redirects while fetching image.");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Redirect response is missing a Location header.");
    }

    currentUrl = new URL(location, safeUrl).toString();
  }

  throw new Error("Too many redirects while fetching image.");
}

async function readResponseBodyUpTo(response: Response, maxBytes: number) {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("Selected image is too large.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export function createImportedImageObjectPath(input: {
  tripId: string;
  destinationId: string;
  activityId?: string;
  title: string;
  contentType: string;
  uuid?: () => string;
}) {
  const uuid = input.uuid ?? defaultUuid;
  const extension = extensionForContentType(input.contentType);
  const slug = slugify(input.title);
  const ownerPath = input.activityId ? `${input.destinationId}/${input.activityId}` : input.destinationId;

  return `${input.tripId}/${ownerPath}/${uuid()}-${slug}.${extension}`;
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return allowedProtocols.has(parsed.protocol);
  } catch {
    return false;
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "web-image";
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

async function resolveHostname(hostname: string) {
  const lookups = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  if (addresses.length === 0) {
    throw new Error("Unable to resolve image URL host.");
  }

  return addresses;
}

function isLocalOrPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const unbracketed = normalized.replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (isPrivateIpv4(unbracketed)) {
    return true;
  }

  return isPrivateIpv6(unbracketed);
}

function shouldResolveHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const unbracketed = normalized.replace(/^\[|\]$/g, "");

  return (
    normalized !== "localhost" &&
    !normalized.endsWith(".localhost") &&
    !isIpv4Literal(unbracketed) &&
    !unbracketed.includes(":")
  );
}

function isIpv4Literal(hostname: string) {
  return parseIpv4Octets(hostname) !== undefined;
}

function isPrivateIpv4(hostname: string) {
  const octets = parseIpv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 0 && octets[2] === 0) ||
    (first === 192 && second === 0 && octets[2] === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    (first >= 224 && first <= 239) ||
    first >= 240
  );
}

function parseIpv4Octets(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }

    return Number(part);
  });

  return octets.every((octet) =>
      Number.isInteger(octet) && octet >= 0 && octet <= 255
    )
    ? octets
    : undefined;
}

function isPrivateIpv6(hostname: string) {
  if (!hostname.includes(":")) {
    return false;
  }

  const hextets = parseIpv6Hextets(hostname);
  if (!hextets) {
    return false;
  }

  const [first = 0] = hextets;
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) &&
    hextets[7] === 1;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isSiteLocal = (first & 0xffc0) === 0xfec0;
  const isMulticast = (first & 0xff00) === 0xff00;
  const isDocumentation = first === 0x2001 && hextets[1] === 0x0db8;

  if (
    isUnspecified ||
    isLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    isSiteLocal ||
    isMulticast ||
    isDocumentation
  ) {
    return true;
  }

  const embeddedIpv4 = getIpv4MappedAddress(hextets) ||
    getIpv4CompatibleAddress(hextets);
  return embeddedIpv4 ? isPrivateIpv4(embeddedIpv4) : false;
}

function parseIpv6Hextets(hostname: string) {
  const halves = hostname.split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const head = parseIpv6Part(halves[0] || "");
  const tail = parseIpv6Part(halves[1] || "");
  if (!head || !tail) {
    return undefined;
  }

  if (halves.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  const missingCount = 8 - head.length - tail.length;
  if (missingCount < 1) {
    return undefined;
  }

  return [...head, ...Array(missingCount).fill(0), ...tail];
}

function parseIpv6Part(part: string) {
  if (!part) {
    return [];
  }

  const pieces = part.split(":");
  const hextets: number[] = [];

  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      if (index !== pieces.length - 1) {
        return undefined;
      }

      const ipv4Hextets = parseEmbeddedIpv4Hextets(piece);
      if (!ipv4Hextets) {
        return undefined;
      }

      hextets.push(...ipv4Hextets);
      continue;
    }

    if (!/^[\da-f]{1,4}$/i.test(piece)) {
      return undefined;
    }

    hextets.push(Number.parseInt(piece, 16));
  }

  return hextets;
}

function parseEmbeddedIpv4Hextets(hostname: string) {
  const octets = parseIpv4Octets(hostname);
  if (!octets) {
    return undefined;
  }

  return [
    ((octets[0] ?? 0) << 8) | (octets[1] ?? 0),
    ((octets[2] ?? 0) << 8) | (octets[3] ?? 0),
  ];
}

function getIpv4MappedAddress(hextets: number[]) {
  const isMapped = hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff;
  if (!isMapped) {
    return undefined;
  }

  const high = hextets[6] ?? 0;
  const low = hextets[7] ?? 0;
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
}

function getIpv4CompatibleAddress(hextets: number[]) {
  const isCompatible = hextets.slice(0, 6).every((hextet) => hextet === 0);
  if (!isCompatible) {
    return undefined;
  }

  const high = hextets[6] ?? 0;
  const low = hextets[7] ?? 0;
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
}
