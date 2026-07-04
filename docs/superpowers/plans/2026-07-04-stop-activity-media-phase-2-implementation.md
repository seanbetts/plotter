# Stop Activity Media Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add activity-owned images, stop carousel rollups, and an activity detail panel while preserving the current preview-first stop image behavior.

**Architecture:** Extend the existing `media_assets` and `trip-media` spine with nullable activity ownership instead of adding a parallel media system. Keep destination-owned media operations scoped to `activity_id is null`, add activity-owned operations for activity panels, and share one media hook/component layer across stop and activity image surfaces.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Dexie, Supabase Postgres + Storage, Vite.

---

## Current Image Behavior To Preserve

The latest stop image implementation is the source of truth for Phase 2:

- Thumbnails select the large in-panel preview.
- The large preview opens the full-screen modal.
- Modal arrows navigate images and must not reorder.
- Thumbnail drag reorders images within the current owner scope.
- The modal is image-only plus navigation/delete; caption and credit fields do not belong in the full-screen modal.
- `MediaItem` carries optimized URL variants: `thumbnailUrl`, `previewUrl`, and `fullUrl`.
- Uploads pass through `normalizeImageFile()` before reaching repository upload methods.

## Scope

Included:

- Add `media_assets.activity_id` and ownership-aware media indexes.
- Keep destination media methods destination-owned only.
- Add activity media list/upload/update/delete/reorder repository methods.
- Add stop media rollup listing with activity attribution.
- Add local IndexedDB support for activity media.
- Generalize stop image hook/component behavior for stop and activity owners.
- Add an `ActivityPanel` with activity media and basic rich fields.
- Render the activity panel to the left of the stop panel.

Deferred:

- Map focus layer and activity pins.
- Promoting activities to stops.
- Trip-wide gallery pages.
- AI image analysis.
- Caption/credit editing UI.

## File Structure

- Create `supabase/migrations/<timestamp>_add_activity_media_ownership.sql`: add `media_assets.activity_id`, owner-aware indexes, and activity ownership FK.
- Modify `src/domain/types.ts`: add media owner and rollup types.
- Modify `src/storage/tripDb.ts`: add a local `activityMedia` table.
- Modify `src/storage/tripRepository.ts`: add activity media and rollup methods for local storage.
- Modify `src/storage/tripRepository.test.ts`: cover local activity media and stop rollup behavior.
- Modify `src/storage/supabaseTripRepository.ts`: add owner-aware Supabase media queries and methods.
- Modify `src/storage/supabaseTripRepository.test.ts`: cover Supabase activity media, rollups, and destination-owned filters.
- Create `src/hooks/useOwnedMedia.ts`: owner-agnostic media hook with current upload normalization and stale response guards.
- Modify `src/hooks/useDestinationMedia.ts`: wrap `useOwnedMedia` for destination-owned media.
- Create `src/hooks/useActivityMedia.ts`: wrap `useOwnedMedia` for activity-owned media.
- Test `src/hooks/useOwnedMedia.test.tsx` and `src/hooks/useActivityMedia.test.tsx`.
- Create `src/components/MediaImageStrip.tsx`: reusable preview-first media strip.
- Modify `src/components/DestinationImageStrip.tsx`: thin stop-owned wrapper around `MediaImageStrip`.
- Create `src/components/ActivityImageStrip.tsx`: activity-owned wrapper around `MediaImageStrip`.
- Modify `src/components/DestinationImagePreviewModal.tsx`: add owner-neutral fallback labels and optional activity attribution action.
- Create `src/components/ActivityPanel.tsx`: selected activity detail panel with activity media.
- Test `src/components/MediaImageStrip.test.tsx`, `ActivityImageStrip.test.tsx`, and `ActivityPanel.test.tsx`.
- Modify `src/App.tsx`: load rollup media for selected stop, load activity media for selected activity, render side-by-side panels.
- Modify `src/App.test.tsx`: cover rollup display, activity panel media, and modal navigation without reorder.
- Modify `src/styles.css`: side-by-side panel and owner-aware media attribution styles.

---

### Task 1: Add Media Ownership Schema And Types

**Files:**
- Create: `supabase/migrations/<timestamp>_add_activity_media_ownership.sql`
- Modify: `src/domain/types.ts`
- Test: `src/storage/supabaseTripRepository.test.ts`

- [x] **Step 1: Create the migration file with the Supabase CLI**

Run:

```bash
npx supabase migration new add_activity_media_ownership
```

Expected: a new file appears in `supabase/migrations/` with a timestamped name ending in `_add_activity_media_ownership.sql`.

- [x] **Step 2: Add the ownership migration SQL**

Replace the new migration contents with:

```sql
alter table public.media_assets
add column if not exists activity_id uuid;

alter table public.media_assets
alter column destination_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_activity_owner_fk'
  ) then
    alter table public.media_assets
    add constraint media_assets_activity_owner_fk
      foreign key (trip_id, destination_id, activity_id)
      references public.activities(trip_id, destination_id, id)
      on delete cascade;
  end if;
end $$;

drop index if exists public.media_assets_trip_destination_sort_order_key;

create unique index if not exists media_assets_destination_owned_sort_order_key
on public.media_assets(trip_id, destination_id, sort_order)
where activity_id is null;

create unique index if not exists media_assets_activity_owned_sort_order_key
on public.media_assets(trip_id, destination_id, activity_id, sort_order)
where activity_id is not null;

create index if not exists media_assets_trip_destination_activity_idx
on public.media_assets(trip_id, destination_id, activity_id);
```

This migration relies on the existing `activities` table unique key on `(trip_id, destination_id, id)`.

- [x] **Step 3: Add domain types**

In `src/domain/types.ts`, add these types after `MediaItem`:

```ts
export type MediaOwnerType = 'destination' | 'activity';

export type MediaRollupItem = {
  mediaItem: MediaItem;
  ownerType: MediaOwnerType;
  destinationId: string;
  activityId?: string;
  activityTitle?: string;
  canReorderInStopCarousel: boolean;
};

export type ActivityMediaRecord = MediaItem & {
  activityId: string;
  destinationId: string;
};
```

- [x] **Step 4: Add a mapper test for owner metadata**

In `src/storage/supabaseTripRepository.test.ts`, extend the media mapper test so the row fixture includes:

```ts
activity_id: null,
```

Add a second mapper assertion:

```ts
expect(mediaAssetFromSupabaseRow(
  { ...row, activity_id: activityId },
  'https://signed.example/activity.jpg',
)).toMatchObject({
  id: row.id,
  url: 'https://signed.example/activity.jpg',
});
```

Expected: this test keeps `MediaItem` owner-neutral. Ownership lives in query methods and rollup wrappers, not every `MediaItem` consumer.

- [x] **Step 5: Run the focused mapper tests**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected before implementation: FAIL if the row type does not accept `activity_id`. Expected after implementation: PASS.

- [x] **Step 6: Commit the schema and type contracts**

Run:

```bash
git add supabase/migrations src/domain/types.ts src/storage/supabaseTripRepository.test.ts
git commit -m "feat: add activity media ownership schema"
```

---

### Task 2: Add Owner-Aware Repository Methods

**Files:**
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripDb.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`

- [x] **Step 1: Extend the repository interface**

In `src/storage/tripRepository.ts`, import `MediaRollupItem` and add these methods to `TripRepository` next to the existing destination media methods:

```ts
listDestinationMediaRollup(destinationId: string): Promise<MediaRollupItem[]>;
listActivityMedia(activityId: string): Promise<MediaItem[]>;
uploadActivityMedia(input: {
  destinationId: string;
  activityId: string;
  file: File;
  caption?: string;
  credit?: string;
}): Promise<MediaItem>;
updateActivityMedia(
  mediaId: string,
  patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
): Promise<MediaItem>;
deleteActivityMedia(mediaId: string): Promise<void>;
reorderActivityMedia(activityId: string, orderedMediaIds: string[]): Promise<MediaItem[]>;
```

- [x] **Step 2: Add local activity media storage**

In `src/storage/tripDb.ts`, add `ActivityMediaRecord` to the imports and the database type:

```ts
activityMedia: EntityTable<ActivityMediaRecord, 'id'>;
```

Add a version 4 store:

```ts
db.version(4).stores({
  destinations: 'id, order, name, countryRegion, status, priority, updatedAt',
  routeLegs: 'id, originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
  activities: 'id, destinationId, order, title, status, priority, updatedAt',
  activityMedia: 'id, activityId, destinationId, sortOrder, uploadedAt',
});
```

- [x] **Step 3: Write local repository tests**

In `src/storage/tripRepository.test.ts`, add a test that creates a destination, creates an activity, uploads destination media, uploads activity media, and expects:

```ts
expect((await repository.listDestinationMedia(destination.id)).map((item) => item.id)).toEqual([
  destinationMedia.id,
]);
expect((await repository.listActivityMedia(activity.id)).map((item) => item.id)).toEqual([
  activityMedia.id,
]);
expect(await repository.listDestinationMediaRollup(destination.id)).toEqual([
  expect.objectContaining({
    mediaItem: expect.objectContaining({ id: destinationMedia.id }),
    ownerType: 'destination',
    canReorderInStopCarousel: true,
  }),
  expect.objectContaining({
    mediaItem: expect.objectContaining({ id: activityMedia.id }),
    ownerType: 'activity',
    activityId: activity.id,
    activityTitle: activity.title,
    canReorderInStopCarousel: false,
  }),
]);
```

- [x] **Step 4: Implement local repository methods**

In `src/storage/tripRepository.ts`:

- Store destination media exactly as it works today in `destination.media`.
- Store activity media rows in `db.activityMedia`.
- Make `listDestinationMediaRollup(destinationId)` concatenate destination-owned media first and activity media grouped by activity order.
- Make `reorderActivityMedia(activityId, orderedMediaIds)` validate the ids exactly like `reorderDestinationMedia`.

Use the existing `createLocalMediaUrl(file)` helper for local activity uploads.

- [x] **Step 5: Write Supabase tests for destination-owned filtering**

In `src/storage/supabaseTripRepository.test.ts`, add a test that calls `repository.listDestinationMedia(destinationId)` and asserts the query chain includes:

```ts
eq('trip_id', tripId)
eq('destination_id', destinationId)
is('activity_id', null)
order('sort_order', { ascending: true })
```

This protects against activity-owned images leaking into stop-owned reorder paths.

- [x] **Step 6: Write Supabase tests for activity media upload and listing**

Add tests that assert:

```ts
expect(upload).toHaveBeenCalledWith(
  `${tripId}/${destinationId}/${activityId}/${expect.any(String)}`,
  file,
  expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
);
expect(mediaInsert).toHaveBeenCalledWith(expect.objectContaining({
  trip_id: tripId,
  destination_id: destinationId,
  activity_id: activityId,
  bucket_id: 'trip-media',
  sort_order: 0,
}));
```

For `listActivityMedia(activityId)`, assert the query filters by active trip id and `activity_id`.

- [x] **Step 7: Write Supabase rollup test**

Add a test where:

- destination media rows have `activity_id: null`
- activity media rows have `activity_id` set
- activities are ordered `[bakery, louvre]`

Assert rollup order:

```ts
expect(rollup.map((item) => ({
  ownerType: item.ownerType,
  activityTitle: item.activityTitle,
  canReorder: item.canReorderInStopCarousel,
}))).toEqual([
  { ownerType: 'destination', activityTitle: undefined, canReorder: true },
  { ownerType: 'activity', activityTitle: 'Bakery crawl', canReorder: false },
  { ownerType: 'activity', activityTitle: 'Louvre', canReorder: false },
]);
```

- [x] **Step 8: Implement Supabase owner-aware methods**

In `src/storage/supabaseTripRepository.ts`:

- Add `activity_id: string | null` to `SupabaseMediaAssetRow`.
- Update destination media queries with `.is('activity_id', null)`.
- Add `listActivityMedia`, `uploadActivityMedia`, `updateActivityMedia`, `deleteActivityMedia`, and `reorderActivityMedia`.
- Add `listDestinationMediaRollup`.
- Keep signed URL creation through `createSignedMediaItem(row)` so thumbnail, preview, and full URLs remain available.
- Use two-phase temporary sort orders for `reorderActivityMedia`, matching `reorderDestinationMedia`.

- [x] **Step 9: Run repository tests**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts
```

Expected: PASS.

- [x] **Step 10: Commit repository work**

Run:

```bash
git add src/storage/tripDb.ts src/storage/tripRepository.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts
git commit -m "feat: add activity media repositories"
```

---

### Task 3: Generalize Media Loading Hooks

**Files:**
- Create: `src/hooks/useOwnedMedia.ts`
- Modify: `src/hooks/useDestinationMedia.ts`
- Create: `src/hooks/useActivityMedia.ts`
- Test: `src/hooks/useOwnedMedia.test.tsx`
- Test: `src/hooks/useActivityMedia.test.tsx`

- [x] **Step 1: Create owner hook types**

Create `src/hooks/useOwnedMedia.ts` with these public types:

```ts
import type { MediaItem } from '../domain/types';

type MediaPatch = Pick<Partial<MediaItem>, 'caption' | 'credit'>;

export type OwnedMediaRepository = {
  list(): Promise<MediaItem[]>;
  upload(file: File): Promise<MediaItem>;
  update(mediaId: string, patch: MediaPatch): Promise<MediaItem>;
  delete(mediaId: string): Promise<void>;
  reorder(orderedMediaIds: string[]): Promise<MediaItem[]>;
};

export type UseOwnedMediaInput = {
  ownerId: string | null;
  repository: OwnedMediaRepository;
  migrationErrorNeedle?: string;
};
```

- [x] **Step 2: Move current hook behavior into `useOwnedMedia`**

Move the existing behavior from `useDestinationMedia` into `useOwnedMedia(input)`:

- image MIME filtering
- `normalizeImageFile(file)` before upload
- generation guards
- stale update guards
- optimistic reorder and rollback
- exact-order validation
- friendly migration error handling

The returned shape should match the current `useDestinationMedia` return shape:

```ts
{
  mediaItems,
  isLoading,
  isUploading,
  error,
  reload,
  uploadFiles,
  updateMedia,
  deleteMedia,
  reorder,
}
```

- [x] **Step 3: Wrap destination media**

Replace `useDestinationMedia` internals with:

```ts
export function useDestinationMedia(repository: TripRepository, destinationId: string | null) {
  return useOwnedMedia({
    ownerId: destinationId,
    repository: {
      list: () => destinationId ? repository.listDestinationMedia(destinationId) : Promise.resolve([]),
      upload: (file) => {
        if (!destinationId) throw new Error('Select a stop before uploading images.');
        return repository.uploadDestinationMedia({ destinationId, file });
      },
      update: (mediaId, patch) => repository.updateDestinationMedia(mediaId, patch),
      delete: (mediaId) => repository.deleteDestinationMedia(mediaId),
      reorder: (orderedMediaIds) => {
        if (!destinationId) return Promise.resolve([]);
        return repository.reorderDestinationMedia(destinationId, orderedMediaIds);
      },
    },
    migrationErrorNeedle: 'media_assets.sort_order',
  });
}
```

- [x] **Step 4: Add activity media hook**

Create `src/hooks/useActivityMedia.ts`:

```ts
import type { TripRepository } from '../storage/tripRepository';
import { useOwnedMedia } from './useOwnedMedia';

export function useActivityMedia(
  repository: TripRepository,
  destinationId: string | null,
  activityId: string | null,
) {
  return useOwnedMedia({
    ownerId: activityId,
    repository: {
      list: () => activityId ? repository.listActivityMedia(activityId) : Promise.resolve([]),
      upload: (file) => {
        if (!destinationId || !activityId) {
          throw new Error('Select an activity before uploading images.');
        }
        return repository.uploadActivityMedia({ destinationId, activityId, file });
      },
      update: (mediaId, patch) => repository.updateActivityMedia(mediaId, patch),
      delete: (mediaId) => repository.deleteActivityMedia(mediaId),
      reorder: (orderedMediaIds) => {
        if (!activityId) return Promise.resolve([]);
        return repository.reorderActivityMedia(activityId, orderedMediaIds);
      },
    },
    migrationErrorNeedle: 'media_assets.activity_id',
  });
}
```

- [x] **Step 5: Add hook tests**

Move the current `useDestinationMedia` behavioral tests to `useOwnedMedia.test.tsx`. Keep one wrapper test in `useDestinationMedia.test.tsx` proving it calls destination methods, and add `useActivityMedia.test.tsx` proving it calls:

```ts
repository.listActivityMedia(activityId);
repository.uploadActivityMedia({ destinationId, activityId, file: normalizedFile });
repository.reorderActivityMedia(activityId, orderedMediaIds);
```

- [x] **Step 6: Run hook tests**

Run:

```bash
npm test -- src/hooks/useOwnedMedia.test.tsx src/hooks/useDestinationMedia.test.tsx src/hooks/useActivityMedia.test.tsx
```

Expected: PASS.

- [x] **Step 7: Commit hook generalization**

Run:

```bash
git add src/hooks/useOwnedMedia.ts src/hooks/useOwnedMedia.test.tsx src/hooks/useDestinationMedia.ts src/hooks/useDestinationMedia.test.tsx src/hooks/useActivityMedia.ts src/hooks/useActivityMedia.test.tsx
git commit -m "refactor: share owned media hook"
```

---

### Task 4: Generalize The Media Strip Components

**Files:**
- Create: `src/components/MediaImageStrip.tsx`
- Modify: `src/components/DestinationImageStrip.tsx`
- Create: `src/components/ActivityImageStrip.tsx`
- Modify: `src/components/DestinationImagePreviewModal.tsx`
- Test: `src/components/MediaImageStrip.test.tsx`
- Test: `src/components/DestinationImageStrip.test.tsx`
- Test: `src/components/ActivityImageStrip.test.tsx`
- Test: `src/components/DestinationImagePreviewModal.test.tsx`

- [x] **Step 1: Create reusable media strip props**

Create `src/components/MediaImageStrip.tsx` with:

```ts
import type { MediaItem } from '../domain/types';

export type MediaStripItem = {
  mediaItem: MediaItem;
  attribution?: string;
  canReorder: boolean;
};

export type MediaImageStripProps = {
  regionLabel: string;
  emptyLabel: string;
  emptyHint: string;
  chooseFilesLabel: string;
  uploadingLabel: string;
  items: MediaStripItem[];
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  onUploadFiles: (files: File[]) => Promise<void> | void;
  onReorder: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenPreview: (mediaId: string) => void;
};
```

- [x] **Step 2: Move preview-first strip behavior**

Move the current `DestinationImageStrip` behavior into `MediaImageStrip`:

- empty upload target
- file drag depth handling
- thumbnail drag/drop
- thumbnail click selects in-panel preview
- preview previous/next buttons
- large preview opens full-screen modal
- `thumbnailUrl` and `previewUrl` selection

Change reorder handling so it only calls `onReorder` when both the dragged item and target item have `canReorder: true`.

- [x] **Step 3: Keep destination wrapper**

Replace `DestinationImageStrip` implementation with:

```tsx
import type { MediaItem } from '../domain/types';
import { MediaImageStrip } from './MediaImageStrip';

export function DestinationImageStrip(props: DestinationImageStripProps) {
  return (
    <MediaImageStrip
      regionLabel="Stop images"
      emptyLabel="No images yet"
      emptyHint="Drop images here or click to add."
      chooseFilesLabel="Choose stop images"
      uploadingLabel="Uploading stop images"
      items={props.mediaItems.map((mediaItem) => ({
        mediaItem,
        canReorder: true,
      }))}
      isLoading={props.isLoading}
      isUploading={props.isUploading}
      error={props.error}
      onUploadFiles={props.onUploadFiles}
      onReorder={props.onReorder}
      onOpenPreview={props.onOpenPreview}
    />
  );
}
```

Keep the existing exported prop type so current consumers do not churn.

- [x] **Step 4: Add activity wrapper**

Create `ActivityImageStrip` with the same wrapper pattern and labels:

```tsx
<MediaImageStrip
  regionLabel="Activity images"
  emptyLabel="No activity images yet"
  emptyHint="Drop images here or click to add."
  chooseFilesLabel="Choose activity images"
  uploadingLabel="Uploading activity images"
  items={mediaItems.map((mediaItem) => ({ mediaItem, canReorder: true }))}
  ...
/>
```

- [x] **Step 5: Add rollup item support**

When `DestinationImageStrip` receives rollup items in a later task, it should pass:

```ts
{
  mediaItem: rollupItem.mediaItem,
  attribution: rollupItem.activityTitle,
  canReorder: rollupItem.canReorderInStopCarousel,
}
```

Render attribution as compact visible text on activity-owned thumbnails and the selected preview.

- [x] **Step 6: Generalize modal labels**

In `DestinationImagePreviewModal`, add optional props:

```ts
imageFallbackAlt?: string;
activityAttribution?: string;
onOpenActivity?: () => void;
```

Use `imageFallbackAlt ?? 'Reference image'` when there is no caption. Render an `Open activity` button only when both `activityAttribution` and `onOpenActivity` are provided.

- [x] **Step 7: Run component tests**

Run:

```bash
npm test -- src/components/MediaImageStrip.test.tsx src/components/DestinationImageStrip.test.tsx src/components/ActivityImageStrip.test.tsx src/components/DestinationImagePreviewModal.test.tsx
```

Expected: PASS.

- [x] **Step 8: Commit component generalization**

Run:

```bash
git add src/components/MediaImageStrip.tsx src/components/MediaImageStrip.test.tsx src/components/DestinationImageStrip.tsx src/components/DestinationImageStrip.test.tsx src/components/ActivityImageStrip.tsx src/components/ActivityImageStrip.test.tsx src/components/DestinationImagePreviewModal.tsx src/components/DestinationImagePreviewModal.test.tsx src/styles.css
git commit -m "refactor: share media image strip"
```

---

### Task 5: Add Activity Panel And Stop Rollup Wiring

**Files:**
- Create: `src/components/ActivityPanel.tsx`
- Test: `src/components/ActivityPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Create `ActivityPanel` props**

Create `src/components/ActivityPanel.tsx` with:

```ts
import type { Activity, MediaItem } from '../domain/types';

type ActivityPanelProps = {
  activity: Activity;
  mediaItems: MediaItem[];
  mediaError: string | null;
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  onClose: () => void;
  onUpdateActivity: (activityId: string, patch: Partial<Pick<Activity, 'title' | 'description' | 'notes' | 'status' | 'priority'>>) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
};
```

- [x] **Step 2: Render basic rich activity fields**

The first activity panel should include:

- title input
- status select
- priority select
- description textarea
- notes textarea
- `ActivityImageStrip`
- close button

Use the existing stop profile save style: local drafts, save on blur, and accessible alert text when an update fails.

- [x] **Step 3: Add activity panel tests**

In `ActivityPanel.test.tsx`, cover:

```ts
expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
expect(screen.getByRole('region', { name: 'Activity images' })).toBeInTheDocument();
fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
fireEvent.blur(screen.getByLabelText('Activity title'));
expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, { title: 'Morning Louvre' });
```

- [x] **Step 4: Load selected activity media in `App`**

In `src/App.tsx`:

- derive `selectedActivity`
- call `useActivityMedia(repository, selectedDestination?.id ?? null, selectedActivityId)`
- pass activity media handlers into `ActivityPanel`
- clear selected activity when selected destination closes or changes

- [x] **Step 5: Load stop rollup media in `App`**

Replace the stop panel's displayed media source with rollup media:

- use destination-owned list for destination media mutations
- use `listDestinationMediaRollup(destinationId)` for the stop carousel display
- pass activity-owned rollup attribution into `DestinationImageStrip`
- keep destination-owned reorder limited to destination-owned thumbnails

- [x] **Step 6: Render side-by-side panels**

Update the app shell markup so the selected activity panel renders immediately to the left of the stop panel:

```tsx
<div className="workspace-panels">
  {selectedActivity ? <ActivityPanel ... /> : null}
  {selectedDestination ? <DestinationProfile ... /> : null}
</div>
```

On narrow screens, stack the activity panel above the stop panel.

- [x] **Step 7: Add app-level tests**

In `src/App.test.tsx`, add tests that cover:

- selecting an activity opens `ActivityPanel`
- activity panel media upload calls `uploadActivityMedia`
- stop image rollup shows activity attribution
- clicking an activity-owned rollup image opens the modal without calling `reorderDestinationMedia`
- modal previous/next does not reorder images

- [x] **Step 8: Run app and component tests**

Run:

```bash
npm test -- src/components/ActivityPanel.test.tsx src/components/DestinationProfile.test.tsx src/App.test.tsx
```

Expected: PASS.

- [x] **Step 9: Commit panel wiring**

Run:

```bash
git add src/components/ActivityPanel.tsx src/components/ActivityPanel.test.tsx src/App.tsx src/App.test.tsx src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx src/styles.css
git commit -m "feat: add activity media panel"
```

---

### Task 6: Verify Browser Behavior And Supabase State

**Files:**
- Modify: `tests/world-tour.spec.ts`
- No source files unless verification exposes a bug.

- [ ] **Step 1: Add e2e smoke coverage**

In `tests/world-tour.spec.ts`, add an e2e-local smoke test that:

- creates or selects a stop
- adds an activity
- selects the activity
- verifies the activity panel opens beside the stop panel
- verifies the activity image region exists

Use `VITE_TRIP_STORAGE=e2e-local` through the existing `npm run test:e2e` setup.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected:

- Vitest passes.
- ESLint passes.
- Build passes, allowing the existing Vite large-chunk warning.
- Playwright e2e passes.

- [ ] **Step 3: Verify remote migration visibility**

After applying the migration to the linked project, run:

```bash
npx supabase db push --linked --dry-run
set -a; source .env; set +a; curl -sS -i "$VITE_SUPABASE_URL/rest/v1/media_assets?select=id,activity_id&limit=1" -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY"
```

Expected:

- Dry run says `Remote database is up to date.`
- REST request returns `HTTP/2 200`.

- [ ] **Step 4: Commit e2e coverage**

Run:

```bash
git add tests/world-tour.spec.ts
git commit -m "test: cover activity media panel smoke flow"
```

## Plan Self-Review

- Spec coverage: this plan covers activity-owned media, stop rollup ordering, activity attribution, current preview-first image behavior, repository owner filters, local and Supabase storage, activity panel layout, and browser verification.
- Placeholder scan: this plan uses concrete file paths, commands, SQL, type signatures, and expected results. It does not contain placeholder markers.
- Type consistency: `MediaItem`, `MediaRollupItem`, `ActivityMediaRecord`, `useOwnedMedia`, `useActivityMedia`, and repository method names are used consistently across tasks.
