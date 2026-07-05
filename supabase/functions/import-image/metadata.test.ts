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
