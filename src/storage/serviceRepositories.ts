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
import type { MediaItem, MediaRollupItem } from '../domain/types';
import type { TripDirectoryRepository } from './tripDirectoryRepository';
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

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function directorySnapshotRevision(snapshot: DirectoryReadResponse): number {
  const revision = revisionFrom(snapshot);
  if (!Array.isArray(snapshot.trips)) throw new Error('Plotter service returned an invalid directory snapshot.');
  return revision;
}

function tripSnapshotRevision(snapshot: TripReadResponse): number {
  const revision = revisionFrom(snapshot);
  if (!Array.isArray(snapshot.destinations) || !Array.isArray(snapshot.routeLegs) || !Array.isArray(snapshot.activities)) {
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
      const created = requiredValue(response.trip, 'Plotter service did not return the created trip.');
      directoryRevision = revisionFrom(response);
      return created;
    },
    async updateTrip(tripId, patch) {
      const request: UpdateTripRequest = { expectedRevision: requireDirectoryRevision(), patch };
      const response = await client.request<DirectoryWriteResponse>(
        `/api/v1/trips/${routePart(tripId)}`,
        jsonRequest('PATCH', request),
      );
      const updated = requiredValue(response.trip, 'Plotter service did not return the updated trip.');
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

    async function mutate(mutation: TripMutationRequest): Promise<TripWriteResponse> {
      const response = await client.request<TripWriteResponse>(
        `${tripPath}/mutations`,
        jsonRequest('POST', { expectedRevision: requireTripRevision(), mutation }),
      );
      tripRevision = revisionFrom(response);
      return response;
    }

    async function mediaMutation(path: string, method: 'PATCH' | 'DELETE' | 'POST', body: unknown): Promise<MediaWriteResponse> {
      const response = await client.request<MediaWriteResponse>(path, jsonRequest(method, {
        expectedRevision: requireTripRevision(),
        ...body as object,
      }));
      tripRevision = revisionFrom(response);
      return response;
    }

    return {
      loadSnapshot,
      async listDestinations() { return (await loadSnapshot()).destinations; },
      async saveDestination(destination) { await mutate({ type: 'save-destination', destination }); },
      async deleteDestination(destinationId) { await mutate({ type: 'delete-destination', destinationId }); },
      async deleteDestinations(destinationIds) { await mutate({ type: 'delete-destinations', destinationIds }); },
      async prepareDestinationDeletion(destinationIds) {
        return async () => { await mutate({ type: 'delete-destinations', destinationIds }); };
      },
      async listActivities(destinationId) {
        return (await loadSnapshot()).activities.filter((activity) => activity.destinationId === destinationId);
      },
      async createActivity(input) {
        return requiredValue((await mutate({ type: 'create-activity', input })).activity, 'Plotter service did not return the created activity.');
      },
      async updateActivity(activityId, patch) {
        return requiredValue((await mutate({ type: 'update-activity', activityId, patch })).activity, 'Plotter service did not return the updated activity.');
      },
      async deleteActivity(activityId) { await mutate({ type: 'delete-activity', activityId }); },
      async reorderActivities(destinationId, orderedActivityIds) {
        await mutate({ type: 'reorder-activities', destinationId, orderedActivityIds });
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
        tripRevision = revisionFrom(response);
        return serviceRelativeMediaItem(requiredValue(response.mediaItem, 'Plotter service did not return the uploaded media.'));
      },
      async importDestinationMediaFromSearch(input) {
        const body: DestinationMediaImportRequest = { expectedRevision: requireTripRevision(), result: input.result };
        const response = await client.request<MediaWriteResponse>(
          `${tripPath}/destinations/${routePart(input.destinationId)}/media/import`, jsonRequest('POST', body),
        );
        tripRevision = revisionFrom(response);
        return serviceRelativeMediaItem(requiredValue(response.mediaItem, 'Plotter service did not return the imported media.'));
      },
      async updateDestinationMedia(mediaId, patch) {
        return serviceRelativeMediaItem(requiredValue((await mediaMutation(`${tripPath}/destination-media/${routePart(mediaId)}`, 'PATCH', { patch })).mediaItem, 'Plotter service did not return the updated media.'));
      },
      async deleteDestinationMedia(mediaId) { await mediaMutation(`${tripPath}/destination-media/${routePart(mediaId)}`, 'DELETE', {}); },
      async reorderDestinationMedia(destinationId, orderedMediaIds) {
        return serviceRelativeMediaItems(requiredValue((await mediaMutation(`${tripPath}/destinations/${routePart(destinationId)}/media/reorder`, 'POST', { orderedMediaIds })).mediaItems, 'Plotter service did not return reordered media.'));
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
        tripRevision = revisionFrom(response);
        return serviceRelativeMediaItem(requiredValue(response.mediaItem, 'Plotter service did not return the uploaded media.'));
      },
      async importActivityMediaFromSearch(input) {
        const body: DestinationMediaImportRequest = { expectedRevision: requireTripRevision(), result: input.result };
        const response = await client.request<MediaWriteResponse>(
          `${tripPath}/destinations/${routePart(input.destinationId)}/activities/${routePart(input.activityId)}/media/import`, jsonRequest('POST', body),
        );
        tripRevision = revisionFrom(response);
        return serviceRelativeMediaItem(requiredValue(response.mediaItem, 'Plotter service did not return the imported media.'));
      },
      async updateActivityMedia(mediaId, patch) {
        return serviceRelativeMediaItem(requiredValue((await mediaMutation(`${tripPath}/activity-media/${routePart(mediaId)}`, 'PATCH', { patch })).mediaItem, 'Plotter service did not return the updated media.'));
      },
      async deleteActivityMedia(mediaId) { await mediaMutation(`${tripPath}/activity-media/${routePart(mediaId)}`, 'DELETE', {}); },
      async reorderActivityMedia(activityId, orderedMediaIds) {
        return serviceRelativeMediaItems(requiredValue((await mediaMutation(`${tripPath}/activities/${routePart(activityId)}/media/reorder`, 'POST', { orderedMediaIds })).mediaItems, 'Plotter service did not return reordered media.'));
      },
      async listRouteLegs() { return (await loadSnapshot()).routeLegs; },
      async saveRouteLeg(routeLeg) { await mutate({ type: 'save-route-leg', routeLeg }); },
      async deleteRouteLeg(routeLegId) { await mutate({ type: 'delete-route-leg', routeLegId }); },
      async applyTripMutation(delta) { await mutate({ type: 'apply-trip-mutation', delta }); },
      async replaceTripData(snapshot) { await mutate({ type: 'replace-trip-data', snapshot }); },
    } satisfies TripRepository;
  }

  return { directory, createTripRepository };
}
