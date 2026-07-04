import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import { normalizeImageFile } from '../media/imageOptimization';
import type { TripRepository } from '../storage/tripRepository';
import { useDestinationMedia } from './useDestinationMedia';

vi.mock('../media/imageOptimization', () => ({
  normalizeImageFile: vi.fn(async (file: File) => file),
}));

describe('useDestinationMedia', () => {
  it('calls destination media repository methods through the owned media hook', async () => {
    const existing = [
      createMediaItem('media-1', 0),
      createMediaItem('media-2', 1),
    ];
    const originalFile = createFile('full-size.jpg', 'image/jpeg');
    const normalizedFile = createFile('full-size-normalized.jpg', 'image/jpeg');
    const repository = createTripRepository({
      listDestinationMedia: vi.fn().mockResolvedValue(existing),
      uploadDestinationMedia: vi.fn().mockResolvedValue(createMediaItem('uploaded-media', 2)),
    });
    vi.mocked(normalizeImageFile).mockResolvedValueOnce(normalizedFile);

    const { result } = renderHook(() => useDestinationMedia(repository, 'destination-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.uploadFiles([originalFile]);
    });
    await act(async () => {
      await result.current.reorder(['media-2', 'media-1', 'uploaded-media']);
    });

    expect(repository.listDestinationMedia).toHaveBeenCalledWith('destination-1');
    expect(repository.uploadDestinationMedia).toHaveBeenCalledWith({
      destinationId: 'destination-1',
      file: normalizedFile,
    });
    expect(repository.reorderDestinationMedia).toHaveBeenCalledWith('destination-1', [
      'media-2',
      'media-1',
      'uploaded-media',
    ]);
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

function createTripRepository(overrides: Partial<TripRepository> = {}) {
  const repository = {
    async listDestinations() {
      return [];
    },

    async saveDestination() {},

    async deleteDestination() {},

    listActivities: vi.fn(async () => []),

    createActivity: vi.fn(),

    updateActivity: vi.fn(),

    deleteActivity: vi.fn(),

    reorderActivities: vi.fn(),

    listDestinationMedia: vi.fn().mockResolvedValue([]),

    uploadDestinationMedia: vi.fn(async () => createMediaItem('uploaded-media', 0)),

    updateDestinationMedia: vi.fn(async (
      mediaId: string,
      patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
    ) => ({
      ...createMediaItem(mediaId, 0),
      ...patch,
    })),

    deleteDestinationMedia: vi.fn(async () => {}),

    reorderDestinationMedia: vi.fn(async (_destinationId: string, orderedMediaIds: string[]) =>
      orderedMediaIds.map((id, index) => createMediaItem(id, index)),
    ),

    listDestinationMediaRollup: vi.fn().mockResolvedValue([]),

    listActivityMedia: vi.fn().mockResolvedValue([]),

    uploadActivityMedia: vi.fn(async () => createMediaItem('uploaded-activity-media', 0)),

    updateActivityMedia: vi.fn(async (
      mediaId: string,
      patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
    ) => ({
      ...createMediaItem(mediaId, 0),
      ...patch,
    })),

    deleteActivityMedia: vi.fn(async () => {}),

    reorderActivityMedia: vi.fn(async (_activityId: string, orderedMediaIds: string[]) =>
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
