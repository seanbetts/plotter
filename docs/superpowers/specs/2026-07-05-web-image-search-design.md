# Web Image Search Design

## Purpose

Add a lightweight web image search flow to the existing stop image panel so useful planning images can be found and saved without leaving the app.

This is for a personal planning app, not a public publishing workflow. The goal is speed and fit: find a good reference image, import it into the current stop, and keep using the existing stop/activity image storage model.

## Product Model

The first version adds web image search to stop images only.

The control appears as a search bar above the current stop preview image in the stop panel. It should feel like the existing stop and activity search fields:

- Typing runs a debounced search.
- Results appear in a popover anchored to the search field.
- `Escape` closes the popover or clears the active search using the existing search-field behavior.
- Stale search responses are ignored.
- Selecting a result performs the action for this search surface.

The result popover is a grid of image tiles rather than a vertical list of text rows. Each tile shows the thumbnail, title/source metadata when space allows, and an accessible label containing the title and source. Clicking a tile immediately imports and appends the image to the current stop image carousel.

No confirmation step is needed for v1. The image can still be deleted from the normal preview modal if it was not useful.

## Search Context

The visible query stays simple. If the user types `street art` while viewing Paris, the input remains `street art`.

The app builds a provider query from both the visible query and the selected stop context:

```text
{user query} {stop name} {region/country}
```

Examples:

```text
street art Paris France
old town Tbilisi Georgia
ski lift Niseko Japan
hotel exterior Istanbul Turkiye
```

This mirrors the activity search idea of using the selected stop to narrow intent, but image search providers do not behave like MapTiler coordinate proximity. The expanded query text is the main relevance control. Provider location parameters should be used where supported, but they are secondary to query shaping.

The search service should also pass locale controls where practical:

- `hl`: English for the initial implementation.
- `gl`: derived from the stop country code when available, otherwise a default app value.
- Provider `location`: derived from the stop name plus country/region when supported.

The expanded provider query should not be shown in the UI by default. It can be logged or exposed in tests/debug tools, but the user-facing search field should stay clean.

## Provider

Use a source-agnostic image search client in the app, with SerpApi as the recommended v1 provider.

SerpApi is a good first fit because its Google Images API exposes image-specific results and metadata:

- `image_results`
- thumbnail URLs
- original image URLs
- title/source/page metadata
- image dimensions when available
- Google Images filter support through provider parameters

The app should not let SerpApi-specific response shapes leak into components. Normalize provider results into an app type:

```ts
type WebImageSearchResult = {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  thumbnailUrl: string;
  imageUrl: string;
  width?: number;
  height?: number;
};
```

The implementation may support Serper later by writing another adapter that produces the same type.

Provider API keys must stay server-side. The browser should call a Supabase Edge Function rather than calling the search provider directly.

## Quality Controls

The search should bias toward useful planning images and avoid thumbnails or low-quality assets.

Provider-level filters should request large, photo-like images when supported. For SerpApi, use Google Images filter parameters equivalent to large photos, for example `tbs` values such as large image size and photo image type.

The app should also post-filter normalized results before rendering them:

- Prefer results with known dimensions.
- Hide known tiny images.
- Require a long edge of at least `1200px` when provider dimensions are available.
- Require the short edge to be at least `700px` when provider dimensions are available.
- Allow unknown dimensions in the search grid only if the provider supplies a credible original image URL, because some useful results may not include dimensions.

Import has a second quality gate. The server-side import function should fetch the original image and validate the response before uploading it:

- The response must be an image content type.
- The image must not be an obvious thumbnail.
- The image must fit the existing storage limits.
- If dimensions can be detected server-side, enforce the same minimum dimensions before upload.

If a selected result fails quality validation during import, the popover should show a local error and keep the search results open so another image can be chosen.

## Import Flow

Selecting a result immediately imports and appends it to the current stop.

The browser should call an app-level repository method rather than reimplementing media upload in the component:

```ts
importDestinationMediaFromSearch(input: {
  destinationId: string;
  result: WebImageSearchResult;
}): Promise<MediaItem>;
```

For Supabase storage, the repository invokes an Edge Function that:

1. Verifies the authenticated user can update the active trip.
2. Fetches the selected original image URL server-side.
3. Validates image type, size, and dimensions where possible.
4. Uploads the image into the existing private `trip-media` bucket.
5. Inserts a destination-owned `media_assets` row with `activity_id = null`.
6. Stores useful metadata:
   - `caption`: result title, trimmed.
   - `credit`: source name or source domain.
   - Source page URL is shown in the search result tile but is not persisted in v1 because the current media model only stores caption and credit.
7. Returns a signed `MediaItem` with thumbnail, preview, and full display URLs.

The new image is appended using the existing `sort_order` behavior. If it is the first stop image, it becomes the selected preview by normal carousel behavior.

For local/e2e storage, the repository can use a deterministic local fake import result. E2e tests should not depend on SerpApi, external image hosts, or Supabase auth.

## UI States

The search bar should have these states:

- Empty: no popover.
- Searching: popover opens with a compact loading state.
- Results: grid of image tiles.
- No results: concise empty state.
- Search error: local error inside the popover.
- Importing: selected tile shows a busy state and duplicate clicks are ignored.
- Import failure: local error remains visible and the results stay available.

The stop image panel itself should not be blocked while image search is loading. Existing upload, reorder, preview, and delete behavior should continue to work.

## Components

Add focused components instead of growing `DestinationProfile` or `MediaImageStrip` too much:

- `WebImageSearchField`: shared search input and popover shell, modeled after existing search-field behavior.
- `WebImageResultGrid`: image tile grid, loading, empty, and error states.
- `DestinationImageSearch`: stop-specific wrapper that supplies stop context and destination import handlers.

`DestinationImageStrip` should render the search field above the hero preview for stop images. The lower upload/drop/carousel behavior stays unchanged.

## Server Functions

Add a Supabase Edge Function for image search:

```text
supabase/functions/image-search
```

It accepts:

```ts
{
  query: string;
  context: {
    stopName: string;
    regionName?: string;
    countryName?: string;
    countryCode?: string;
  };
}
```

It returns normalized `WebImageSearchResult[]`.

Add a second Edge Function for import:

```text
supabase/functions/import-image
```

Search and import may share provider normalization and URL safety helpers, but search should not import anything and import should not run a provider search.

Both functions should reject private-network URLs and unsupported protocols before fetching remote content. Import must only fetch `http` or `https` image URLs.

## Accessibility

The search input should be labeled clearly, for example `Search web images`.

The result grid should be keyboard accessible:

- The popover is associated with the input.
- Each image tile is a button.
- Tile labels include title/source.
- Normal tab order is sufficient for v1 grid navigation.
- Loading and import progress use status text.
- Errors use alert text.

## Testing

Unit tests should cover:

- Query expansion with stop name and country/region.
- Provider result normalization.
- Provider quality filtering for small images.
- Unknown-dimension result handling.
- Import metadata mapping to caption and credit.
- URL safety checks for private IPs and unsupported protocols.

Component tests should cover:

- Search bar renders above the current stop preview.
- Typing shows a popover grid.
- Stale search responses are ignored.
- Clicking a result calls the import handler immediately.
- Import success appends the image to the displayed media list.
- Import failure leaves results open and shows an error.
- `Escape` closes the popover.

Repository and function tests should cover:

- Supabase search function calls the configured provider without exposing the key to the browser.
- Supabase import function uploads into `trip-media`.
- Destination-owned imported media uses `activity_id = null`.
- `sort_order` appends after existing destination-owned images.
- Tiny or non-image responses are rejected.

E2e coverage should use `VITE_TRIP_STORAGE=e2e-local` and mock search results. It should verify that selecting a web image result adds a new image to the stop carousel without calling external services.

## Out Of Scope For V1

- Activity image search UI. The architecture should allow it later, but v1 only adds stop image search.
- Multi-select import.
- Manual crop/edit tools.
- Full source/license workflow.
- Reverse image search.
- Public gallery or publishing features.
- Provider comparison UI.
