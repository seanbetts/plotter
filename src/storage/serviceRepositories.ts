import type {
  CreateTripRequest,
  DestinationMediaImportRequest,
  DirectoryReadResponse,
  DirectoryWriteResponse,
  MediaWriteResponse,
  TripMutationRequest,
  TripReadResponse,
  TripWriteResponse,
  UpdateTripRequest,
} from '../api/contracts';
import type { PlotterApiClient } from '../api/client';
import type { Activity, Destination, MediaItem, MediaRollupItem, RouteLeg, TripRoutingVehicle } from '../domain/types';
import type { TripDirectoryRepository, TripSummary } from './tripDirectoryRepository';
import type { TripRepository } from './tripRepository';

const READ_REQUIRED_MESSAGE = 'Load the latest Plotter data before making changes.';

function routePart(value: string): string {
  return encodeURIComponent(value);
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function revisionFrom(value: { revision: unknown }): number {
  const revision = value.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Plotter service returned an invalid revision.');
  }
  return revision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTripRoutingVehicle(value: unknown): value is TripRoutingVehicle {
  if (!isRecord(value) || !isRecord(value.restrictions)) return false;
  if (value.preset !== 'standard' && value.preset !== 'large-camper' && value.preset !== 'expedition-truck') return false;
  if (value.profile !== 'driving-car' && value.profile !== 'driving-hgv') return false;
  return value.vehicleType === undefined || value.vehicleType === 'hgv';
}

function isTripSummary(value: unknown): value is TripSummary {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.description)
    && isString(value.createdAt)
    && isString(value.updatedAt)
    && isTripRoutingVehicle(value.routingVehicle);
}

function isActivity(value: unknown): value is Activity {
  return isRecord(value)
    && isString(value.id)
    && isString(value.destinationId)
    && isFiniteNumber(value.order)
    && isString(value.title)
    && isString(value.description)
    && isString(value.category)
    && isString(value.status)
    && isString(value.priority)
    && Array.isArray(value.links)
    && isString(value.notes)
    && Array.isArray(value.tags)
    && isString(value.createdAt)
    && isString(value.updatedAt);
}

function isMediaItem(value: unknown): value is MediaItem {
  return isRecord(value)
    && isString(value.id)
    && isString(value.url)
    && isString(value.caption)
    && isString(value.credit)
    && (value.thumbnailUrl === undefined || isString(value.thumbnailUrl))
    && (value.previewUrl === undefined || isString(value.previewUrl))
    && (value.fullUrl === undefined || isString(value.fullUrl));
}

function isDestination(value: unknown): value is Destination {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isString(value.countryRegion)
    && isRecord(value.coordinates)
    && isFiniteNumber(value.coordinates.lat)
    && isFiniteNumber(value.coordinates.lng)
    && isFiniteNumber(value.order)
    && isString(value.createdAt)
    && isString(value.updatedAt);
}

function isRouteLeg(value: unknown): value is RouteLeg {
  return isRecord(value)
    && isString(value.id)
    && isString(value.originDestinationId)
    && isString(value.targetDestinationId)
    && isString(value.movement)
    && isString(value.calculation)
    && isString(value.status)
    && isString(value.notes)
    && isString(value.createdAt)
    && isString(value.updatedAt);
}

function requiredObject<T extends object>(value: unknown, validate: (value: unknown) => value is T, message: string): T {
  if (!validate(value)) throw new Error(message);
  return value as T;
}

function requiredObjectArray<T extends object>(value: unknown, validate: (value: unknown) => value is T, message: string): T[] {
  if (!Array.isArray(value) || value.some((item) => !validate(item))) throw new Error(message);
  return value as T[];
}

function directorySnapshotRevision(snapshot: DirectoryReadResponse): number {
  const revision = revisionFrom(snapshot);
  if (!Array.isArray(snapshot.trips) || snapshot.trips.some((trip) => !isTripSummary(trip))) {
    throw new Error('Plotter service returned an invalid directory snapshot.');
  }
  return revision;
}

function tripSnapshotRevision(snapshot: TripReadResponse): number {
  const revision = revisionFrom(snapshot);
  if (
    !Array.isArray(snapshot.destinations)
    || !Array.isArray(snapshot.routeLegs)
    || !Array.isArray(snapshot.activities)
    || snapshot.destinations.some((destination) => !isDestination(destination))
    || snapshot.routeLegs.some((routeLeg) => !isRouteLeg(routeLeg))
    || snapshot.activities.some((activity) => !isActivity(activity))
  ) {
    throw new Error('Plotter service returned an invalid trip snapshot.');
  }
  return revision;
}

function appendOptionalText(form: FormData, key: 'caption' | 'credit', value: string | undefined): void {
  if (value !== undefined) form.set(key, value);
}

function serviceRelativeUrl(value: string): string {
  return value.startsWith('/api/') ? value.slice(1) : value;
}

function serviceRelativeMediaItem(mediaItem: MediaItem): MediaItem {
  return {
    ...mediaItem,
    url: serviceRelativeUrl(mediaItem.url),
    ...(mediaItem.thumbnailUrl === undefined ? {} : { thumbnailUrl: serviceRelativeUrl(mediaItem.thumbnailUrl) }),
    ...(mediaItem.previewUrl === undefined ? {} : { previewUrl: serviceRelativeUrl(mediaItem.previewUrl) }),
    ...(mediaItem.fullUrl === undefined ? {} : { fullUrl: serviceRelativeUrl(mediaItem.fullUrl) }),
  };
}

function serviceRelativeMediaItems(mediaItems: MediaItem[]): MediaItem[] {
  return mediaItems.map(serviceRelativeMediaItem);
}

export function createServiceRepositories(client: PlotterApiClient): {
  directory: TripDirectoryRepository;
  createTripRepository(tripId: string): TripRepository;
} {
  let directoryRevision: number | undefined;

  function requireDirectoryRevision(): number {
    if (directoryRevision === undefined) throw new Error(READ_REQUIRED_MESSAGE);
    return directoryRevision;
  }

  async function loadDirectory() {
    const snapshot = await client.request<DirectoryReadResponse>('/api/v1/trips');
    directoryRevision = directorySnapshotRevision(snapshot);
    return snapshot;
  }

  const directory: TripDirectoryRepository = {
    loadDirectory,
    async listTrips() {
      return (await loadDirectory()).trips;
    },
    async createTrip(input) {
      const request: CreateTripRequest = { expectedRevision: requireDirectoryRevision(), ...input };
      const response = await client.request<DirectoryWriteResponse>('/api/v1/trips', jsonRequest('POST', request));
      const created = requiredObject<NonNullable<DirectoryWriteResponse['trip']>>(response.trip, isTripSummary, 'Plotter service did not return the created trip.');
      directoryRevision = revisionFrom(response);
      return created;
    },
    async updateTrip(tripId, patch) {
      const request: UpdateTripRequest = { expectedRevision: requireDirectoryRevision(), patch };
      const response = await client.request<DirectoryWriteResponse>(
        `/api/v1/trips/${routePart(tripId)}`,
        jsonRequest('PATCH', request),
      );
      const updated = requiredObject<NonNullable<DirectoryWriteResponse['trip']>>(response.trip, isTripSummary, 'Plotter service did not return the updated trip.');
      directoryRevision = revisionFrom(response);
      return updated;
    },
    async deleteTrip(tripId) {
      const response = await client.request<DirectoryWriteResponse>(
        `/api/v1/trips/${routePart(tripId)}`,
        jsonRequest('DELETE', { expectedRevision: requireDirectoryRevision() }),
      );
      directoryRevision = revisionFrom(response);
    },
  };

  function createTripRepository(tripId: string): TripRepository {
    let tripRevision: number | undefined;
    const tripPath = `/api/v1/trips/${routePart(tripId)}`;

    function requireTripRevision(): number {
      if (tripRevision === undefined) throw new Error(READ_REQUIRED_MESSAGE);
      return tripRevision;
    }

    async function loadSnapshot() {
      const snapshot = await client.request<TripReadResponse>(tripPath);
      tripRevision = tripSnapshotRevision(snapshot);
      return snapshot;
    }

    function commitTripRevision(response: { revision: unknown }): void {
      tripRevision = revisionFrom(response);
    }

    async function requestMutation(mutation: TripMutationRequest): Promise<TripWriteResponse> {
      return client.request<TripWriteResponse>(
        `${tripPath}/mutations`,
        jsonRequest('POST', { expectedRevision: requireTripRevision(), mutation }),
      );
    }

    async function requestMediaMutation(path: string, method: 'PATCH' | 'DELETE' | 'POST', body: unknown): Promise<MediaWriteResponse> {
      return client.request<MediaWriteResponse>(path, jsonRequest(method, {
        expectedRevision: requireTripRevision(),
        ...body as object,
      }));
    }

    return {
      loadSnapshot,
      async listDestinations() { return (await loadSnapshot()).destinations; },
      async saveDestination(destination) { commitTripRevision(await requestMutation({ type: 'save-destination', destination })); },
      async deleteDestination(destinationId) { commitTripRevision(await requestMutation({ type: 'delete-destination', destinationId })); },
      async deleteDestinations(destinationIds) { commitTripRevision(await requestMutation({ type: 'delete-destinations', destinationIds })); },
      async prepareDestinationDeletion(destinationIds) {
        return async () => { commitTripRevision(await requestMutation({ type: 'delete-destinations', destinationIds })); };
      },
      async listActivities(destinationId) {
        return (await loadSnapshot()).activities.filter((activity) => activity.destinationId === destinationId);
      },
      async createActivity(input) {
        const response = await requestMutation({ type: 'create-activity', input });
        const activity = requiredObject<NonNullable<TripWriteResponse['activity']>>(response.activity, isActivity, 'Plotter service did not return the created activity.');
        commitTripRevision(response);
        return activity;
      },
      async updateActivity(activityId, patch) {
        const response = await requestMutation({ type: 'update-activity', activityId, patch });
        const activity = requiredObject<NonNullable<TripWriteResponse['activity']>>(response.activity, isActivity, 'Plotter service did not return the updated activity.');
        commitTripRevision(response);
        return activity;
      },
      async deleteActivity(activityId) { commitTripRevision(await requestMutation({ type: 'delete-activity', activityId })); },
      async reorderActivities(destinationId, orderedActivityIds) {
        commitTripRevision(await requestMutation({ type: 'reorder-activities', destinationId, orderedActivityIds }));
        return (await loadSnapshot()).activities.filter((activity) => activity.destinationId === destinationId);
      },
      async listDestinationMedia(destinationId) {
        return serviceRelativeMediaItems((await client.request<{ mediaItems: MediaItem[] }>(`${tripPath}/destinations/${routePart(destinationId)}/media`)).mediaItems);
      },
      async uploadDestinationMedia(input) {
        const form = new FormData();
        form.set('file', input.file);
        appendOptionalText(form, 'caption', input.caption);
        appendOptionalText(form, 'credit', input.credit);
        const response = await client.upload<MediaWriteResponse>(
          `${tripPath}/destinations/${routePart(input.destinationId)}/media`, form, requireTripRevision(),
        );
        const mediaItem = requiredObject<NonNullable<MediaWriteResponse['mediaItem']>>(response.mediaItem, isMediaItem, 'Plotter service did not return the uploaded media.');
        commitTripRevision(response);
        return serviceRelativeMediaItem(mediaItem);
      },
      async importDestinationMediaFromSearch(input) {
        const body: DestinationMediaImportRequest = { expectedRevision: requireTripRevision(), result: input.result };
        const response = await client.request<MediaWriteResponse>(
          `${tripPath}/destinations/${routePart(input.destinationId)}/media/import`, jsonRequest('POST', body),
        );
        const mediaItem = requiredObject<NonNullable<MediaWriteResponse['mediaItem']>>(response.mediaItem, isMediaItem, 'Plotter service did not return the imported media.');
        commitTripRevision(response);
        return serviceRelativeMediaItem(mediaItem);
      },
      async updateDestinationMedia(mediaId, patch) {
        const response = await requestMediaMutation(`${tripPath}/destination-media/${routePart(mediaId)}`, 'PATCH', { patch });
        const mediaItem = requiredObject<NonNullable<MediaWriteResponse['mediaItem']>>(response.mediaItem, isMediaItem, 'Plotter service did not return the updated media.');
        commitTripRevision(response);
        return serviceRelativeMediaItem(mediaItem);
      },
      async deleteDestinationMedia(mediaId) { commitTripRevision(await requestMediaMutation(`${tripPath}/destination-media/${routePart(mediaId)}`, 'DELETE', {})); },
      async reorderDestinationMedia(destinationId, orderedMediaIds) {
        const response = await requestMediaMutation(`${tripPath}/destinations/${routePart(destinationId)}/media/reorder`, 'POST', { orderedMediaIds });
        const mediaItems = requiredObjectArray<MediaItem>(response.mediaItems, isMediaItem, 'Plotter service did not return reordered media.');
        commitTripRevision(response);
        return serviceRelativeMediaItems(mediaItems);
      },
      async listDestinationMediaRollup(destinationId) {
        return (await client.request<{ media: MediaRollupItem[] }>(`${tripPath}/destinations/${routePart(destinationId)}/media-rollup`)).media
          .map((item) => ({ ...item, mediaItem: serviceRelativeMediaItem(item.mediaItem) }));
      },
      async listActivityMedia(activityId) {
        return serviceRelativeMediaItems((await client.request<{ mediaItems: MediaItem[] }>(`${tripPath}/activities/${routePart(activityId)}/media`)).mediaItems);
      },
      async uploadActivityMedia(input) {
        const form = new FormData();
        form.set('file', input.file);
        appendOptionalText(form, 'caption', input.caption);
        appendOptionalText(form, 'credit', input.credit);
        const response = await client.upload<MediaWriteResponse>(
          `${tripPath}/destinations/${routePart(input.destinationId)}/activities/${routePart(input.activityId)}/media`, form, requireTripRevision(),
        );
        const mediaItem = requiredObject<NonNullable<MediaWriteResponse['mediaItem']>>(response.mediaItem, isMediaItem, 'Plotter service did not return the uploaded media.');
        commitTripRevision(response);
        return serviceRelativeMediaItem(mediaItem);
      },
      async importActivityMediaFromSearch(input) {
        const body: DestinationMediaImportRequest = { expectedRevision: requireTripRevision(), result: input.result };
        const response = await client.request<MediaWriteResponse>(
          `${tripPath}/destinations/${routePart(input.destinationId)}/activities/${routePart(input.activityId)}/media/import`, jsonRequest('POST', body),
        );
        const mediaItem = requiredObject<NonNullable<MediaWriteResponse['mediaItem']>>(response.mediaItem, isMediaItem, 'Plotter service did not return the imported media.');
        commitTripRevision(response);
        return serviceRelativeMediaItem(mediaItem);
      },
      async updateActivityMedia(mediaId, patch) {
        const response = await requestMediaMutation(`${tripPath}/activity-media/${routePart(mediaId)}`, 'PATCH', { patch });
        const mediaItem = requiredObject<NonNullable<MediaWriteResponse['mediaItem']>>(response.mediaItem, isMediaItem, 'Plotter service did not return the updated media.');
        commitTripRevision(response);
        return serviceRelativeMediaItem(mediaItem);
      },
      async deleteActivityMedia(mediaId) { commitTripRevision(await requestMediaMutation(`${tripPath}/activity-media/${routePart(mediaId)}`, 'DELETE', {})); },
      async reorderActivityMedia(activityId, orderedMediaIds) {
        const response = await requestMediaMutation(`${tripPath}/activities/${routePart(activityId)}/media/reorder`, 'POST', { orderedMediaIds });
        const mediaItems = requiredObjectArray<MediaItem>(response.mediaItems, isMediaItem, 'Plotter service did not return reordered media.');
        commitTripRevision(response);
        return serviceRelativeMediaItems(mediaItems);
      },
      async listRouteLegs() { return (await loadSnapshot()).routeLegs; },
      async saveRouteLeg(routeLeg) { commitTripRevision(await requestMutation({ type: 'save-route-leg', routeLeg })); },
      async deleteRouteLeg(routeLegId) { commitTripRevision(await requestMutation({ type: 'delete-route-leg', routeLegId })); },
      async applyTripMutation(delta) { commitTripRevision(await requestMutation({ type: 'apply-trip-mutation', delta })); },
      async replaceTripData(snapshot) { commitTripRevision(await requestMutation({ type: 'replace-trip-data', snapshot })); },
    } satisfies TripRepository;
  }

  return { directory, createTripRepository };
}
