# Stop And Activity Link Previews Design

Date: 2026-07-04

## Goal

Add visual URL preview cards to both stops and activities.

Links should feel like saved research, not plain text bookmarks. A user should be able to paste a URL, get a visual preview, save it under a stop or activity, reorder the saved cards, and open the source page later.

## Decisions

- Use the same link preview component for stop links and activity links.
- Stop links live in `destination.research.links`.
- Activity links live in `activity.links`.
- Render links as image-led cards, two per row at normal panel width.
- Clicking a card opens the URL in a new browser tab.
- Dragging a card reorders it.
- The only visible per-card action is delete.
- Do not show categories, notes, edit buttons, open buttons, or drag handles.
- Fetch page previews when adding links. The visual card depends on fetched metadata.
- Persist the fetched preview snapshot with the link so rendering stays fast and stable.
- If preview fetching fails, allow the link to be saved with a generated fallback visual based on the URL domain.

## User Flow

1. The user opens a stop panel or activity panel.
2. The user clicks `Add link`.
3. The user pastes a URL.
4. The app normalizes the URL and asks the backend to fetch preview metadata.
5. The UI shows a loading preview state.
6. If preview fetching succeeds, the app creates a card using the fetched title, domain, and image.
7. If preview fetching fails, the app creates a card using the URL, derived domain, and fallback visual.
8. The user can drag cards to reorder them.
9. The user can click a card to open the URL in a new tab.
10. The user can delete a card.

Adding a link should not require a separate title, category, note, or image upload in v1.

## UI

The stop and activity panels should each contain a `Links` section near their existing tags and notes fields.

Each card shows:

- preview image area
- title
- domain
- delete button

The card itself is the main interaction surface. It should communicate that it is clickable through hover/focus treatment and should open the URL in a new tab.

Cards should appear in a two-column grid at current desktop panel widths. At narrow widths, the grid can collapse to one column.

The empty state should be quiet and compact: an `Add link` control is enough. Avoid explanatory in-app copy.

## Data Model

Extend the existing shared link shape:

```ts
type ResearchLink = {
  id: string;
  url: string;
  title: string;
  domain: string;
  imageUrl?: string;
  sortOrder: number;
  previewFetchedAt?: string;
};
```

`url` is the normalized canonical URL used when opening the card.

`title` is fetched from Open Graph, Twitter card metadata, or the document title. If no title is available, use the domain.

`domain` is derived from the normalized URL and shown on the card.

`imageUrl` is the best fetched preview image URL. It can point to the source site's Open Graph image in v1. The app should not download or store preview images in v1.

`sortOrder` stores manual order within the parent stop or activity.

`previewFetchedAt` records when the metadata snapshot was fetched. It is informational in v1 and can support future refresh behavior.

No database migration is required for the link fields because stop research links and activity links are stored as JSON values. Implementation may still need TypeScript migrations or guards for older links that only have `id`, `title`, and `url`.

## Preview Fetching

Preview fetching should happen server-side, not in the browser. Browser-side fetching will run into CORS limits and inconsistent page metadata access.

Add a Supabase Edge Function:

```text
POST /link-preview
```

Request:

```json
{
  "url": "https://example.com/page"
}
```

Response:

```json
{
  "url": "https://example.com/page",
  "title": "Page title",
  "domain": "example.com",
  "imageUrl": "https://example.com/og-image.jpg"
}
```

The function should:

- accept only `http` and `https` URLs
- normalize URLs with a missing scheme by assuming `https://`
- reject localhost, private network, link-local, and other non-public targets
- use a short timeout
- follow a limited number of redirects
- enforce a maximum response size
- parse Open Graph title and image first
- fall back to Twitter card metadata
- fall back to `<title>`
- return a useful error when no fetchable preview exists

The client should not block saving a link on preview failure. Failed previews still produce a valid card with a generated fallback image.

## Generated Fallback Visual

When no preview image is available, render a generated tile rather than a broken image.

The fallback should be deterministic from the domain, using:

- a restrained generated background
- the domain or first letter as the central visual signal
- the same card dimensions as preview-image cards

This keeps the grid stable and intentional even when links do not provide metadata images.

## Persistence

Stops update `destination.research.links` while preserving the rest of `destination.research`.

Activities update `activity.links`.

Reordering rewrites `sortOrder` for the links under that parent only. Reordering stop links must not affect activity links, and reordering activity links must not affect stop links.

Deleting a link removes it from the parent array. No source page data is deleted because preview images are hotlinked in v1.

## Error Handling

If URL normalization fails, keep the add form open and show an inline error.

If preview fetching fails, save the link with:

- normalized URL
- derived domain
- title equal to the domain
- no `imageUrl`

If saving fails, keep the add form open and show the existing save-error pattern for the panel.

If opening a link fails because the browser blocks the popup or new tab, the URL remains saved. The app should use a normal anchor-style interaction where possible rather than imperative popup code.

## Accessibility

Each link card should be keyboard reachable.

The accessible name should include the link title and domain.

The delete button should have an accessible label such as `Delete Dinner menu link`.

Drag-and-drop reorder needs a keyboard alternative. The implementation can reuse the same move-up and move-down behavior already used for activities, but the visual card should not show permanent move buttons at desktop widths. Keyboard-only users still need a discoverable focused state or scoped controls.

## Testing

Unit tests should cover:

- URL normalization
- domain derivation
- fallback link creation when preview fetching fails
- sorting links by `sortOrder`
- reassigning `sortOrder` after drag reorder

Edge Function tests should cover:

- Open Graph title and image extraction
- Twitter metadata fallback
- document title fallback
- rejecting non-http schemes
- rejecting private, localhost, and link-local targets
- timeout or oversized response handling

Component tests should cover:

- stop links render as two-column visual cards at desktop width
- activity links use the same card component
- clicking a card exposes an anchor that opens in a new tab
- delete removes the selected link
- failed preview creates a fallback card
- drag reorder calls the correct parent update

E2e coverage can stay focused: add a mocked preview link to a stop, verify the card appears, reorder it with another card, and verify the order persists after reload.
