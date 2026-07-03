# Stop Reference Images Design

## Purpose

Add stop-level reference images to the stop detail pane so each stop can carry visual planning material: places to visit, lodging ideas, visual notes, inspiration, and other images that help plan the trip.

This is not a polished trip photo gallery yet. The first version should make images useful inside planning without adding album, fullscreen, sharing, or post-trip gallery complexity.

## UX Scope

The stop detail pane gets an image area directly below the stop title/location block.

The image area has two parts:

- A hero image showing the first image in the stop's ordered image list.
- A thumbnail carousel underneath showing all images plus an add tile.

When a stop has no images, the same area shows a compact empty drop zone with an add tile. The empty state should invite upload without making the pane feel like a marketing card.

## Upload Behavior

Users can add images in two ways:

- Click the `+` tile in the carousel to open the native file picker.
- Drag and drop image files onto the carousel/image area.

Uploads start immediately after file selection/drop. During upload, the carousel should show an uploading placeholder. If an upload succeeds, the new image appears at the end of the ordered list. If this is the first image, it also becomes the hero image.

Only image files supported by the existing Supabase bucket are in scope for v1: JPEG, PNG, WebP, and GIF.

## Reordering Behavior

Users can drag thumbnails left/right inside the carousel to reorder images directly.

The ordered image list is the source of truth:

- The first image is always the hero image.
- Moving an image to the first position immediately makes it the hero.
- Newly uploaded images are appended to the end by default.

For accessibility and trackpad edge cases, the preview modal should also offer keyboard-accessible move-left and move-right controls for the selected image.

## Preview Modal

Clicking the hero image or any thumbnail opens a simple preview modal.

The modal includes:

- Large image preview.
- Caption field.
- Credit field.
- Delete action.
- Move left/right fallback controls.
- Close button.

Caption and credit edits should autosave with the same save-status feedback pattern as the stop detail pane. Deleting an image removes it from the carousel and storage metadata; if the deleted image was first, the next image becomes the hero.

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

- `DestinationImageStrip`: owns hero image display, carousel, add tile, drag/drop upload, direct thumbnail reordering, and opening the preview modal.
- `DestinationImagePreviewModal`: owns large preview, caption/credit editing, delete, and fallback reorder controls.

`DestinationProfile` should pass the destination id and repository-backed handlers down to these components. The existing stop name/stay/tags autosave behavior should remain separate.

## Loading And Error States

Image loading should not block the whole stop detail pane.

States to support:

- Initial media loading for the selected stop.
- Uploading one or more images.
- Upload failure with a retry affordance or clear failure message.
- Reorder failure that restores the previous order.
- Caption/credit save failure in the modal.
- Delete confirmation before removing an image.

## Accessibility

The carousel should remain usable without pointer drag:

- Add tile is a button with a clear label.
- Thumbnails are buttons that open the preview modal.
- Drag reorder has keyboard fallback controls in the modal.
- Modal uses dialog semantics, focus trap behavior, and closes with Escape.
- Upload/drop state is announced via an accessible status region.

## Testing

Component tests should cover:

- Empty image state.
- Clicking `+` calls file upload flow.
- Dropping an image calls upload flow.
- Upload success adds a thumbnail and updates the hero when needed.
- Thumbnail click opens the preview modal.
- Caption/credit changes save through repository handlers.
- Delete removes an image and updates the hero.
- Drag reorder calls `reorderDestinationMedia` with ordered ids.
- Move-left/move-right fallback reorders images.
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
