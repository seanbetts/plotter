# Stop Reference Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stop-level reference images to the stop detail pane with a hero image, reorderable thumbnail carousel, drag/drop upload, preview modal, caption/credit editing, and Supabase persistence.

**Architecture:** Store images as `media_assets` rows backed by private Supabase Storage objects. Add a media-focused repository surface, a `useDestinationMedia` hook in the app layer, and two focused UI components: `DestinationImageStrip` and `DestinationImagePreviewModal`. The first ordered media item is always the hero image.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Supabase Postgres + Storage, existing CSS in `src/styles.css`.

---

## File Structure

- Modify `supabase/migrations/*`: add `media_assets.sort_order`.
- Modify `src/domain/types.ts`: add `MediaItem.sortOrder`.
- Modify `src/storage/tripRepository.ts`: extend `TripRepository` media methods and local fallback behavior used by tests.
- Modify `src/storage/supabaseTripRepository.ts`: implement ordered listing, metadata update, delete, and reorder.
- Modify `src/storage/supabaseTripRepository.test.ts`: repository coverage for sort order and mutation methods.
- Create `src/hooks/useDestinationMedia.ts`: load and mutate media for one selected destination.
- Create `src/hooks/useDestinationMedia.test.tsx`: hook tests for load/upload/update/delete/reorder state.
- Create `src/components/DestinationImageStrip.tsx`: hero image, carousel, add tile, drag/drop upload, direct drag reorder.
- Create `src/components/DestinationImageStrip.test.tsx`: component tests for empty, upload, drop, open modal, drag reorder.
- Create `src/components/DestinationImagePreviewModal.tsx`: dialog for preview, caption/credit autosave, delete, move fallback.
- Create `src/components/DestinationImagePreviewModal.test.tsx`: modal tests.
- Modify `src/components/DestinationProfile.tsx`: render image area below header and pass image props through.
- Modify `src/components/DestinationProfile.test.tsx`: integration expectations.
- Modify `src/App.tsx`: connect `useDestinationMedia` to selected destination and repository.
- Modify `src/App.test.tsx`: app-level smoke around media loading not blocking the pane.
- Modify `src/styles.css`: style the image area, carousel, drag states, modal, and accessible status.
- Modify `tests/world-tour.spec.ts`: add a minimal e2e check if file upload is practical in Playwright.

---

### Task 1: Add Media Ordering To Schema And Types

**Files:**
- Create via CLI: `npx supabase migration new add_media_sort_order`
- Modify: `src/domain/types.ts`
- Test: `src/storage/supabaseTripRepository.test.ts`

- [ ] **Step 1: Create the migration file**

Run:

```bash
npx supabase migration new add_media_sort_order
```

Expected: Supabase CLI prints the generated migration path under `supabase/migrations/`.

- [ ] **Step 2: Write the migration SQL**

Put this SQL in the generated migration file:

```sql
alter table public.media_assets
add column if not exists sort_order integer;

with ranked_media as (
  select
    id,
    row_number() over (
      partition by trip_id, destination_id
      order by created_at asc, id asc
    ) - 1 as next_sort_order
  from public.media_assets
)
update public.media_assets
set sort_order = ranked_media.next_sort_order
from ranked_media
where public.media_assets.id = ranked_media.id
  and public.media_assets.sort_order is null;

alter table public.media_assets
alter column sort_order set not null;

alter table public.media_assets
alter column sort_order drop default;

create unique index if not exists media_assets_trip_destination_sort_order_key
on public.media_assets(trip_id, destination_id, sort_order)
where destination_id is not null;
```

- [ ] **Step 3: Write the failing mapper test**

Add `sort_order` to the media row fixture in `src/storage/supabaseTripRepository.test.ts` and assert it maps to `sortOrder`:

```ts
expect(mediaAssetFromSupabaseRow(row, 'https://signed.example/asset.webp')).toEqual(
  expect.objectContaining({
    id: row.id,
    url: 'https://signed.example/asset.webp',
    sortOrder: 2,
  }),
);
```

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: FAIL because `MediaItem.sortOrder` and mapper support do not exist yet.

- [ ] **Step 4: Add the TypeScript field**

Modify `src/domain/types.ts`:

```ts
export type MediaItem = {
  id: string;
  url: string;
  caption: string;
  credit: string;
  bucketId?: string;
  objectPath?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  sortOrder?: number;
};
```

- [ ] **Step 5: Map sort order from Supabase**

Modify `SupabaseMediaAssetRow` and `mediaAssetFromSupabaseRow` in `src/storage/supabaseTripRepository.ts`:

```ts
type SupabaseMediaAssetRow = {
  id: string;
  trip_id: string;
  destination_id: string | null;
  bucket_id: string;
  object_path: string;
  caption: string;
  credit: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export function mediaAssetFromSupabaseRow(row: SupabaseMediaAssetRow, signedUrl: string): MediaItem {
  return {
    id: row.id,
    url: signedUrl,
    caption: row.caption,
    credit: row.credit,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
    contentType: row.content_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    uploadedAt: row.created_at,
    sortOrder: row.sort_order,
  };
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
npm run build
```

Expected: tests and build pass.

Commit:

```bash
git add supabase/migrations src/domain/types.ts src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts
git commit -m "feat: add media asset ordering"
```

---

### Task 2: Complete Media Repository API

**Files:**
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`
- Modify test helpers in `src/App.test.tsx`, `src/hooks/useTripData.test.tsx`, and any TypeScript failures.

- [ ] **Step 1: Extend the repository interface**

Modify `TripRepository` in `src/storage/tripRepository.ts`:

```ts
updateDestinationMedia(
  mediaId: string,
  patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
): Promise<MediaItem>;

deleteDestinationMedia(mediaId: string): Promise<void>;

reorderDestinationMedia(destinationId: string, orderedMediaIds: string[]): Promise<MediaItem[]>;
```

Run:

```bash
npm run build
```

Expected: FAIL because implementations and mocks do not yet include the new methods.

- [ ] **Step 2: Write Supabase tests for ordered listing and upload sort order**

In `src/storage/supabaseTripRepository.test.ts`, update the existing media tests:

```ts
expect(mediaInsert).toHaveBeenCalledWith(
  expect.objectContaining({
    sort_order: 0,
  }),
);
```

Update the list query expectation so it orders by `sort_order` before `created_at`:

```ts
expect(mediaAssetsOrder).toHaveBeenCalledWith('sort_order', { ascending: true });
```

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: FAIL because `sort_order` is not inserted and listing still orders by `created_at`.

- [ ] **Step 3: Write Supabase tests for update, delete, and reorder**

Add tests with this shape:

```ts
it('updates destination media caption and credit without changing storage fields', async () => {
  const mediaId = crypto.randomUUID();
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: mediaRow, error: null })),
      })),
    })),
  }));

  const repository = createSupabaseTripRepository(supabase as never);

  await repository.updateDestinationMedia(mediaId, { caption: 'New caption', credit: 'Example photographer' });

  expect(update).toHaveBeenCalledWith({
    caption: 'New caption',
    credit: 'Example photographer',
  });
});

it('deletes destination media metadata after removing the storage object', async () => {
  await repository.deleteDestinationMedia(mediaId);

  expect(remove).toHaveBeenCalledWith([mediaRow.object_path]);
  expect(deleteMetadata).toHaveBeenCalled();
});

it('reorders destination media by updating sort_order for the selected destination', async () => {
  await repository.reorderDestinationMedia(destinationId, [third.id, first.id, second.id]);

  expect(updateSortOrder).toHaveBeenCalledWith({ sort_order: 0 });
  expect(updateSortOrder).toHaveBeenCalledWith({ sort_order: 1 });
  expect(updateSortOrder).toHaveBeenCalledWith({ sort_order: 2 });
});
```

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: FAIL because the methods do not exist.

- [ ] **Step 4: Implement Supabase repository methods**

In `src/storage/supabaseTripRepository.ts`, add helper functions:

```ts
async function createSignedMediaItem(row: SupabaseMediaAssetRow) {
  const signedUrlResponse = await supabase.storage
    .from(row.bucket_id)
    .createSignedUrl(row.object_path, 60 * 60);
  const signedUrl = assertNoSupabaseError(
    signedUrlResponse,
    'Unable to create media URL.',
  ).signedUrl;

  return mediaAssetFromSupabaseRow(row, signedUrl);
}

async function listMediaRowsForDestination(tripId: string, destinationId: string) {
  return assertNoSupabaseError<SupabaseMediaAssetRow[]>(
    await supabase
      .from('media_assets')
      .select('*')
      .eq('trip_id', tripId)
      .eq('destination_id', destinationId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    'Unable to load destination media.',
  );
}
```

Update upload to assign the next sort order:

```ts
const existingRows = await listMediaRowsForDestination(tripId, input.destinationId);
const sortOrder = existingRows.length;

// inside insert payload
sort_order: sortOrder,
```

Add the new methods:

```ts
async updateDestinationMedia(mediaId, patch) {
  const tripId = await getActiveTripId();
  const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
    await supabase
      .from('media_assets')
      .update({
        caption: patch.caption ?? '',
        credit: patch.credit ?? '',
      })
      .eq('trip_id', tripId)
      .eq('id', mediaId)
      .select('*')
      .single(),
    'Unable to update media metadata.',
  );

  return createSignedMediaItem(row);
},

async deleteDestinationMedia(mediaId) {
  const tripId = await getActiveTripId();
  const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
    await supabase
      .from('media_assets')
      .select('*')
      .eq('trip_id', tripId)
      .eq('id', mediaId)
      .single(),
    'Unable to load media before delete.',
  );

  assertSupabaseWriteSucceeded(
    await supabase.storage.from(row.bucket_id).remove([row.object_path]),
    'Unable to delete media file.',
  );
  assertSupabaseWriteSucceeded(
    await supabase.from('media_assets').delete().eq('trip_id', tripId).eq('id', mediaId),
    'Unable to delete media metadata.',
  );
},

async reorderDestinationMedia(destinationId, orderedMediaIds) {
  const tripId = await getActiveTripId();

  await Promise.all(
    orderedMediaIds.map((mediaId, sortOrder) =>
      supabase
        .from('media_assets')
        .update({ sort_order: sortOrder })
        .eq('trip_id', tripId)
        .eq('destination_id', destinationId)
        .eq('id', mediaId),
    ),
  );

  const rows = await listMediaRowsForDestination(tripId, destinationId);
  return Promise.all(rows.map(createSignedMediaItem));
},
```

- [ ] **Step 5: Implement local test repository methods**

In `src/storage/tripRepository.ts`, implement local media methods against `destination.media` so tests and dev fallbacks remain coherent:

```ts
async updateDestinationMedia(mediaId, patch) {
  const destinations = await db.destinations.toArray();
  const destination = destinations.find((item) => item.media.some((media) => media.id === mediaId));
  if (!destination) throw new Error('Media not found.');

  const media = destination.media.find((item) => item.id === mediaId)!;
  const updatedMedia = { ...media, ...patch };
  const nextMedia = destination.media.map((item) => (item.id === mediaId ? updatedMedia : item));
  await db.destinations.put({ ...destination, media: nextMedia, updatedAt: new Date().toISOString() });

  return updatedMedia;
}
```

Add analogous `deleteDestinationMedia` and `reorderDestinationMedia` methods.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts
npm run build
```

Expected: tests and build pass.

Commit:

```bash
git add src/storage src/domain/types.ts src/App.test.tsx src/hooks/useTripData.test.tsx
git commit -m "feat: complete destination media repository"
```

---

### Task 3: Add `useDestinationMedia` Hook

**Files:**
- Create: `src/hooks/useDestinationMedia.ts`
- Create: `src/hooks/useDestinationMedia.test.tsx`

- [ ] **Step 1: Write hook tests**

Create `src/hooks/useDestinationMedia.test.tsx`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';
import { useDestinationMedia } from './useDestinationMedia';

const media = (id: string, sortOrder: number): MediaItem => ({
  id,
  url: `https://example.com/${id}.jpg`,
  caption: '',
  credit: '',
  sortOrder,
});

function createRepository(overrides: Partial<TripRepository> = {}): TripRepository {
  return {
    listDestinations: vi.fn(),
    saveDestination: vi.fn(),
    deleteDestination: vi.fn(),
    listDestinationMedia: vi.fn(async () => [media('a', 0)]),
    uploadDestinationMedia: vi.fn(async () => media('b', 1)),
    updateDestinationMedia: vi.fn(async (_id, patch) => ({ ...media('a', 0), ...patch })),
    deleteDestinationMedia: vi.fn(),
    reorderDestinationMedia: vi.fn(async () => [media('b', 0), media('a', 1)]),
    listRouteLegs: vi.fn(),
    saveRouteLeg: vi.fn(),
    deleteRouteLeg: vi.fn(),
    replaceTripData: vi.fn(),
    ...overrides,
  };
}

describe('useDestinationMedia', () => {
  it('loads media for the selected destination', async () => {
    const repository = createRepository();
    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(repository.listDestinationMedia).toHaveBeenCalledWith('destination-1');
    expect(result.current.mediaItems).toHaveLength(1);
  });

  it('uploads images and appends them to the list', async () => {
    const repository = createRepository();
    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.uploadFiles([new File(['data'], 'balcombe.jpg', { type: 'image/jpeg' })]);
    });

    expect(repository.uploadDestinationMedia).toHaveBeenCalled();
    expect(result.current.mediaItems.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('restores previous order when reorder fails', async () => {
    const repository = createRepository({
      reorderDestinationMedia: vi.fn(async () => {
        throw new Error('Nope');
      }),
    });
    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reorder(['b', 'a']);
    });

    expect(result.current.mediaItems.map((item) => item.id)).toEqual(['a']);
    expect(result.current.error).toBe('Nope');
  });
});
```

Run:

```bash
npm test -- src/hooks/useDestinationMedia.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 2: Implement the hook**

Create `src/hooks/useDestinationMedia.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function useDestinationMedia(repository: TripRepository, destinationId: string | null) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    if (!destinationId) {
      setMediaItems([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    void repository
      .listDestinationMedia(destinationId)
      .then((items) => {
        if (requestRef.current !== requestId) return;
        setMediaItems(items);
      })
      .catch((caught) => {
        if (requestRef.current !== requestId) return;
        setError(caught instanceof Error ? caught.message : 'Unable to load images');
      })
      .finally(() => {
        if (requestRef.current === requestId) setIsLoading(false);
      });
  }, [destinationId, repository]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!destinationId) return;
      const imageFiles = files.filter((file) => allowedImageTypes.has(file.type));
      if (imageFiles.length === 0) {
        setError('Choose a JPEG, PNG, WebP, or GIF image.');
        return;
      }

      setIsUploading(true);
      setError(null);
      try {
        const uploaded = [];
        for (const file of imageFiles) {
          uploaded.push(await repository.uploadDestinationMedia({ destinationId, file }));
        }
        setMediaItems((current) => [...current, ...uploaded]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to upload image');
      } finally {
        setIsUploading(false);
      }
    },
    [destinationId, repository],
  );

  const updateMedia = useCallback(
    async (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => {
      const updated = await repository.updateDestinationMedia(mediaId, patch);
      setMediaItems((current) => current.map((item) => (item.id === mediaId ? updated : item)));
      return updated;
    },
    [repository],
  );

  const deleteMedia = useCallback(
    async (mediaId: string) => {
      await repository.deleteDestinationMedia(mediaId);
      setMediaItems((current) => current.filter((item) => item.id !== mediaId));
    },
    [repository],
  );

  const reorder = useCallback(
    async (orderedMediaIds: string[]) => {
      if (!destinationId) return;
      const previous = mediaItems;
      const byId = new Map(previous.map((item) => [item.id, item]));
      setMediaItems(orderedMediaIds.map((id, index) => ({ ...byId.get(id)!, sortOrder: index })));
      try {
        setMediaItems(await repository.reorderDestinationMedia(destinationId, orderedMediaIds));
      } catch (caught) {
        setMediaItems(previous);
        setError(caught instanceof Error ? caught.message : 'Unable to reorder images');
      }
    },
    [destinationId, mediaItems, repository],
  );

  return useMemo(
    () => ({
      mediaItems,
      isLoading,
      isUploading,
      error,
      uploadFiles,
      updateMedia,
      deleteMedia,
      reorder,
      clearError: () => setError(null),
    }),
    [deleteMedia, error, isLoading, isUploading, mediaItems, reorder, updateMedia, uploadFiles],
  );
}
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- src/hooks/useDestinationMedia.test.tsx
npm run build
```

Expected: tests and build pass.

Commit:

```bash
git add src/hooks/useDestinationMedia.ts src/hooks/useDestinationMedia.test.tsx
git commit -m "feat: add destination media hook"
```

---

### Task 4: Build `DestinationImagePreviewModal`

**Files:**
- Create: `src/components/DestinationImagePreviewModal.tsx`
- Create: `src/components/DestinationImagePreviewModal.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write modal tests**

Create tests for render, autosave caption/credit, delete, move controls, and Escape:

```ts
it('autosaves caption and credit after a debounce', async () => {
  vi.useFakeTimers();
  const media = createMedia('a');
  const onUpdate = vi.fn(async () => ({ ...media, caption: 'Village', credit: 'Example photographer' }));

  render(
    <DestinationImagePreviewModal
      mediaItem={media}
      canMoveLeft={false}
      canMoveRight
      onUpdate={onUpdate}
      onDelete={vi.fn()}
      onMoveLeft={vi.fn()}
      onMoveRight={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Village' } });
  fireEvent.change(screen.getByLabelText('Credit'), { target: { value: 'Example photographer' } });
  expect(onUpdate).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTime(700));

  expect(onUpdate).toHaveBeenCalledWith(media.id, { caption: 'Village', credit: 'Example photographer' });
});
```

Run:

```bash
npm test -- src/components/DestinationImagePreviewModal.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the modal component**

Create `src/components/DestinationImagePreviewModal.tsx` with this public shape:

```ts
type DestinationImagePreviewModalProps = {
  mediaItem: MediaItem;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onUpdate: (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => Promise<MediaItem> | MediaItem;
  onDelete: (mediaId: string) => Promise<void> | void;
  onMoveLeft: (mediaId: string) => Promise<void> | void;
  onMoveRight: (mediaId: string) => Promise<void> | void;
  onClose: () => void;
};
```

Implement:

```tsx
<div className="image-preview-backdrop" role="presentation">
  <section
    className="image-preview-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Image preview"
  >
    <button type="button" aria-label="Close image preview" onClick={onClose}>
      <X size={18} aria-hidden="true" />
    </button>
    <img src={mediaItem.url} alt={mediaItem.caption || 'Stop reference'} />
    <label>
      Caption
      <input value={caption} onChange={(event) => setCaption(event.target.value)} />
    </label>
    <label>
      Credit
      <input value={credit} onChange={(event) => setCredit(event.target.value)} />
    </label>
    <button type="button" disabled={!canMoveLeft} onClick={() => void onMoveLeft(mediaItem.id)}>Move left</button>
    <button type="button" disabled={!canMoveRight} onClick={() => void onMoveRight(mediaItem.id)}>Move right</button>
    <button type="button" onClick={() => void onDelete(mediaItem.id)}>Delete image</button>
  </section>
</div>
```

Use a 700ms debounce for caption/credit autosave and an `aria-live` save status matching the stop detail pane: `Saving...`, `Saved`, `Unable to save`.

- [ ] **Step 3: Add modal styles**

Add CSS:

```css
.image-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(24 30 34 / 0.42);
}

.image-preview-modal {
  display: grid;
  width: min(720px, 100%);
  max-height: calc(100dvh - 48px);
  overflow: auto;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-overlay-strong);
  box-shadow: var(--shadow-panel);
}

.image-preview-modal img {
  width: 100%;
  max-height: 58vh;
  object-fit: contain;
  border-radius: var(--radius-panel);
  background: var(--surface-control);
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- src/components/DestinationImagePreviewModal.test.tsx
npm run build
```

Expected: tests and build pass.

Commit:

```bash
git add src/components/DestinationImagePreviewModal.tsx src/components/DestinationImagePreviewModal.test.tsx src/styles.css
git commit -m "feat: add image preview modal"
```

---

### Task 5: Build `DestinationImageStrip`

**Files:**
- Create: `src/components/DestinationImageStrip.tsx`
- Create: `src/components/DestinationImageStrip.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write strip tests**

Create tests covering empty state, file picker upload, drop upload, thumbnail open, and drag reorder:

```ts
it('shows a hero image from the first media item and opens preview on click', async () => {
  const mediaItems = [createMedia('hero', 0), createMedia('second', 1)];
  const onOpenPreview = vi.fn();

  render(
    <DestinationImageStrip
      destinationName="Balcombe"
      mediaItems={mediaItems}
      isLoading={false}
      isUploading={false}
      error={null}
      onUploadFiles={vi.fn()}
      onReorder={vi.fn()}
      onOpenPreview={onOpenPreview}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Open image Balcombe reference image 1' }));

  expect(screen.getByRole('img', { name: 'Balcombe reference image 1' })).toHaveAttribute('src', mediaItems[0].url);
  expect(onOpenPreview).toHaveBeenCalledWith(mediaItems[0].id);
});

it('uploads dropped image files', async () => {
  const onUploadFiles = vi.fn();
  render(
    <DestinationImageStrip
      destinationName="Balcombe"
      mediaItems={[]}
      isLoading={false}
      isUploading={false}
      error={null}
      onUploadFiles={onUploadFiles}
      onReorder={vi.fn()}
      onOpenPreview={vi.fn()}
    />,
  );

  fireEvent.drop(screen.getByLabelText('Stop images'), {
    dataTransfer: {
      files: [new File(['data'], 'image.jpg', { type: 'image/jpeg' })],
    },
  });

  expect(onUploadFiles).toHaveBeenCalledWith([expect.any(File)]);
});

it('reorders thumbnails through direct drag', async () => {
  const onReorder = vi.fn();
  render(
    <DestinationImageStrip
      destinationName="Balcombe"
      mediaItems={[a, b, c]}
      isLoading={false}
      isUploading={false}
      error={null}
      onUploadFiles={vi.fn()}
      onReorder={onReorder}
      onOpenPreview={vi.fn()}
    />,
  );

  fireEvent.dragStart(screen.getByRole('button', { name: /image 1/i }));
  fireEvent.dragOver(screen.getByRole('button', { name: /image 3/i }));
  fireEvent.drop(screen.getByRole('button', { name: /image 3/i }));

  expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
});
```

Run:

```bash
npm test -- src/components/DestinationImageStrip.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement strip component**

Create `DestinationImageStrip.tsx` with this public shape:

```ts
type DestinationImageStripProps = {
  destinationName: string;
  mediaItems: MediaItem[];
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  onUploadFiles: (files: File[]) => Promise<void> | void;
  onReorder: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenPreview: (mediaId: string) => void;
};
```

Implementation details:

```tsx
const heroImage = mediaItems[0] ?? null;
const fileInputRef = useRef<HTMLInputElement | null>(null);
const draggedMediaIdRef = useRef<string | null>(null);

function handleFiles(files: FileList | File[]) {
  void onUploadFiles(Array.from(files));
}

function reorderMedia(draggedId: string, targetId: string) {
  const ids = mediaItems.map((item) => item.id);
  const draggedIndex = ids.indexOf(draggedId);
  const targetIndex = ids.indexOf(targetId);
  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

  const nextIds = [...ids];
  const [dragged] = nextIds.splice(draggedIndex, 1);
  nextIds.splice(targetIndex, 0, dragged);
  void onReorder(nextIds);
}
```

Render:

```tsx
<section
  className="destination-image-strip"
  aria-label="Stop images"
  onDragOver={(event) => event.preventDefault()}
  onDrop={(event) => {
    event.preventDefault();
    handleFiles(event.dataTransfer.files);
  }}
>
  {heroImage ? (
    <button type="button" className="destination-image-hero" onClick={() => onOpenPreview(heroImage.id)}>
      <img src={heroImage.url} alt={heroImage.caption || `${destinationName} reference image 1`} />
    </button>
  ) : (
    <button type="button" className="destination-image-empty" onClick={() => fileInputRef.current?.click()}>
      Add reference images
    </button>
  )}
  <div className="destination-image-carousel" role="list">
    {mediaItems.map((item, index) => (
      <button
        key={item.id}
        type="button"
        role="listitem"
        draggable
        aria-label={`Open image ${destinationName} reference image ${index + 1}`}
        onClick={() => onOpenPreview(item.id)}
        onDragStart={() => {
          draggedMediaIdRef.current = item.id;
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (draggedMediaIdRef.current) reorderMedia(draggedMediaIdRef.current, item.id);
          draggedMediaIdRef.current = null;
        }}
      >
        <img src={item.url} alt="" />
      </button>
    ))}
    <button type="button" className="destination-image-add" aria-label="Add reference images" onClick={() => fileInputRef.current?.click()}>
      <Plus size={18} aria-hidden="true" />
    </button>
  </div>
  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden />
</section>
```

- [ ] **Step 3: Add strip styles**

Add CSS:

```css
.destination-image-strip {
  display: grid;
  gap: 10px;
}

.destination-image-hero,
.destination-image-empty {
  display: grid;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-control);
}

.destination-image-hero img,
.destination-image-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.destination-image-carousel {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 72px;
  gap: 8px;
  overflow-x: auto;
}

.destination-image-thumbnail,
.destination-image-add {
  width: 72px;
  aspect-ratio: 1;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- src/components/DestinationImageStrip.test.tsx
npm run build
```

Expected: tests and build pass.

Commit:

```bash
git add src/components/DestinationImageStrip.tsx src/components/DestinationImageStrip.test.tsx src/styles.css
git commit -m "feat: add destination image strip"
```

---

### Task 6: Integrate Image UI Into Destination Profile And App

**Files:**
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Extend `DestinationProfile` props with media state**

Add a prop shape:

```ts
type DestinationMediaProps = {
  mediaItems: MediaItem[];
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  mediaError: string | null;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onUpdateMedia: (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => Promise<MediaItem> | MediaItem;
  onDeleteMedia: (mediaId: string) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
};
```

Merge it into `DestinationProfileProps`.

Run:

```bash
npm run build
```

Expected: FAIL because call sites do not pass the props.

- [ ] **Step 2: Add tests for profile rendering**

In `DestinationProfile.test.tsx`, add:

```ts
it('renders stop reference images below the header', () => {
  render(
    <DestinationProfile
      destination={destination}
      mediaItems={[mediaItem]}
      isMediaLoading={false}
      isMediaUploading={false}
      mediaError={null}
      onUploadMedia={vi.fn()}
      onUpdateMedia={vi.fn()}
      onDeleteMedia={vi.fn()}
      onReorderMedia={vi.fn()}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(screen.getByRole('region', { name: 'Stop images' })).toBeInTheDocument();
});
```

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx
```

Expected: FAIL until the profile renders `DestinationImageStrip`.

- [ ] **Step 3: Render strip and modal from `DestinationProfile`**

Inside `DestinationProfileForm`, add:

```tsx
const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
const previewMediaItem = mediaItems.find((item) => item.id === previewMediaId) ?? null;
const previewIndex = previewMediaItem
  ? mediaItems.findIndex((item) => item.id === previewMediaItem.id)
  : -1;

function movePreviewMedia(offset: -1 | 1) {
  if (!previewMediaItem) return;
  const ids = mediaItems.map((item) => item.id);
  const currentIndex = ids.indexOf(previewMediaItem.id);
  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= ids.length) return;

  const nextIds = [...ids];
  const [moved] = nextIds.splice(currentIndex, 1);
  nextIds.splice(targetIndex, 0, moved);
  void onReorderMedia(nextIds);
}
```

Place below `</header>`:

```tsx
<DestinationImageStrip
  destinationName={destination.name}
  mediaItems={mediaItems}
  isLoading={isMediaLoading}
  isUploading={isMediaUploading}
  error={mediaError}
  onUploadFiles={onUploadMedia}
  onReorder={onReorderMedia}
  onOpenPreview={setPreviewMediaId}
/>
```

Render modal:

```tsx
{previewMediaItem ? (
  <DestinationImagePreviewModal
    mediaItem={previewMediaItem}
    canMoveLeft={previewIndex > 0}
    canMoveRight={previewIndex >= 0 && previewIndex < mediaItems.length - 1}
    onUpdate={onUpdateMedia}
    onDelete={async (mediaId) => {
      await Promise.resolve(onDeleteMedia(mediaId));
      setPreviewMediaId(null);
    }}
    onMoveLeft={() => movePreviewMedia(-1)}
    onMoveRight={() => movePreviewMedia(1)}
    onClose={() => setPreviewMediaId(null)}
  />
) : null}
```

- [ ] **Step 4: Connect hook in `App.tsx`**

In `TripWorkspace`, call:

```ts
const destinationMedia = useDestinationMedia(repository, selectedDestinationId);
```

Pass to `DestinationProfile`:

```tsx
<DestinationProfile
  destination={selectedDestination}
  stopNumber={selectedDestinationNumber}
  mediaItems={destinationMedia.mediaItems}
  isMediaLoading={destinationMedia.isLoading}
  isMediaUploading={destinationMedia.isUploading}
  mediaError={destinationMedia.error}
  onUploadMedia={destinationMedia.uploadFiles}
  onUpdateMedia={destinationMedia.updateMedia}
  onDeleteMedia={destinationMedia.deleteMedia}
  onReorderMedia={destinationMedia.reorder}
  onUpdate={updateDestination}
  onClose={() => setSelectedDestinationId(null)}
/>
```

- [ ] **Step 5: Update tests and verify**

Update test render calls with default media props. Define a helper in `DestinationProfile.test.tsx`:

```ts
const mediaProps = {
  mediaItems: [],
  isMediaLoading: false,
  isMediaUploading: false,
  mediaError: null,
  onUploadMedia: vi.fn(),
  onUpdateMedia: vi.fn(),
  onDeleteMedia: vi.fn(),
  onReorderMedia: vi.fn(),
};
```

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx src/App.test.tsx
npm run build
```

Expected: tests and build pass.

Commit:

```bash
git add src/App.tsx src/App.test.tsx src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx
git commit -m "feat: wire reference images into stop details"
```

---

### Task 7: End-To-End And Supabase Verification

**Files:**
- Modify: `tests/world-tour.spec.ts`
- No schema files except the migration from Task 1.

- [ ] **Step 1: Add a focused e2e test if file upload is practical**

Use Playwright’s `setInputFiles` against the hidden file input if the control is reachable:

```ts
test('uploads a reference image for a stop', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Balcombe/ }).click();
  await page.getByLabel('Add reference images').setInputFiles({
    name: 'reference.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fake-image'),
  });

  await expect(page.getByRole('status')).toContainText(/uploaded|saved/i);
});
```

If the app cannot run against real Supabase in CI/e2e, skip this test with an explicit condition:

```ts
test.skip(!process.env.VITE_SUPABASE_URL, 'Supabase env is required for media upload e2e');
```

- [ ] **Step 2: Push the migration to Supabase**

Run:

```bash
npx supabase db push
```

Expected: migration applies successfully.

- [ ] **Step 3: Verify remote schema and bucket**

Run:

```bash
npx supabase db query --linked "select column_name, data_type, column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'media_assets' and column_name = 'sort_order';"
```

Expected: one row with `sort_order`, `integer`, a null/empty `column_default`, and `NO` for nullable.

Run:

```bash
npx supabase db query --linked "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'trip-media';"
```

Expected: bucket is private, has 50 MB limit, and allows JPEG/PNG/WebP/GIF.

- [ ] **Step 4: Full verification**

Run:

```bash
npm test
npm run build
npm run lint
```

Expected: all pass. The existing large bundle warning may still appear during build.

- [ ] **Step 5: Rendered smoke check**

Start or reuse the dev server:

```bash
npm run dev -- --port 5174
```

Use Playwright or the in-app browser to verify:

- Stop detail pane opens.
- Empty image area appears below the stop header.
- Drag/drop or file picker starts upload.
- Uploaded image becomes hero when it is first.
- Thumbnail click opens the preview modal.
- Dragging a thumbnail reorders the strip and updates hero.

- [ ] **Step 6: Commit**

Commit the e2e/test verification changes and migration push-related code:

```bash
git add tests/world-tour.spec.ts supabase/migrations
git commit -m "test: cover stop reference image flow"
```

---

## Self-Review

- Spec coverage: all approved requirements are represented: reference images, hero image, carousel, drag/drop upload, direct thumbnail reordering, preview modal, caption/credit, delete, keyboard fallback, Supabase ordering, repository methods, tests, and storage verification.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: repository methods use the same names from the design spec: `listDestinationMedia`, `uploadDestinationMedia`, `updateDestinationMedia`, `deleteDestinationMedia`, and `reorderDestinationMedia`.
- Scope check: this is a single implementation plan because all tasks support one feature surface. Gallery pages, albums, crop/edit tools, and public sharing remain out of scope.
