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
import { sortResearchLinks } from '../domain/researchLinks';
import type { WebImageSearchResult } from '../services/webImageSearchClient';
import type { StoredActivity, StoredActivityMediaRecord, StoredDestination, StoredRouteLeg, TripDb } from './tripDb';
import type { TripSnapshot } from './revision';

export type TripMutationDelta = {
  destinationsToUpsert: Destination[];
  destinationIdsToDelete: string[];
  routeLegsToUpsert: RouteLeg[];
  routeLegIdsToDelete: string[];
};

export type TripRepository = {
  loadSnapshot?(): Promise<TripSnapshot>;
  listDestinations(): Promise<Destination[]>;
  saveDestination(destination: Destination): Promise<void>;
  deleteDestination(destinationId: string): Promise<void>;
  deleteDestinations?(destinationIds: string[]): Promise<void>;
  prepareDestinationDeletion?(destinationIds: string[]): Promise<() => Promise<void>>;
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
  importDestinationMediaFromSearch(input: {
    destinationId: string;
    result: WebImageSearchResult;
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
  importActivityMediaFromSearch(input: {
    destinationId: string;
    activityId: string;
    result: WebImageSearchResult;
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
  applyTripMutation(delta: TripMutationDelta): Promise<void>;
  replaceTripData(snapshot: {
    destinations: Destination[];
    routeLegs: RouteLeg[];
    activities?: Activity[];
  }): Promise<void>;
};

const defaultLocalTripId = 'local-default-trip';

function stripDestinationTripId(destination: StoredDestination): Destination {
  const { entityId, tripId, ...domainDestination } = destination;
  void tripId;
  return { ...domainDestination, id: entityId ?? domainDestination.id };
}

function stripRouteLegTripId(routeLeg: StoredRouteLeg): RouteLeg {
  const { entityId, tripId, ...domainRouteLeg } = routeLeg;
  void tripId;
  return { ...domainRouteLeg, id: entityId ?? domainRouteLeg.id };
}

function stripActivityTripId(activity: StoredActivity): Activity {
  const { entityId, tripId, ...domainActivity } = activity;
  void tripId;
  return { ...domainActivity, id: entityId ?? domainActivity.id };
}

function stripActivityMediaTripId(record: StoredActivityMediaRecord): ActivityMediaRecord {
  const { entityId, tripId, ...domainRecord } = record;
  void tripId;
  return { ...domainRecord, id: entityId ?? domainRecord.id };
}

function localTripKey(tripId: string, recordId: string): string {
  return `${tripId}:${recordId}`;
}

function storeDestination(destination: Destination, tripId: string): StoredDestination {
  return { ...destination, id: localTripKey(tripId, destination.id), entityId: destination.id, tripId };
}

function storeRouteLeg(routeLeg: RouteLeg, tripId: string): StoredRouteLeg {
  return { ...routeLeg, id: localTripKey(tripId, routeLeg.id), entityId: routeLeg.id, tripId };
}

function storeActivity(activity: Activity, tripId: string): StoredActivity {
  return { ...activity, id: localTripKey(tripId, activity.id), entityId: activity.id, tripId };
}

function storeActivityMedia(record: ActivityMediaRecord, tripId: string): StoredActivityMediaRecord {
  return { ...record, id: localTripKey(tripId, record.id), entityId: record.id, tripId };
}

function normalizeDestination(destination: Destination, index = 0): Destination {
  return {
    ...destination,
    countryRegion: destination.countryRegion ?? destination.location?.countryName ?? '',
    routingAnchors: destination.routingAnchors ?? {},
    location:
      destination.location ??
      createLegacyLocation({
        name: destination.name,
        countryRegion: destination.countryRegion,
      }),
    order: Number.isFinite(destination.order) ? destination.order : index,
    research: {
      ...destination.research,
      links: sortResearchLinks(destination.research?.links ?? []),
      bookReferences: destination.research?.bookReferences ?? [],
      notes: destination.research?.notes ?? '',
    },
  };
}

function normalizeActivity(activity: Activity): Activity {
  return {
    ...activity,
    links: sortResearchLinks(activity.links ?? []),
  };
}

function normalizeRouteLeg(routeLeg: RouteLeg): RouteLeg {
  return {
    ...routeLeg,
    ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
    waypoints: routeLeg.waypoints ?? [],
    sections: routeLeg.sections ?? [],
    warnings: routeLeg.warnings ?? [],
    providerDiagnostic: routeLeg.providerDiagnostic ?? undefined,
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

export function createTripRepository(db: TripDb, tripId = defaultLocalTripId): TripRepository {
  async function deleteDestinations(destinationIds: string[]): Promise<void> {
    const requestedIds = new Set(destinationIds);
    if (requestedIds.size === 0) return;
    await db.transaction('rw', db.destinations, db.routeLegs, db.activities, db.activityMedia, async () => {
      const attachedActivities = (await db.activities.where('tripId').equals(tripId).toArray())
        .filter((activity) => requestedIds.has(activity.destinationId));
      const attachedActivityMedia = (await db.activityMedia.where('tripId').equals(tripId).toArray())
        .filter((mediaItem) => requestedIds.has(mediaItem.destinationId));
      const attachedLegs = (await db.routeLegs.where('tripId').equals(tripId).toArray()).filter(
        (leg) => requestedIds.has(leg.originDestinationId) || requestedIds.has(leg.targetDestinationId),
      );
      await db.destinations.bulkDelete([...requestedIds].map((id) => localTripKey(tripId, id)));
      await db.activities.bulkDelete(attachedActivities.map((activity) => activity.id));
      await db.activityMedia.bulkDelete(attachedActivityMedia.map((mediaItem) => mediaItem.id));
      await db.routeLegs.bulkDelete(attachedLegs.map((leg) => leg.id));
    });
  }

  async function applyTripMutation(delta: TripMutationDelta): Promise<void> {
    const destinationIdsToDelete = new Set(delta.destinationIdsToDelete);
    await db.transaction('rw', db.destinations, db.routeLegs, db.activities, db.activityMedia, async () => {
      const [attachedActivities, attachedActivityMedia] = destinationIdsToDelete.size > 0
        ? await Promise.all([
            Promise.all([...destinationIdsToDelete].map((destinationId) =>
              db.activities.where('[tripId+destinationId]').equals([tripId, destinationId]).toArray())),
            Promise.all([...destinationIdsToDelete].map((destinationId) =>
              db.activityMedia.where('[tripId+destinationId]').equals([tripId, destinationId]).toArray())),
          ])
        : [[], []];

      await db.routeLegs.bulkDelete(
        delta.routeLegIdsToDelete.map((id) => localTripKey(tripId, id)),
      );
      await db.activities.bulkDelete(
        attachedActivities.flat().map(({ id }) => id),
      );
      await db.activityMedia.bulkDelete(
        attachedActivityMedia.flat().map(({ id }) => id),
      );
      await db.destinations.bulkDelete(
        [...destinationIdsToDelete].map((id) => localTripKey(tripId, id)),
      );
      await db.destinations.bulkPut(
        delta.destinationsToUpsert.map((destination) => storeDestination(destination, tripId)),
      );
      await db.routeLegs.bulkPut(
        delta.routeLegsToUpsert.map((routeLeg) => storeRouteLeg(routeLeg, tripId)),
      );
    });
  }

  return {
    async listDestinations(): Promise<Destination[]> {
      const destinations = await db.destinations.where('tripId').equals(tripId).toArray();

      return destinations
        .map((destination, index) => normalizeDestination(stripDestinationTripId(destination), index))
        .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
    },

    async saveDestination(destination: Destination): Promise<void> {
      await db.destinations.put(storeDestination(destination, tripId));
    },

    async deleteDestination(destinationId: string): Promise<void> {
      await deleteDestinations([destinationId]);
    },

    deleteDestinations,
    applyTripMutation,
    async prepareDestinationDeletion(destinationIds) {
      return () => deleteDestinations(destinationIds);
    },

    async listActivities(destinationId: string): Promise<Activity[]> {
      return (await db.activities.where('[tripId+destinationId]').equals([tripId, destinationId]).toArray())
        .map((activity) => normalizeActivity(stripActivityTripId(activity)))
        .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
    },

    async createActivity(input: {
      destinationId: string;
      title: string;
      order?: number;
      location?: Activity['location'];
    }): Promise<Activity> {
      const destination = await db.destinations.get(localTripKey(tripId, input.destinationId));
      if (!destination || destination.tripId !== tripId) {
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

      await db.activities.put(storeActivity(activity, tripId));
      return activity;
    },

    async updateActivity(
      activityId: string,
      patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
    ): Promise<Activity> {
      const existing = await db.activities.get(localTripKey(tripId, activityId));
      if (!existing || existing.tripId !== tripId) {
        throw new Error('Activity not found.');
      }

      const updated = patchActivity(stripActivityTripId(existing), patch);
      await db.activities.put(storeActivity(updated, tripId));
      return updated;
    },

    async deleteActivity(activityId: string): Promise<void> {
      await db.transaction('rw', db.activities, db.activityMedia, async () => {
        const activity = await db.activities.get(localTripKey(tripId, activityId));
        if (activity?.tripId !== tripId) return;

        const media = await db.activityMedia
          .where('[tripId+activityId]')
          .equals([tripId, activityId])
          .toArray();

        await db.activities.delete(localTripKey(tripId, activityId));
        await db.activityMedia.bulkDelete(media.map((mediaItem) => mediaItem.id));
      });
    },

    async reorderActivities(destinationId: string, orderedActivityIds: string[]): Promise<Activity[]> {
      const currentActivities = await this.listActivities(destinationId);
      const orderedActivities = reorderActivityModels(currentActivities, orderedActivityIds);

      await db.activities.bulkPut(orderedActivities.map((activity) => storeActivity(activity, tripId)));
      return orderedActivities;
    },

    async listDestinationMedia(destinationId: string): Promise<MediaItem[]> {
      const destination = await db.destinations.get(localTripKey(tripId, destinationId));
      if (destination?.tripId !== tripId) return [];

      return [...(destination?.media ?? [])].sort(sortMediaItems);
    },

    async uploadDestinationMedia(input: {
      destinationId: string;
      file: File;
      caption?: string;
      credit?: string;
    }): Promise<MediaItem> {
      const destination = await db.destinations.get(localTripKey(tripId, input.destinationId));
      if (!destination || destination.tripId !== tripId) {
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

    async importDestinationMediaFromSearch(input: {
      destinationId: string;
      result: WebImageSearchResult;
    }): Promise<MediaItem> {
      const destination = await db.destinations.get(localTripKey(tripId, input.destinationId));
      if (!destination || destination.tripId !== tripId) {
        throw new Error('Destination not found.');
      }

      const timestamp = new Date().toISOString();
      const mediaItem: MediaItem = {
        id: crypto.randomUUID(),
        url: input.result.imageUrl,
        thumbnailUrl: input.result.thumbnailUrl,
        previewUrl: input.result.imageUrl,
        fullUrl: input.result.imageUrl,
        caption: input.result.title,
        credit: input.result.sourceName,
        sortOrder:
          destination.media.reduce(
            (maxSortOrder, item, index) => Math.max(maxSortOrder, item.sortOrder ?? index),
            -1,
          ) + 1,
        contentType: 'image/jpeg',
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
      const destinations = await db.destinations.where('tripId').equals(tripId).toArray();
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
      const destinations = await db.destinations.where('tripId').equals(tripId).toArray();
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
      const destination = await db.destinations.get(localTripKey(tripId, destinationId));
      if (!destination || destination.tripId !== tripId) {
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
      return (await db.activityMedia.where('[tripId+activityId]').equals([tripId, activityId]).toArray())
        .map((record) => stripActivityMediaOwner(stripActivityMediaTripId(record)))
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
        db.destinations.get(localTripKey(tripId, input.destinationId)),
        db.activities.get(localTripKey(tripId, input.activityId)),
      ]);
      if (!destination || destination.tripId !== tripId) {
        throw new Error('Destination not found.');
      }
      if (!activity || activity.tripId !== tripId || activity.destinationId !== input.destinationId) {
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

      await db.activityMedia.put(storeActivityMedia(mediaRecord, tripId));
      return stripActivityMediaOwner(mediaRecord);
    },

    async importActivityMediaFromSearch(input: {
      destinationId: string;
      activityId: string;
      result: WebImageSearchResult;
    }): Promise<MediaItem> {
      const [destination, activity] = await Promise.all([
        db.destinations.get(localTripKey(tripId, input.destinationId)),
        db.activities.get(localTripKey(tripId, input.activityId)),
      ]);
      if (!destination || destination.tripId !== tripId) {
        throw new Error('Destination not found.');
      }
      if (!activity || activity.tripId !== tripId || activity.destinationId !== input.destinationId) {
        throw new Error('Activity not found.');
      }

      const timestamp = new Date().toISOString();
      const existingMedia = await this.listActivityMedia(input.activityId);
      const mediaRecord: ActivityMediaRecord = {
        id: crypto.randomUUID(),
        activityId: input.activityId,
        destinationId: input.destinationId,
        url: input.result.imageUrl,
        thumbnailUrl: input.result.thumbnailUrl,
        previewUrl: input.result.imageUrl,
        fullUrl: input.result.imageUrl,
        caption: input.result.title,
        credit: input.result.sourceName,
        sortOrder:
          existingMedia.reduce(
            (maxSortOrder, item, index) => Math.max(maxSortOrder, item.sortOrder ?? index),
            -1,
          ) + 1,
        contentType: 'image/jpeg',
        uploadedAt: timestamp,
      };

      await db.activityMedia.put(storeActivityMedia(mediaRecord, tripId));
      return stripActivityMediaOwner(mediaRecord);
    },

    async updateActivityMedia(
      mediaId: string,
      patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>,
    ): Promise<MediaItem> {
      const existing = await db.activityMedia.get(localTripKey(tripId, mediaId));
      if (!existing || existing.tripId !== tripId) {
        throw new Error('Media item not found.');
      }

      const updated: ActivityMediaRecord = {
        ...stripActivityMediaTripId(existing),
        ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
        ...(patch.credit !== undefined ? { credit: patch.credit } : {}),
      };
      await db.activityMedia.put(storeActivityMedia(updated, tripId));
      return stripActivityMediaOwner(updated);
    },

    async deleteActivityMedia(mediaId: string): Promise<void> {
      const existing = await db.activityMedia.get(localTripKey(tripId, mediaId));
      if (!existing || existing.tripId !== tripId) {
        throw new Error('Media item not found.');
      }

      await db.activityMedia.delete(localTripKey(tripId, mediaId));
    },

    async reorderActivityMedia(activityId: string, orderedMediaIds: string[]): Promise<MediaItem[]> {
      const activity = await db.activities.get(localTripKey(tripId, activityId));
      if (!activity || activity.tripId !== tripId) {
        throw new Error('Activity not found.');
      }

      const currentMedia = await db.activityMedia.where('[tripId+activityId]').equals([tripId, activityId]).toArray();
      const currentMediaIds = currentMedia.map((mediaItem) => stripActivityMediaTripId(mediaItem).id);
      const requestedIds = new Set(orderedMediaIds);
      const missingIds = currentMediaIds.filter((id) => !requestedIds.has(id));
      const extraIds = orderedMediaIds.filter((id) => !currentMediaIds.includes(id));

      if (requestedIds.size !== orderedMediaIds.length || missingIds.length > 0 || extraIds.length > 0) {
        throw createMediaOrderMismatchError('activity', currentMediaIds, orderedMediaIds);
      }

      const mediaById = new Map(currentMedia.map((mediaItem) => [stripActivityMediaTripId(mediaItem).id, mediaItem]));
      const media = orderedMediaIds.map((id, index) => ({
        ...stripActivityMediaTripId(mediaById.get(id)!),
        sortOrder: index,
      }));

      await db.activityMedia.bulkPut(media.map((mediaItem) => storeActivityMedia(mediaItem, tripId)));
      return media.map(stripActivityMediaOwner);
    },

    async listRouteLegs(): Promise<RouteLeg[]> {
      const routeLegs = await db.routeLegs.where('tripId').equals(tripId).toArray();

      return routeLegs
        .map((routeLeg) => normalizeRouteLeg(stripRouteLegTripId(routeLeg)))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    },

    async saveRouteLeg(routeLeg: RouteLeg): Promise<void> {
      await db.routeLegs.put(storeRouteLeg(normalizeRouteLeg(routeLeg), tripId));
    },

    async deleteRouteLeg(routeLegId: string): Promise<void> {
      const routeLeg = await db.routeLegs.get(localTripKey(tripId, routeLegId));
      if (routeLeg?.tripId === tripId) {
        await db.routeLegs.delete(localTripKey(tripId, routeLegId));
      }
    },

    async replaceTripData(snapshot: {
      destinations: Destination[];
      routeLegs: RouteLeg[];
      activities?: Activity[];
    }): Promise<void> {
      await db.transaction('rw', db.destinations, db.routeLegs, db.activities, db.activityMedia, async () => {
        const existingDestinations = await db.destinations.where('tripId').equals(tripId).toArray();
        const existingRouteLegs = await db.routeLegs.where('tripId').equals(tripId).toArray();
        const existingActivities = await db.activities.where('tripId').equals(tripId).toArray();
        const existingActivityMedia = await db.activityMedia.where('tripId').equals(tripId).toArray();

        await db.destinations.bulkDelete(existingDestinations.map((destination) => destination.id));
        await db.routeLegs.bulkDelete(existingRouteLegs.map((routeLeg) => routeLeg.id));
        await db.activities.bulkDelete(existingActivities.map((activity) => activity.id));
        await db.activityMedia.bulkDelete(existingActivityMedia.map((mediaItem) => mediaItem.id));
        await db.destinations.bulkPut(snapshot.destinations.map((destination, index) =>
          storeDestination(normalizeDestination(destination, index), tripId),
        ));
        await db.routeLegs.bulkPut(snapshot.routeLegs.map((routeLeg) =>
          storeRouteLeg(normalizeRouteLeg(routeLeg), tripId),
        ));
        if (snapshot.activities) {
          await db.activities.bulkPut(snapshot.activities.map((activity) => storeActivity(activity, tripId)));
        }
      });
    },
  };
}
