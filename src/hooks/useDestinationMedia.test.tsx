import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';
import { useDestinationMedia } from './useDestinationMedia';

describe('useDestinationMedia', () => {
  it('loads destination media and populates state', async () => {
    const media = [createMediaItem('media-1', 0)];
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue(media),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(repository.listDestinationMedia).toHaveBeenCalledWith('destination-1');
    expect(result.current.mediaItems).toEqual(media);
    expect(result.current.error).toBeNull();
  });

  it('clears media and avoids repository calls when destination is null', async () => {
    const repository = createMediaRepository();

    const { result } = renderHook(() => useDestinationMedia(repository, null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(repository.listDestinationMedia).not.toHaveBeenCalled();
    expect(result.current.mediaItems).toEqual([]);
  });

  it('ignores stale load responses from a previous destination', async () => {
    const oldLoad = createDeferred([createMediaItem('old-media', 0)]);
    const newMedia = [createMediaItem('new-media', 0)];
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn((destinationId: string) => {
        if (destinationId === 'destination-1') return oldLoad.promise;
        return Promise.resolve(newMedia);
      }),
    });

    const { result, rerender } = renderHook(
      ({ destinationId }) => useDestinationMedia(repository, destinationId),
      { initialProps: { destinationId: 'destination-1' as string | null } },
    );

    rerender({ destinationId: 'destination-2' });

    await waitFor(() => expect(result.current.mediaItems).toEqual(newMedia));

    await act(async () => {
      oldLoad.resolve();
      await oldLoad.promise;
    });

    expect(result.current.mediaItems).toEqual(newMedia);
  });

  it('filters invalid uploads, appends valid uploads, and toggles uploading state', async () => {
    const uploaded = createMediaItem('uploaded-media', 1);
    const upload = createDeferred(uploaded);
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue([createMediaItem('existing-media', 0)]),
      uploadDestinationMedia: vi.fn().mockReturnValue(upload.promise),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.uploadFiles([
        createFile('photo.jpg', 'image/jpeg'),
        createFile('notes.txt', 'text/plain'),
      ]);
    });

    await waitFor(() => expect(result.current.isUploading).toBe(true));

    await act(async () => {
      upload.resolve();
      await uploadPromise;
    });

    expect(repository.uploadDestinationMedia).toHaveBeenCalledTimes(1);
    expect(repository.uploadDestinationMedia).toHaveBeenCalledWith({
      destinationId: 'destination-1',
      file: expect.objectContaining({ name: 'photo.jpg', type: 'image/jpeg' }),
    });
    expect(result.current.isUploading).toBe(false);
    expect(result.current.mediaItems.map((item) => item.id)).toEqual([
      'existing-media',
      'uploaded-media',
    ]);
  });

  it('rejects all-invalid uploads with an image type error', async () => {
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue([]),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.uploadFiles([createFile('notes.txt', 'text/plain')]);
    });

    expect(repository.uploadDestinationMedia).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Choose a JPEG, PNG, WebP, or GIF image.');
  });

  it('updates one media item and returns the updated item', async () => {
    const existing = [createMediaItem('media-1', 0), createMediaItem('media-2', 1)];
    const updated = { ...existing[1], caption: 'Northern light' };
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue(existing),
      updateDestinationMedia: vi.fn().mockResolvedValue(updated),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: MediaItem | undefined;
    await act(async () => {
      returned = await result.current.updateMedia('media-2', { caption: 'Northern light' });
    });

    expect(repository.updateDestinationMedia).toHaveBeenCalledWith('media-2', {
      caption: 'Northern light',
    });
    expect(returned).toEqual(updated);
    expect(result.current.mediaItems).toEqual([existing[0], updated]);
  });

  it('deletes one media item locally after repository delete succeeds', async () => {
    const existing = [createMediaItem('media-1', 0), createMediaItem('media-2', 1)];
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue(existing),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteMedia('media-1');
    });

    expect(repository.deleteDestinationMedia).toHaveBeenCalledWith('media-1');
    expect(result.current.mediaItems).toEqual([existing[1]]);
  });

  it('restores previous order and surfaces an error when reorder fails', async () => {
    const existing = [
      createMediaItem('media-1', 0),
      createMediaItem('media-2', 1),
      createMediaItem('media-3', 2),
    ];
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue(existing),
      reorderDestinationMedia: vi.fn().mockRejectedValue(new Error('Unable to reorder media.')),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reorder(['media-3', 'media-2', 'media-1']);
    });

    expect(repository.reorderDestinationMedia).toHaveBeenCalledWith('destination-1', [
      'media-3',
      'media-2',
      'media-1',
    ]);
    expect(result.current.mediaItems).toEqual(existing);
    expect(result.current.error).toBe('Unable to reorder media.');
  });

  it('does not let an older failed reorder undo a newer reorder', async () => {
    const existing = [
      createMediaItem('media-1', 0),
      createMediaItem('media-2', 1),
      createMediaItem('media-3', 2),
    ];
    const olderReorder = createDeferred<MediaItem[]>([]);
    const newerReorder = [
      createMediaItem('media-3', 0),
      createMediaItem('media-2', 1),
      createMediaItem('media-1', 2),
    ];
    const repository = createMediaRepository({
      listDestinationMedia: vi.fn().mockResolvedValue(existing),
      reorderDestinationMedia: vi
        .fn()
        .mockReturnValueOnce(olderReorder.promise)
        .mockResolvedValueOnce(newerReorder),
    });

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let olderReorderPromise!: Promise<void>;
    act(() => {
      olderReorderPromise = result.current.reorder(['media-2', 'media-1', 'media-3']);
    });

    await waitFor(() =>
      expect(result.current.mediaItems.map((item) => item.id)).toEqual([
        'media-2',
        'media-1',
        'media-3',
      ]),
    );

    await act(async () => {
      await result.current.reorder(['media-3', 'media-2', 'media-1']);
    });

    expect(result.current.mediaItems).toEqual(newerReorder);

    await act(async () => {
      olderReorder.reject(new Error('Older reorder failed.'));
      await olderReorderPromise;
    });

    expect(result.current.mediaItems).toEqual(newerReorder);
    expect(result.current.error).toBeNull();
  });
});

function createMediaItem(id: string, sortOrder: number): MediaItem {
  return {
    id,
    url: `https://example.com/${id}.jpg`,
    caption: '',
    credit: '',
    sortOrder,
    contentType: 'image/jpeg',
    uploadedAt: '2026-07-03T12:00:00.000Z',
  };
}

function createFile(name: string, type: string) {
  return new File(['file contents'], name, { type });
}

function createDeferred<T>(value: T) {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = () => done(value);
    reject = fail;
  });

  return { promise, resolve, reject };
}

function createMediaRepository(overrides: Partial<TripRepository> = {}) {
  const repository = {
    async listDestinations() {
      return [];
    },

    async saveDestination() {},

    async deleteDestination() {},

    listDestinationMedia: vi.fn().mockResolvedValue([]),

    uploadDestinationMedia: vi.fn(async () => createMediaItem('uploaded-media', 0)),

    updateDestinationMedia: vi.fn(async (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => ({
      ...createMediaItem(mediaId, 0),
      ...patch,
    })),

    deleteDestinationMedia: vi.fn(async () => {}),

    reorderDestinationMedia: vi.fn(async (_destinationId: string, orderedMediaIds: string[]) =>
      orderedMediaIds.map((id, index) => createMediaItem(id, index)),
    ),

    async listRouteLegs() {
      return [];
    },

    async saveRouteLeg() {},

    async deleteRouteLeg() {},

    async replaceTripData() {},
  } satisfies TripRepository;

  return Object.assign(repository, overrides);
}
