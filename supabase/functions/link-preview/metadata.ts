export type LinkPreviewResponse = {
  url: string;
  title: string;
  domain: string;
  imageUrl?: string;
};

type PreviewFromHtmlInput = {
  requestedUrl: string;
  finalUrl: string;
  html: string;
};

const allowedProtocols = new Set(["http:", "https:"]);
const maxPreviewBytes = 512_000;
const maxRedirects = 3;
const previewTimeoutMs = 5_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const userAgent = "WorldTourLinkPreview/1.0";

export function normalizePreviewUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Enter a URL.");
  }

  const withScheme = /^[a-z][a-z\d+\-.]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Enter a valid URL.");
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error("Links must use http or https.");
  }

  return parsed.toString();
}

export function validatePublicPreviewUrl(rawUrl: string) {
  const previewUrl = normalizePreviewUrl(rawUrl);
  const parsed = new URL(previewUrl);

  if (isLocalOrPrivateHost(parsed.hostname)) {
    throw new Error("Enter a public URL.");
  }

  return previewUrl;
}

export function createPreviewFromHtml({
  requestedUrl,
  finalUrl,
  html,
}: PreviewFromHtmlInput): LinkPreviewResponse {
  const normalizedFinalUrl = normalizePreviewUrl(finalUrl || requestedUrl);
  const domain = deriveDomain(normalizedFinalUrl);
  const title = getMetaContent(html, ["og:title"]) ||
    getMetaContent(html, ["twitter:title"]) ||
    getDocumentTitle(html) ||
    domain;
  const rawImageUrl = getMetaContent(html, ["og:image"]) ||
    getMetaContent(html, ["twitter:image"]);
  const imageUrl = rawImageUrl
    ? resolveHttpUrl(rawImageUrl, normalizedFinalUrl)
    : undefined;

  return {
    url: normalizedFinalUrl,
    title,
    domain,
    imageUrl,
  };
}

export async function fetchLinkPreview(
  rawUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const previewUrl = validatePublicPreviewUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), previewTimeoutMs);

  try {
    const { response, finalUrl } = await fetchPreviewResponse(
      previewUrl,
      fetcher,
      controller.signal,
    );

    if (!response.ok) {
      throw new Error("Unable to fetch link preview.");
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ||
      "";
    if (!isHtmlContentType(contentType)) {
      throw new Error("URL returned a non-HTML response.");
    }

    const html = await readPreviewHtml(response);
    return createPreviewFromHtml({ requestedUrl: previewUrl, finalUrl, html });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPreviewResponse(
  initialUrl: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  let currentUrl = initialUrl;

  for (
    let redirectCount = 0;
    redirectCount <= maxRedirects;
    redirectCount += 1
  ) {
    const response = await fetcher(currentUrl, {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "User-Agent": userAgent,
      },
      redirect: "manual",
      signal,
    });

    if (!redirectStatuses.has(response.status)) {
      return { response, finalUrl: response.url || currentUrl };
    }

    if (redirectCount >= maxRedirects) {
      throw new Error("Too many redirects while fetching link preview.");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Redirect response is missing a Location header.");
    }

    currentUrl = validatePublicPreviewUrl(
      new URL(location, currentUrl).toString(),
    );
  }

  throw new Error("Too many redirects while fetching link preview.");
}

function deriveDomain(url: string) {
  return new URL(url).hostname.replace(/^www\./i, "");
}

function isHtmlContentType(contentType: string) {
  const mimeType = contentType.split(";", 1)[0].trim();
  return mimeType === "text/html" || mimeType === "application/xhtml+xml";
}

async function readPreviewHtml(response: Response) {
  if (!response.body) {
    return (await response.text()).slice(0, maxPreviewBytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < maxPreviewBytes) {
      const { value, done } = await reader.read();
      if (done || !value) {
        break;
      }

      const remainingBytes = maxPreviewBytes - totalBytes;
      const chunk = value.byteLength > remainingBytes
        ? value.slice(0, remainingBytes)
        : value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;

      if (totalBytes >= maxPreviewBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
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

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }

    return Number(part);
  });

  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168)
  );
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

  if (isUnspecified || isLoopback || isUniqueLocal || isLinkLocal) {
    return true;
  }

  const mappedIpv4 = getIpv4MappedAddress(hextets);
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function parseIpv6Hextets(hostname: string) {
  if (hostname.includes(".")) {
    return undefined;
  }

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

  const hextets = part.split(":").map((piece) => {
    if (!/^[\da-f]{1,4}$/i.test(piece)) {
      return Number.NaN;
    }

    return Number.parseInt(piece, 16);
  });

  return hextets.every((hextet) => Number.isInteger(hextet))
    ? hextets
    : undefined;
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

function getMetaContent(html: string, names: string[]) {
  const requestedNames = new Set(names.map((name) => name.toLowerCase()));

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const metaName =
      (attributes.get("property") || attributes.get("name") || "")
        .toLowerCase();
    const content = attributes.get("content");

    if (content && requestedNames.has(metaName)) {
      const cleaned = cleanText(content);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return undefined;
}

function parseAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const attributePattern =
    /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const match of tag.matchAll(attributePattern)) {
    const [, name, doubleQuotedValue, singleQuotedValue, bareValue] = match;
    if (name) {
      attributes.set(
        name.toLowerCase(),
        doubleQuotedValue ?? singleQuotedValue ?? bareValue ?? "",
      );
    }
  }

  return attributes;
}

function getDocumentTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? cleanText(match[1].replace(/<[^>]+>/g, "")) : undefined;
}

function cleanText(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value.replace(
    /&(#\d+|#x[\da-f]+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return decodeCodePoint(Number.parseInt(body.slice(2), 16), entity);
      }

      if (body.startsWith("#")) {
        return decodeCodePoint(Number.parseInt(body.slice(1), 10), entity);
      }

      return namedEntities[body.toLowerCase()] ?? entity;
    },
  );
}

function decodeCodePoint(codePoint: number, fallback: string) {
  if (!Number.isFinite(codePoint)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function resolveHttpUrl(rawUrl: string, baseUrl: string) {
  try {
    const resolved = new URL(rawUrl, baseUrl);
    return allowedProtocols.has(resolved.protocol)
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
