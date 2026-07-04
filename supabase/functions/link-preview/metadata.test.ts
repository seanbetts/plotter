// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPreviewFromHtml,
  fetchLinkPreview,
  normalizePreviewUrl,
  validatePublicPreviewUrl,
} from "./metadata.ts";

Deno.test("normalizes URLs and rejects unsupported protocols", async () => {
  assertEquals(
    normalizePreviewUrl("example.com/menu"),
    "https://example.com/menu",
  );
  assertEquals(
    normalizePreviewUrl(" http://example.com/a b "),
    "http://example.com/a%20b",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        normalizePreviewUrl("ftp://example.com/file")
      ),
    Error,
    "http or https",
  );
});

Deno.test("rejects private and local targets", async () => {
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        validatePublicPreviewUrl("http://localhost:5173")
      ),
    Error,
    "public URL",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        validatePublicPreviewUrl("http://127.0.0.1:5173")
      ),
    Error,
    "public URL",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        validatePublicPreviewUrl("http://192.168.1.10/page")
      ),
    Error,
    "public URL",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        validatePublicPreviewUrl("http://169.254.1.2/page")
      ),
    Error,
    "public URL",
  );
});

Deno.test("extracts Open Graph preview data before other metadata", async () => {
  const preview = await createPreviewFromHtml({
    requestedUrl: "example.com/page",
    finalUrl: "https://example.com/page",
    html: `
      <html>
        <head>
          <title>Document title</title>
          <meta name="twitter:title" content="Twitter title">
          <meta name="twitter:image" content="/twitter.jpg">
          <meta property="og:title" content="OG title">
          <meta property="og:image" content="/og.jpg">
        </head>
      </html>
    `,
  });

  assertEquals(preview, {
    url: "https://example.com/page",
    title: "OG title",
    domain: "example.com",
    imageUrl: "https://example.com/og.jpg",
  });
});

Deno.test("falls back to Twitter metadata and then document title", async () => {
  assertEquals(
    await createPreviewFromHtml({
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      html:
        '<meta name="twitter:title" content="Twitter title"><meta name="twitter:image" content="/twitter.jpg">',
    }),
    {
      url: "https://example.com/page",
      title: "Twitter title",
      domain: "example.com",
      imageUrl: "https://example.com/twitter.jpg",
    },
  );

  assertEquals(
    await createPreviewFromHtml({
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      html: "<title>Document title</title>",
    }),
    {
      url: "https://example.com/page",
      title: "Document title",
      domain: "example.com",
      imageUrl: undefined,
    },
  );
});

Deno.test("fetches HTML previews through an injectable fetcher", async () => {
  let fetchedUrl = "";
  let receivedSignal = false;

  const fetcher: typeof fetch = (input, init) => {
    fetchedUrl = input.toString();
    receivedSignal = init?.signal instanceof AbortSignal;

    return Promise.resolve(
      new Response(
        '<meta property="og:title" content="Menu"><meta property="og:image" content="/menu.jpg">',
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );
  };

  const preview = await fetchLinkPreview("example.com/menu", fetcher);

  assertEquals(fetchedUrl, "https://example.com/menu");
  assertEquals(receivedSignal, true);
  assertEquals(preview, {
    url: "https://example.com/menu",
    title: "Menu",
    domain: "example.com",
    imageUrl: "https://example.com/menu.jpg",
  });
});

Deno.test("rejects non-HTML preview responses", async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(
      new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
    );

  await assertRejects(
    () => fetchLinkPreview("example.com/data.json", fetcher),
    Error,
    "HTML",
  );
});
