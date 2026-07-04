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
const previewTimeoutMs = 5_000;

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
    const response = await fetcher(previewUrl, {
      headers: {
        accept: "text/html, application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const finalUrl = response.url || previewUrl;

    if (response.url) {
      validatePublicPreviewUrl(response.url);
    }

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

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (isPrivateIpv4(normalized)) {
    return true;
  }

  return isIpv6Loopback(normalized);
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

function isIpv6Loopback(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
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
