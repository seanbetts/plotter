import { createActivity, reorderActivities as reorderActivityModels, updateActivity as patchActivity } from '../domain/activities';
import type {
  Activity,
  ActivityMediaRecord,
  Destination,
  MediaItem,
  MediaRollupItem,
  RouteLeg,
} from '../domain/types';
import { createLegacyLocation } from '../domain/locations';
import type { TripDb } from './tripDb';

export type TripRepository = {
  listDestinations(): Promise<Destination[]>;
  saveDestination(destination: Destination): Promise<void>;
  deleteDestination(destinationId: string): Promise<void>;
  listActivities(destinationId: string): Promise<Activity[]>;
  createActivity(input: {
    destinationId: string;
    title: string;
    order?: number;
    location?: Activity['location'];
  }): Promise<Activity>;
  updateActivity(
    activityId: string,
    patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Activity>;
  deleteActivity(activityId: string): Promise<void>;
  reorderActivities(destinationId: string, orderedActivityIds: string[]): Promise<Activity[]>;
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
  listRouteLegs(): Promise<RouteLeg[]>;
  saveRouteLeg(routeLeg: RouteLeg): Promise<void>;
  deleteRouteLeg(routeLegId: string): Promise<void>;
  replaceTripData(snapshot: {
    destinations: Destination[];
    routeLegs: RouteLeg[];
    activities?: Activity[];
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

function stripActivityMediaOwner(record: ActivityMediaRecord): MediaItem {
  return {
    id: record.id,
    url: record.url,
    thumbnailUrl: record.thumbnailUrl,
    previewUrl: record.previewUrl,
    fullUrl: record.fullUrl,
    caption: record.caption,
    credit: record.credit,
    sortOrder: record.sortOrder,
    bucketId: record.bucketId,
    objectPath: record.objectPath,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt,
  };
}

function sortMediaItems(left: MediaItem, right: MediaItem) {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    || (left.uploadedAt ?? '').localeCompare(right.uploadedAt ?? '');
}

function createMediaOrderMismatchError(ownerLabel: string, currentIds: string[], orderedMediaIds: string[]) {
  const requestedIds = new Set(orderedMediaIds);
  const missingIds = currentIds.filter((id) => !requestedIds.has(id));
  const extraIds = orderedMediaIds.filter((id) => !currentIds.includes(id));

  return new Error(
    `Media order must include each ${ownerLabel} media item exactly once. Missing ${missingIds.join(', ') || 'none'}; extra ${extraIds.join(', ') || 'none'}.`,
  );
}

async function createLocalMediaUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
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
      await db.transaction('rw', db.destinations, db.routeLegs, db.activities, db.activityMedia, async () => {
        await db.destinations.delete(destinationId);
        await db.activities.where('destinationId').equals(destinationId).delete();
        await db.activityMedia.where('destinationId').equals(destinationId).delete();
        const attachedLegs = await db.routeLegs
          .where('originDestinationId')
          .equals(destinationId)
          .or('targetDestinationId')
          .equals(destinationId)
          .toArray();

        await db.routeLegs.bulkDelete(attachedLegs.map((leg) => leg.id));
      });
    },

    async listActivities(destinationId: string): Promise<Activity[]> {
      return (await db.activities.where('destinationId').equals(destinationId).toArray()).sort(
        (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
      );
    },

    async createActivity(input: {
      destinationId: string;
      title: string;
      order?: number;
      location?: Activity['location'];
    }): Promise<Activity> {
      const destination = await db.destinations.get(input.destinationId);
      if (!destination) {
        throw new Error('Destination not found.');
      }

      const existingActivities = await this.listActivities(input.destinationId);
      const nextOrder =
        existingActivities.reduce((maxOrder, activity) => Math.max(maxOrder, activity.order), -1) + 1;
      const activity = createActivity({
        ...input,
        order: input.order ?? nextOrder,
        location: input.location,
      });

      await db.activities.put(activity);
      return activity;
    },

    async updateActivity(
      activityId: string,
      patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
    ): Promise<Activity> {
      const existing = await db.activities.get(activityId);
      if (!existing) {
        throw new Error('Activity not found.');
      }

      const updated = patchActivity(existing, patch);
      await db.activities.put(updated);
      return updated;
    },

    async deleteActivity(activityId: string): Promise<void> {
      await db.transaction('rw', db.activities, db.activityMedia, async () => {
        await db.activities.delete(activityId);
        await db.activityMedia.where('activityId').equals(activityId).delete();
      });
    },

    async reorderActivities(destinationId: string, orderedActivityIds: string[]): Promise<Activity[]> {
      const currentActivities = await this.listActivities(destinationId);
      const orderedActivities = reorderActivityModels(currentActivities, orderedActivityIds);

      await db.activities.bulkPut(orderedActivities);
      return orderedActivities;
    },

    async listDestinationMedia(destinationId: string): Promise<MediaItem[]> {
      const destination = await db.destinations.get(destinationId);
      return [...(destination?.media ?? [])].sort(sortMediaItems);
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
      const mediaUrl = await createLocalMediaUrl(input.file);
      const mediaItem: MediaItem = {
        id: crypto.randomUUID(),
        url: mediaUrl,
        thumbnailUrl: mediaUrl,
        previewUrl: mediaUrl,
        fullUrl: mediaUrl,
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
        throw createMediaOrderMismatchError('destination', currentMediaIds, orderedMediaIds);
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

    async listDestinationMediaRollup(destinationId: string): Promise<MediaRollupItem[]> {
      const destinationMedia = await this.listDestinationMedia(destinationId);
      const activities = await this.listActivities(destinationId);
      const rollup: MediaRollupItem[] = destinationMedia.map((mediaItem) => ({
        mediaItem,
        ownerType: 'destination',
        destinationId,
        canReorderInStopCarousel: true,
      }));

      for (const activity of activities) {
        const activityMedia = await this.listActivityMedia(activity.id);

        rollup.push(...activityMedia.map((mediaItem) => ({
          mediaItem,
          ownerType: 'activity' as const,
          destinationId,
          activityId: activity.id,
          activityTitle: activity.title,
          canReorderInStopCarousel: false,
        })));
      }

      return rollup;
    },

    async listActivityMedia(activityId: string): Promise<MediaItem[]> {
      return (await db.activityMedia.where('activityId').equals(activityId).toArray())
        .map(stripActivityMediaOwner)
        .sort(sortMediaItems);
    },

    async uploadActivityMedia(input: {
      destinationId: string;
      activityId: string;
      file: File;
      caption?: string;
      credit?: string;
    }): Promise<MediaItem> {
      const [destination, activity] = await Promise.all([
        db.destinations.get(input.destinationId),
        db.activities.get(input.activityId),
      ]);
      if (!destination) {
        throw new Error('Destination not found.');
      }
      if (!activity || activity.destinationId !== input.destinationId) {
        throw new Error('Activity not found.');
      }

      const timestamp = new Date().toISOString();
      const mediaUrl = await createLocalMediaUrl(input.file);
      const existingMedia = await this.listActivityMedia(input.activityId);
      const mediaRecord: ActivityMediaRecord = {
        id: crypto.randomUUID(),
        activityId: input.activityId,
        destinationId: input.destinationId,
        url: mediaUrl,
        thumbnailUrl: mediaUrl,
        previewUrl: mediaUrl,
        fullUrl: mediaUrl,
        caption: input.caption ?? '',
        credit: input.credit ?? '',
        sortOrder:
          existingMedia.reduce(
            (maxSortOrder, item, index) => Math.max(maxSortOrder, item.sortOrder ?? index),
            -1,
          ) + 1,
        contentType: input.file.type || undefined,
        sizeBytes: input.file.size,
        uploadedAt: timestamp,
      };

      await db.activityMedia.put(mediaRecord);
      return stripActivityMediaOwner(mediaRecord);
    },

    async updateActivityMedia(
      mediaId: string,
      patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
    ): Promise<MediaItem> {
      const existing = await db.activityMedia.get(mediaId);
      if (!existing) {
        throw new Error('Media item not found.');
      }

      const updated: ActivityMediaRecord = {
        ...existing,
        ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
        ...(patch.credit !== undefined ? { credit: patch.credit } : {}),
      };
      await db.activityMedia.put(updated);
      return stripActivityMediaOwner(updated);
    },

    async deleteActivityMedia(mediaId: string): Promise<void> {
      const existing = await db.activityMedia.get(mediaId);
      if (!existing) {
        throw new Error('Media item not found.');
      }

      await db.activityMedia.delete(mediaId);
    },

    async reorderActivityMedia(activityId: string, orderedMediaIds: string[]): Promise<MediaItem[]> {
      const activity = await db.activities.get(activityId);
      if (!activity) {
        throw new Error('Activity not found.');
      }

      const currentMedia = await db.activityMedia.where('activityId').equals(activityId).toArray();
      const currentMediaIds = currentMedia.map((mediaItem) => mediaItem.id);
      const requestedIds = new Set(orderedMediaIds);
      const missingIds = currentMediaIds.filter((id) => !requestedIds.has(id));
      const extraIds = orderedMediaIds.filter((id) => !currentMediaIds.includes(id));

      if (requestedIds.size !== orderedMediaIds.length || missingIds.length > 0 || extraIds.length > 0) {
        throw createMediaOrderMismatchError('activity', currentMediaIds, orderedMediaIds);
      }

      const mediaById = new Map(currentMedia.map((mediaItem) => [mediaItem.id, mediaItem]));
      const media = orderedMediaIds.map((id, index) => ({
        ...mediaById.get(id)!,
        sortOrder: index,
      }));

      await db.activityMedia.bulkPut(media);
      return media.map(stripActivityMediaOwner);
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
      activities?: Activity[];
    }): Promise<void> {
      await db.transaction('rw', db.destinations, db.routeLegs, db.activities, db.activityMedia, async () => {
        await db.destinations.clear();
        await db.routeLegs.clear();
        await db.activities.clear();
        await db.activityMedia.clear();
        await db.destinations.bulkPut(snapshot.destinations.map((destination, index) => normalizeDestination(destination, index)));
        await db.routeLegs.bulkPut(snapshot.routeLegs);
        if (snapshot.activities) {
          await db.activities.bulkPut(snapshot.activities);
        }
      });
    },
  };
}
