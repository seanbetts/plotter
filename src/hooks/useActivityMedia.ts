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
      list: () => (activityId ? repository.listActivityMedia(activityId) : Promise.resolve([])),
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
