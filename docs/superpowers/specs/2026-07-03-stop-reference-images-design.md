# Stop Reference Images Design

## Purpose

Add stop-level reference images to the stop detail pane so each stop can carry visual planning material: places to visit, lodging ideas, visual notes, inspiration, and other images that help plan the trip.

This is not a polished trip photo gallery yet. The first version should make images useful inside planning without adding album, fullscreen, sharing, or post-trip gallery complexity.

## UX Scope

The stop detail pane gets an image area directly below the stop title/location block.

The image area has two parts:

- A large preview image showing the currently selected image. The first ordered image is selected by default when the pane opens.
- A thumbnail carousel underneath showing all images. Clicking a thumbnail selects it into the large preview instead of opening the full-screen modal.

When a stop has no images, the same area shows a compact empty drop zone with an add tile. The empty state should invite upload without making the pane feel like a marketing card.

## Upload Behavior

Users can add images in two ways:

- Click the `+` tile in the carousel to open the native file picker.
- Drag and drop image files onto the carousel/image area.

Uploads start immediately after file selection/drop. During upload, the preview area should show an uploading status. If an upload succeeds, the new image appears at the end of the ordered list. If this is the first image, it also becomes the selected preview image.

Only image files supported by the existing Supabase bucket are in scope for v1: JPEG, PNG, WebP, and GIF.

## Reordering Behavior

Users can drag thumbnails left/right inside the carousel to reorder images directly.

The ordered image list is the source of truth for thumbnail order and default preview selection:

- The first image is selected by default when the pane opens or the selected image is deleted.
- Moving an image to the first position makes it the default selected preview the next time the pane is opened.
- Newly uploaded images are appended to the end by default.

The large preview has previous/next controls for browsing without changing order. Reordering remains a thumbnail-carousel interaction.

## Preview Modal

Clicking the large preview opens a simple full-screen preview modal. Clicking a thumbnail selects the large preview and does not open the modal.

The modal includes:

- Large image preview.
- Delete action.
- Previous/next controls for browsing the full image set.
- Close button.

The modal is for focused viewing, navigation, and deletion. Caption and credit editing should live outside the full-screen modal if it is reintroduced later. Deleting an image removes it from the carousel and storage metadata; if the deleted image was selected, the first remaining image becomes selected.

## Data Model

The existing `media_assets` table needs an ordering field:

```sql
sort_order integer not null
```

The migration should backfill `sort_order` from existing creation order, enforce `not null`, leave no default on the final schema, and enforce uniqueness per destination with a partial unique index on `(trip_id, destination_id, sort_order)` where `destination_id is not null`.

The repository should treat `media_assets.sort_order` as the image order for each destination.

The existing Supabase Storage path pattern remains:

```text
{tripId}/{destinationId}/{generated-file-name}
```

The existing private `trip-media` bucket and signed URL read flow remain the right approach.

Each loaded `MediaItem` should expose display-specific URLs when the backing storage provider supports transforms:

```ts
type MediaItem = {
  url: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  fullUrl?: string;
};
```

The thumbnail carousel should use `thumbnailUrl`, the in-panel preview should use `previewUrl`, and the full-screen modal should use `fullUrl`, each falling back to `url` when the optimized variant is unavailable.

## Repository API

Extend the trip repository media surface to support full image UI behavior:

```ts
listDestinationMedia(destinationId: string): Promise<MediaItem[]>;

uploadDestinationMedia(input: {
  destinationId: string;
  file: File;
  caption?: string;
  credit?: string;
}): Promise<MediaItem>;

updateDestinationMedia(
  mediaId: string,
  patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
): Promise<MediaItem>;

deleteDestinationMedia(mediaId: string): Promise<void>;

reorderDestinationMedia(destinationId: string, orderedMediaIds: string[]): Promise<MediaItem[]>;
```

The Supabase implementation should use patch/update operations and avoid rewriting unrelated media rows except when updating `sort_order` during reorder.

## Components

Add focused components rather than growing `DestinationProfile` too much:

- `DestinationImageStrip`: owns large preview display, carousel, add tile, drag/drop upload, direct thumbnail reordering, and opening the full-screen preview modal.
- `DestinationImagePreviewModal`: owns full-screen preview, previous/next navigation, delete confirmation, and close behavior.

`DestinationProfile` should pass the destination id and repository-backed handlers down to these components. The existing stop name/stay/tags autosave behavior should remain separate.

## Loading And Error States

Image loading should not block the whole stop detail pane.

States to support:

- Initial media loading for the selected stop.
- Uploading one or more images.
- Upload failure with a retry affordance or clear failure message.
- Reorder failure that restores the previous order.
- Delete failure in the modal.
- Delete confirmation before removing an image.

## Accessibility

The carousel should remain usable without pointer drag:

- Add tile is a button with a clear label.
- Thumbnails are buttons that select the large preview.
- The large preview is a button that opens the full-screen modal.
- Preview and modal previous/next controls are keyboard-accessible browsing controls.
- Modal uses dialog semantics, focus trap behavior, and closes with Escape.
- Upload/drop state is announced via an accessible status region.

## Testing

Component tests should cover:

- Empty image state.
- Clicking `+` calls file upload flow.
- Dropping an image calls upload flow.
- Upload success adds a thumbnail and updates the selected preview when needed.
- Thumbnail click selects the large preview without opening the modal.
- Large preview click opens the preview modal.
- Delete removes an image and updates the selected preview.
- Drag reorder calls `reorderDestinationMedia` with ordered ids.
- Preview and modal previous/next controls navigate images without reordering.
- Upload/reorder/save/delete errors render accessible feedback.

Repository tests should cover:

- `sort_order` mapping.
- Upload stores object in `trip-media` and inserts media metadata.
- Listing returns media ordered by `sort_order`.
- Caption/credit update patches only visible media metadata.
- Delete removes metadata after attempting to remove the associated storage object.
- Reorder updates only rows for the selected destination/trip.

## Out Of Scope For V1

- Albums.
- Full trip gallery page.
- Public sharing.
- Image crop/edit tools.
- AI image analysis.
- Manual cover image separate from order.
- Bulk download.
