// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createImportedImageObjectPath,
  fetchImportImage,
  normalizeImportResult,
  validatePublicImageUrl,
} from "./metadata.ts";

const publicResolver = () => Promise.resolve(["93.184.216.34"]);

Deno.test("rejects unsupported and private import image URLs", async () => {
  await assertRejects(
    () => validatePublicImageUrl("ftp://example.com/image.jpg", publicResolver),
    Error,
    "http or https",
  );
  await assertRejects(
    () => validatePublicImageUrl("http://127.0.0.1/image.jpg", publicResolver),
    Error,
    "public image URL",
  );
});

Deno.test("rejects private IPv6 import image URLs", async () => {
  await assertRejects(
    () => validatePublicImageUrl("http://[::1]/image.jpg", publicResolver),
    Error,
    "public image URL",
  );
  await assertRejects(
    () =>
      validatePublicImageUrl(
        "http://[::ffff:127.0.0.1]/image.jpg",
        publicResolver,
      ),
    Error,
    "public image URL",
  );
});

Deno.test("normalizes selected result metadata", () => {
  assertEquals(
    normalizeImportResult({
      id: "result-1",
      title: " Paris mural ",
      sourceName: " Example Source ",
      sourceUrl: "https://example.com/page",
      thumbnailUrl: "https://example.com/thumb.jpg",
      imageUrl: "https://example.com/image.jpg",
    }),
    {
      id: "result-1",
      title: "Paris mural",
      sourceName: "Example Source",
      sourceUrl: "https://example.com/page",
      thumbnailUrl: "https://example.com/thumb.jpg",
      imageUrl: "https://example.com/image.jpg",
    },
  );
});

Deno.test("creates trip and destination scoped object paths", () => {
  const path = createImportedImageObjectPath({
    tripId: "11111111-1111-4111-8111-111111111111",
    destinationId: "22222222-2222-4222-8222-222222222222",
    title: "Paris mural / old town",
    contentType: "image/jpeg",
    uuid: () => "33333333-3333-4333-8333-333333333333",
  });

  assertEquals(
    path,
    "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333-paris-mural-old-town.jpg",
  );
});

Deno.test("fetchImportImage rejects non-image responses", async () => {
  await assertRejects(
    () =>
      fetchImportImage({
        imageUrl: "https://example.com/data.json",
        fetcher: () =>
          Promise.resolve(
            new Response("{}", {
              headers: { "content-type": "application/json" },
            }),
          ),
        resolver: publicResolver,
      }),
    Error,
    "image",
  );
});

Deno.test("fetchImportImage returns image bytes and content type", async () => {
  const imported = await fetchImportImage({
    imageUrl: "https://example.com/image.jpg",
    fetcher: () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    resolver: publicResolver,
  });

  assertEquals(imported.contentType, "image/jpeg");
  assertEquals(imported.bytes.byteLength, 3);
});

Deno.test("fetchImportImage rejects oversized content-length without reading the body", async () => {
  let bodyRead = false;

  await assertRejects(
    () =>
      fetchImportImage({
        imageUrl: "https://example.com/large.jpg",
        fetcher: () =>
          Promise.resolve(
            {
              ok: true,
              headers: new Headers({
                "content-length": `${50 * 1024 * 1024 + 1}`,
                "content-type": "image/jpeg",
              }),
              get body() {
                bodyRead = true;
                return new ReadableStream<Uint8Array>({
                  pull(controller) {
                    controller.enqueue(new Uint8Array([1]));
                    controller.close();
                  },
                });
              },
            } as Response,
          ),
        resolver: publicResolver,
      }),
    Error,
    "too large",
  );
  assertEquals(bodyRead, false);
});

Deno.test("fetchImportImage rejects streaming bodies once they exceed the size cap", async () => {
  let chunksRead = 0;
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksRead += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (chunksRead > 60) {
        controller.close();
      }
    },
    cancel() {
      canceled = true;
    },
  });

  await assertRejects(
    () =>
      fetchImportImage({
        imageUrl: "https://example.com/large.jpg",
        fetcher: () =>
          Promise.resolve(
            new Response(stream, {
              headers: { "content-type": "image/jpeg" },
            }),
          ),
        resolver: publicResolver,
      }),
    Error,
    "too large",
  );
  assertEquals(chunksRead <= 52, true);
  assertEquals(canceled, true);
});

Deno.test("fetchImportImage follows safe redirects", async () => {
  const fetchedUrls: string[] = [];
  const fetcher = (input: string | URL, init?: RequestInit) => {
    fetchedUrls.push(input.toString());
    assertEquals(init?.redirect, "manual");

    if (input.toString() === "https://example.com/start.jpg") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/image.jpg" },
        }),
      );
    }

    return Promise.resolve(
      new Response(new Uint8Array([4, 5, 6]), {
        headers: { "content-type": "image/png" },
      }),
    );
  };

  const imported = await fetchImportImage({
    imageUrl: "https://example.com/start.jpg",
    fetcher,
    resolver: publicResolver,
  });

  assertEquals(fetchedUrls, [
    "https://example.com/start.jpg",
    "https://cdn.example.com/image.jpg",
  ]);
  assertEquals(imported.contentType, "image/png");
  assertEquals(imported.bytes.byteLength, 3);
});

Deno.test("fetchImportImage resolves each hostname immediately before fetching", async () => {
  const events: string[] = [];
  const resolver = (hostname: string) => {
    events.push(`resolve:${hostname}`);
    return Promise.resolve(["93.184.216.34"]);
  };
  const fetcher = (input: string | URL) => {
    events.push(`fetch:${input.toString()}`);

    if (input.toString() === "https://example.com/start.jpg") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/image.jpg" },
        }),
      );
    }

    return Promise.resolve(
      new Response(new Uint8Array([4, 5, 6]), {
        headers: { "content-type": "image/png" },
      }),
    );
  };

  await fetchImportImage({
    imageUrl: "https://example.com/start.jpg",
    fetcher,
    resolver,
  });

  assertEquals(events, [
    "resolve:example.com",
    "fetch:https://example.com/start.jpg",
    "resolve:cdn.example.com",
    "fetch:https://cdn.example.com/image.jpg",
  ]);
});

Deno.test("fetchImportImage rejects public redirects to private targets before second fetch", async () => {
  const fetchedUrls: string[] = [];
  const fetcher = (input: string | URL) => {
    fetchedUrls.push(input.toString());
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private.jpg" },
      }),
    );
  };

  await assertRejects(
    () =>
      fetchImportImage({
        imageUrl: "https://example.com/start.jpg",
        fetcher,
        resolver: publicResolver,
      }),
    Error,
    "public image URL",
  );
  assertEquals(fetchedUrls, ["https://example.com/start.jpg"]);
});

Deno.test("fetchImportImage rejects redirect loops after the redirect limit", async () => {
  const fetchedUrls: string[] = [];
  const fetcher = (input: string | URL) => {
    fetchedUrls.push(input.toString());
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "/loop.jpg" },
      }),
    );
  };

  await assertRejects(
    () =>
      fetchImportImage({
        imageUrl: "https://example.com/loop.jpg",
        fetcher,
        resolver: publicResolver,
      }),
    Error,
    "Too many redirects",
  );
  assertEquals(fetchedUrls, [
    "https://example.com/loop.jpg",
    "https://example.com/loop.jpg",
    "https://example.com/loop.jpg",
    "https://example.com/loop.jpg",
  ]);
});
