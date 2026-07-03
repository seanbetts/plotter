import type { Destination, MediaItem, RouteLeg } from '../domain/types';
import { createLegacyLocation } from '../domain/locations';
import type { TripDb } from './tripDb';

export type TripRepository = {
  listDestinations(): Promise<Destination[]>;
  saveDestination(destination: Destination): Promise<void>;
  deleteDestination(destinationId: string): Promise<void>;
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
  listRouteLegs(): Promise<RouteLeg[]>;
  saveRouteLeg(routeLeg: RouteLeg): Promise<void>;
  deleteRouteLeg(routeLegId: string): Promise<void>;
  replaceTripData(snapshot: {
    destinations: Destination[];
    routeLegs: RouteLeg[];
  }): Promise<void>;
};

type LegacyRouteLeg = Omit<RouteLeg, 'type' | 'status'> & {
  type?: RouteLeg['type'] | 'driving' | 'ferry-shipping' | 'uncertain';
  status?: RouteLeg['status'];
};

function normalizeDestination(destination: Destination, index = 0): Destination {
  return {
    ...destination,
    countryRegion: destination.countryRegion ?? destination.location?.countryName ?? '',
    location:
      destination.location ??
      createLegacyLocation({
        name: destination.name,
        countryRegion: destination.countryRegion,
      }),
    order: Number.isFinite(destination.order) ? destination.order : index,
  };
}

function normalizeRouteLeg(routeLeg: LegacyRouteLeg): RouteLeg {
  const type = routeLeg.type === 'shipping-manual' || routeLeg.type === 'ferry-shipping' || routeLeg.type === 'uncertain'
    ? 'shipping-manual'
    : 'driving-auto';

  return {
    ...routeLeg,
    type,
    status: routeLeg.status ?? (type === 'shipping-manual' ? 'manual' : 'pending'),
    profile: routeLeg.profile ?? (type === 'driving-auto' ? 'driving-car' : undefined),
  };
}

export function createTripRepository(db: TripDb): TripRepository {
  return {
    async listDestinations(): Promise<Destination[]> {
      const destinations = await db.destinations.toArray();

      return destinations
        .map((destination, index) => normalizeDestination(destination, index))
        .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
    },

    async saveDestination(destination: Destination): Promise<void> {
      await db.destinations.put(destination);
    },

    async deleteDestination(destinationId: string): Promise<void> {
      await db.transaction('rw', db.destinations, db.routeLegs, async () => {
        await db.destinations.delete(destinationId);
        const attachedLegs = await db.routeLegs
          .where('originDestinationId')
          .equals(destinationId)
          .or('targetDestinationId')
          .equals(destinationId)
          .toArray();

        await db.routeLegs.bulkDelete(attachedLegs.map((leg) => leg.id));
      });
    },

    async listDestinationMedia(destinationId: string): Promise<MediaItem[]> {
      const destination = await db.destinations.get(destinationId);
      return [...(destination?.media ?? [])].sort(
        (left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0),
      );
    },

    async uploadDestinationMedia(input: {
      destinationId: string;
      file: File;
      caption?: string;
      credit?: string;
    }): Promise<MediaItem> {
      const destination = await db.destinations.get(input.destinationId);
      if (!destination) {
        throw new Error('Destination not found.');
      }

      const timestamp = new Date().toISOString();
      const mediaItem: MediaItem = {
        id: crypto.randomUUID(),
        url: input.file.name,
        caption: input.caption ?? '',
        credit: input.credit ?? '',
        sortOrder:
          destination.media.reduce(
            (maxSortOrder, item, index) => Math.max(maxSortOrder, item.sortOrder ?? index),
            -1,
          ) + 1,
        contentType: input.file.type || undefined,
        sizeBytes: input.file.size,
        uploadedAt: timestamp,
      };

      await db.destinations.put({
        ...destination,
        media: [...destination.media, mediaItem],
        updatedAt: timestamp,
      });

      return mediaItem;
    },

    async updateDestinationMedia(
      mediaId: string,
      patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
    ): Promise<MediaItem> {
      const timestamp = new Date().toISOString();
      const destinations = await db.destinations.toArray();
      const destination = destinations.find((item) =>
        item.media.some((mediaItem) => mediaItem.id === mediaId),
      );

      if (!destination) {
        throw new Error('Media item not found.');
      }

      let updatedMediaItem: MediaItem | undefined;
      const media = destination.media.map((mediaItem) => {
        if (mediaItem.id !== mediaId) return mediaItem;

        updatedMediaItem = {
          ...mediaItem,
          ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
          ...(patch.credit !== undefined ? { credit: patch.credit } : {}),
        };

        return updatedMediaItem;
      });

      await db.destinations.put({
        ...destination,
        media,
        updatedAt: timestamp,
      });

      if (!updatedMediaItem) {
        throw new Error('Media item not found.');
      }

      return updatedMediaItem;
    },

    async deleteDestinationMedia(mediaId: string): Promise<void> {
      const timestamp = new Date().toISOString();
      const destinations = await db.destinations.toArray();
      const destination = destinations.find((item) =>
        item.media.some((mediaItem) => mediaItem.id === mediaId),
      );

      if (!destination) {
        throw new Error('Media item not found.');
      }

      await db.destinations.put({
        ...destination,
        media: destination.media.filter((mediaItem) => mediaItem.id !== mediaId),
        updatedAt: timestamp,
      });
    },

    async reorderDestinationMedia(
      destinationId: string,
      orderedMediaIds: string[],
    ): Promise<MediaItem[]> {
      const destination = await db.destinations.get(destinationId);
      if (!destination) {
        throw new Error('Destination not found.');
      }

      const currentMediaIds = destination.media.map((mediaItem) => mediaItem.id);
      const requestedIds = new Set(orderedMediaIds);
      const missingIds = currentMediaIds.filter((id) => !requestedIds.has(id));
      const extraIds = orderedMediaIds.filter((id) => !currentMediaIds.includes(id));

      if (requestedIds.size !== orderedMediaIds.length || missingIds.length > 0 || extraIds.length > 0) {
        throw new Error(
          `Media order must include each destination media item exactly once. Missing ${missingIds.join(', ') || 'none'}; extra ${extraIds.join(', ') || 'none'}.`,
        );
      }

      const mediaById = new Map(destination.media.map((mediaItem) => [mediaItem.id, mediaItem]));
      const media = orderedMediaIds.map((id, index) => ({
        ...mediaById.get(id)!,
        sortOrder: index,
      }));

      await db.destinations.put({
        ...destination,
        media,
        updatedAt: new Date().toISOString(),
      });

      return media;
    },

    async listRouteLegs(): Promise<RouteLeg[]> {
      const routeLegs = await db.routeLegs.toArray();

      return routeLegs
        .map((routeLeg) => normalizeRouteLeg(routeLeg as LegacyRouteLeg))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    },

    async saveRouteLeg(routeLeg: RouteLeg): Promise<void> {
      await db.routeLegs.put(routeLeg);
    },

    async deleteRouteLeg(routeLegId: string): Promise<void> {
      await db.routeLegs.delete(routeLegId);
    },

    async replaceTripData(snapshot: {
      destinations: Destination[];
      routeLegs: RouteLeg[];
    }): Promise<void> {
      await db.transaction('rw', db.destinations, db.routeLegs, async () => {
        await db.destinations.clear();
        await db.routeLegs.clear();
        await db.destinations.bulkPut(snapshot.destinations.map((destination, index) => normalizeDestination(destination, index)));
        await db.routeLegs.bulkPut(snapshot.routeLegs);
      });
    },
  };
}
