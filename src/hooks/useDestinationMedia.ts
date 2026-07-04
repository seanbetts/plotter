import type { TripRepository } from '../storage/tripRepository';
import { useOwnedMedia } from './useOwnedMedia';

export function useDestinationMedia(
  repository: TripRepository,
  destinationId: string | null,
) {
  return useOwnedMedia({
    ownerId: destinationId,
    repository: {
      list: () => (destinationId ? repository.listDestinationMedia(destinationId) : Promise.resolve([])),
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
