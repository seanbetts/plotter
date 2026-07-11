// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPreviewFromHtml,
  fetchLinkPreview,
  normalizePreviewUrl,
  validatePublicPreviewUrl,
} from "./metadata.ts";

const publicResolver = () => Promise.resolve(["93.184.216.34"]);

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

Deno.test("rejects hostnames that resolve to private addresses", async () => {
  const resolver = (hostname: string) => {
    assertEquals(hostname, "127.0.0.1.nip.io");
    return Promise.resolve(["127.0.0.1"]);
  };

  await assertRejects(
    () => validatePublicPreviewUrl("http://127.0.0.1.nip.io/admin", resolver),
    Error,
    "public URL",
  );
});

Deno.test("rejects private IPv6 literal targets", async () => {
  for (
    const url of [
      "http://[::1]/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[fd00::1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://[fec0::1]/",
      "http://[::]/",
      "http://[::127.0.0.1]/",
      "http://[::192.168.1.10]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:192.168.1.10]/",
    ]
  ) {
    await assertRejects(
      () => Promise.resolve().then(() => validatePublicPreviewUrl(url)),
      Error,
      "public URL",
    );
  }
});

Deno.test("rejects reserved and other non-public literal targets", async () => {
  for (
    const url of [
      "http://100.64.0.1/",
      "http://192.0.0.1/",
      "http://192.0.2.1/",
      "http://198.18.0.1/",
      "http://198.51.100.1/",
      "http://203.0.113.1/",
      "http://224.0.0.1/",
      "http://255.255.255.255/",
      "http://[ff00::1]/",
      "http://[2001:db8::1]/",
    ]
  ) {
    await assertRejects(
      () => Promise.resolve().then(() => validatePublicPreviewUrl(url)),
      Error,
      "public URL",
    );
  }
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

Deno.test("omits private absolute preview image URLs", async () => {
  assertEquals(
    await createPreviewFromHtml({
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      html:
        '<meta property="og:title" content="Private image"><meta property="og:image" content="http://127.0.0.1/private.png">',
    }),
    {
      url: "https://example.com/page",
      title: "Private image",
      domain: "example.com",
      imageUrl: undefined,
    },
  );
});

Deno.test("omits DNS-private preview image URLs", async () => {
  const resolver = (hostname: string) => {
    assertEquals(hostname, "127.0.0.1.nip.io");
    return Promise.resolve(["127.0.0.1"]);
  };

  assertEquals(
    await createPreviewFromHtml({
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      html:
        '<meta property="og:title" content="DNS private image"><meta property="og:image" content="http://127.0.0.1.nip.io/private.png">',
    }, resolver),
    {
      url: "https://example.com/page",
      title: "DNS private image",
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
    assertEquals(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("accept"), "text/html, application/xhtml+xml");
    assertEquals(headers.get("user-agent"), "PlotterLinkPreview/1.0");

    return Promise.resolve(
      new Response(
        '<meta property="og:title" content="Menu"><meta property="og:image" content="/menu.jpg">',
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );
  };

  const preview = await fetchLinkPreview(
    "example.com/menu",
    fetcher,
    publicResolver,
  );

  assertEquals(fetchedUrl, "https://example.com/menu");
  assertEquals(receivedSignal, true);
  assertEquals(preview, {
    url: "https://example.com/menu",
    title: "Menu",
    domain: "example.com",
    imageUrl: "https://example.com/menu.jpg",
  });
});

Deno.test("rejects DNS-private preview URLs before fetching", async () => {
  let fetched = false;
  const fetcher: typeof fetch = () => {
    fetched = true;
    return Promise.resolve(new Response("unreachable"));
  };
  const resolver = (hostname: string) => {
    assertEquals(hostname, "127.0.0.1.nip.io");
    return Promise.resolve(["127.0.0.1"]);
  };

  await assertRejects(
    () => fetchLinkPreview("http://127.0.0.1.nip.io/admin", fetcher, resolver),
    Error,
    "public URL",
  );
  assertEquals(fetched, false);
});

Deno.test("rejects public redirects to private targets before second fetch", async () => {
  const fetchedUrls: string[] = [];
  const fetcher: typeof fetch = (input) => {
    fetchedUrls.push(input.toString());
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );
  };

  await assertRejects(
    () =>
      fetchLinkPreview("https://example.com/start", fetcher, publicResolver),
    Error,
    "public URL",
  );
  assertEquals(fetchedUrls, ["https://example.com/start"]);
});

Deno.test("rejects redirect loops after the redirect limit", async () => {
  const fetchedUrls: string[] = [];
  const fetcher: typeof fetch = (input) => {
    fetchedUrls.push(input.toString());
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "/loop" },
      }),
    );
  };

  await assertRejects(
    () => fetchLinkPreview("https://example.com/loop", fetcher, publicResolver),
    Error,
    "Too many redirects",
  );
  assertEquals(fetchedUrls, [
    "https://example.com/loop",
    "https://example.com/loop",
    "https://example.com/loop",
    "https://example.com/loop",
  ]);
});

Deno.test("rejects non-HTML preview responses", async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(
      new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
    );

  await assertRejects(
    () => fetchLinkPreview("example.com/data.json", fetcher, publicResolver),
    Error,
    "HTML",
  );
});

Deno.test("aborts slow preview fetches", async () => {
  let signalReceived = false;
  let signalAborted = false;
  const fetcher: typeof fetch = (_input, init) => {
    const signal = init?.signal;
    signalReceived = signal instanceof AbortSignal;

    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        signalAborted = true;
        reject(new Error("preview fetch aborted"));
      });
    });
  };

  await assertRejects(
    () => fetchLinkPreview("https://example.com/slow", fetcher, publicResolver),
    Error,
    "aborted",
  );
  assertEquals(signalReceived, true);
  assertEquals(signalAborted, true);
});

Deno.test("bounds oversized HTML reads and cancels the stream", async () => {
  let canceled = false;
  let pullCount = 0;
  const chunk = new TextEncoder().encode("a".repeat(256_000));
  const htmlPrefix = '<meta property="og:title" content="Large page">';

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) {
        controller.enqueue(new TextEncoder().encode(htmlPrefix));
        return;
      }

      controller.enqueue(chunk);
    },
    cancel() {
      canceled = true;
    },
  });

  const fetcher: typeof fetch = () =>
    Promise.resolve(
      new Response(stream, {
        headers: { "content-type": "text/html" },
      }),
    );

  const preview = await fetchLinkPreview(
    "https://example.com/large",
    fetcher,
    publicResolver,
  );

  assertEquals(preview.title, "Large page");
  assertEquals(canceled, true);
  assert(pullCount >= 3);
});
