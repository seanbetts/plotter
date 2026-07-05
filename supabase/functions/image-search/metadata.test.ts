// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSerpApiImageSearchUrl,
  filterQualityImageResults,
  mapSerpApiImageResults,
  searchWebImages,
} from "./metadata.ts";

Deno.test("builds a SerpApi URL with contextual query and large photo filters", () => {
  const url = buildSerpApiImageSearchUrl({
    apiKey: "secret",
    query: "street art",
    context: {
      stopName: "Paris",
      countryName: "France",
      countryCode: "FR",
    },
  });

  assertEquals(url.origin, "https://serpapi.com");
  assertEquals(url.pathname, "/search.json");
  assertEquals(url.searchParams.get("engine"), "google_images");
  assertEquals(url.searchParams.get("q"), "street art Paris France");
  assertEquals(url.searchParams.get("api_key"), "secret");
  assertEquals(url.searchParams.get("hl"), "en");
  assertEquals(url.searchParams.get("gl"), "fr");
  assertEquals(url.searchParams.get("tbs"), "itp:photos,isz:l");
});

Deno.test("maps SerpApi image results and keeps source metadata", () => {
  assertEquals(
    mapSerpApiImageResults({
      images_results: [
        {
          position: 1,
          title: "Paris mural",
          source: "Example",
          link: "https://example.com/page",
          thumbnail: "https://example.com/thumb.jpg",
          original: "https://example.com/original.jpg",
          original_width: 1800,
          original_height: 1200,
        },
      ],
    }),
    [
      {
        id: "serpapi-1",
        title: "Paris mural",
        sourceName: "Example",
        sourceUrl: "https://example.com/page",
        thumbnailUrl: "https://example.com/thumb.jpg",
        imageUrl: "https://example.com/original.jpg",
        width: 1800,
        height: 1200,
      },
    ],
  );
});

Deno.test("filters known low-resolution images but keeps credible unknown dimensions", () => {
  const results = filterQualityImageResults([
    {
      id: "small",
      title: "Small",
      sourceName: "Example",
      sourceUrl: "https://example.com/small",
      thumbnailUrl: "https://example.com/small-thumb.jpg",
      imageUrl: "https://example.com/small.jpg",
      width: 640,
      height: 480,
    },
    {
      id: "large",
      title: "Large",
      sourceName: "Example",
      sourceUrl: "https://example.com/large",
      thumbnailUrl: "https://example.com/large-thumb.jpg",
      imageUrl: "https://example.com/large.jpg",
      width: 1800,
      height: 1200,
    },
    {
      id: "unknown",
      title: "Unknown",
      sourceName: "Example",
      sourceUrl: "https://example.com/unknown",
      thumbnailUrl: "https://example.com/unknown-thumb.jpg",
      imageUrl: "https://example.com/unknown.jpg",
    },
  ]);

  assertEquals(results.map((result) => result.id), ["large", "unknown"]);
});

Deno.test("searchWebImages rejects missing SerpApi keys", async () => {
  await assertRejects(
    () =>
      searchWebImages({
        apiKey: "",
        query: "mural",
        context: { stopName: "Paris", countryName: "France" },
        fetcher: fetch,
      }),
    Error,
    "SERPAPI_API_KEY",
  );
});
