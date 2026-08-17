import { describe, expect, it } from 'vitest';
import type { PlotterApiClient } from '../api/client';
import { createDestination } from '../domain/destinations';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { TripSummary } from './tripDirectoryRepository';
import { createServiceRepositories } from './serviceRepositories';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function trip(id = 'trip-1'): TripSummary {
  return {
    id,
    name: 'Alps',
    description: '',
    routingVehicle: resolveVehiclePreset('standard'),
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
  };
}

function recordingClient() {
  const calls: Array<{ path: string; init?: RequestInit; form?: FormData; expectedRevision?: number }> = [];
  const responses: unknown[] = [];
  const client: PlotterApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      calls.push({ path, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next as T;
    },
    async upload<T>(path: string, form: FormData, expectedRevision: number) {
      calls.push({ path, form, expectedRevision });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next as T;
    },
  };
  return { client, calls, responses };
}

function responseBody(call: { init?: RequestInit }) {
  if (typeof call.init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(call.init.body) as Record<string, unknown>;
}

describe('service repositories', () => {
  it('does not let older overlapping reads roll directory or trip mutation revisions back', async () => {
    const directoryHarness = recordingClient();
    const directory = createServiceRepositories(directoryHarness.client).directory;
    const olderDirectoryRead = createDeferred<{ revision: number; trips: TripSummary[] }>();
    const newerDirectoryRead = createDeferred<{ revision: number; trips: TripSummary[] }>();
    directoryHarness.responses.push(olderDirectoryRead.promise, newerDirectoryRead.promise);

    const olderDirectoryPromise = directory.loadDirectory?.();
    const newerDirectoryPromise = directory.loadDirectory?.();
    newerDirectoryRead.resolve({ revision: 9, trips: [trip()] });
    await newerDirectoryPromise;
    olderDirectoryRead.resolve({ revision: 8, trips: [trip()] });
    await olderDirectoryPromise;
    directoryHarness.responses.push({ revision: 10 });
    await directory.deleteTrip('trip-1');
    expect(responseBody(directoryHarness.calls[2]!)).toEqual({ expectedRevision: 9 });

    const tripHarness = recordingClient();
    const repository = createServiceRepositories(tripHarness.client).createTripRepository('trip-1');
    const destination = createDestination({ name: 'Aosta', coordinates: { lat: 45.737, lng: 7.32 } });
    const olderTripRead = createDeferred<{ revision: number; destinations: Array<typeof destination>; routeLegs: []; activities: [] }>();
    const newerTripRead = createDeferred<{ revision: number; destinations: Array<typeof destination>; routeLegs: []; activities: [] }>();
    tripHarness.responses.push(olderTripRead.promise, newerTripRead.promise);

    const olderTripPromise = repository.loadSnapshot?.();
    const newerTripPromise = repository.loadSnapshot?.();
    newerTripRead.resolve({ revision: 12, destinations: [destination], routeLegs: [], activities: [] });
    await newerTripPromise;
    olderTripRead.resolve({ revision: 11, destinations: [destination], routeLegs: [], activities: [] });
    await olderTripPromise;
    tripHarness.responses.push({ revision: 13 });
    await repository.saveDestination(destination);
    expect(responseBody(tripHarness.calls[2]!)).toMatchObject({ expectedRevision: 12 });
  });

  it('does not let malformed directory or trip reads prime a mutation revision', async () => {
    const directoryHarness = recordingClient();
    const directory = createServiceRepositories(directoryHarness.client).directory;
    directoryHarness.responses.push({ revision: 4, trips: [{}] });
    await expect(directory.listTrips()).rejects.toThrow('Plotter service returned an invalid directory snapshot.');
    await expect(directory.createTrip({ name: 'Alps' })).rejects.toThrow('Load the latest Plotter data before making changes.');
    expect(directoryHarness.calls).toHaveLength(1);

    const tripHarness = recordingClient();
    const repository = createServiceRepositories(tripHarness.client).createTripRepository('trip-1');
    tripHarness.responses.push({ revision: 7, destinations: [{}], routeLegs: [], activities: [] });
    await expect(repository.listDestinations()).rejects.toThrow('Plotter service returned an invalid trip snapshot.');
    await expect(repository.deleteDestination('destination-1')).rejects.toThrow('Load the latest Plotter data before making changes.');
    expect(tripHarness.calls).toHaveLength(1);
  });

  it('requires a successful directory read before mutations and replaces only the read revision after success', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).directory;

    await expect(repository.createTrip({ name: 'Alps' })).rejects.toThrow('Load the latest Plotter data before making changes.');

    harness.responses.push({ revision: 4, trips: [trip()] });
    await expect(repository.listTrips()).resolves.toEqual([trip()]);
    harness.responses.push({ revision: 5, trip: trip('trip-2') });
    await expect(repository.createTrip({ name: 'Dolomites' })).resolves.toEqual(trip('trip-2'));
    expect(responseBody(harness.calls[1]!)).toEqual({ expectedRevision: 4, name: 'Dolomites' });

    harness.responses.push(new Error('request failed'));
    await expect(repository.updateTrip('trip-2', { name: 'Stale' })).rejects.toThrow('request failed');
    harness.responses.push({ revision: 6 });
    await repository.deleteTrip('trip-2');
    expect(responseBody(harness.calls[3]!)).toEqual({ expectedRevision: 5 });
  });

  it('does not advance the directory revision when a required trip payload is malformed', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).directory;
    harness.responses.push({ revision: 4, trips: [trip()] });
    await repository.listTrips();
    harness.responses.push({ revision: 5, trip: {} });
    await expect(repository.createTrip({ name: 'Dolomites' }))
      .rejects.toThrow('Plotter service did not return the created trip.');
    harness.responses.push({ revision: 6 });
    await repository.deleteTrip('trip-1');
    expect(responseBody(harness.calls[2]!)).toEqual({ expectedRevision: 4 });
  });

  it('requires each trip adapter to read a coherent snapshot before mutations and advances only on successful writes', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).createTripRepository('trip one');
    const destination = createDestination({ name: 'Aosta', coordinates: { lat: 45.737, lng: 7.32 } });

    await expect(repository.saveDestination(destination)).rejects.toThrow('Load the latest Plotter data before making changes.');
    harness.responses.push({ revision: 7, destinations: [destination], routeLegs: [], activities: [] });
    await expect(repository.listDestinations()).resolves.toEqual([destination]);
    harness.responses.push({ revision: 8 });
    await repository.saveDestination(destination);
    expect(responseBody(harness.calls[1]!)).toEqual({
      expectedRevision: 7,
      mutation: { type: 'save-destination', destination },
    });

    harness.responses.push(new Error('offline'));
    await expect(repository.deleteDestination(destination.id)).rejects.toThrow('offline');
    harness.responses.push({ revision: 9 });
    await repository.deleteDestination(destination.id);
    expect(responseBody(harness.calls[3]!)).toEqual({
      expectedRevision: 8,
      mutation: { type: 'delete-destination', destinationId: destination.id },
    });
  });

  it('does not advance the trip revision when an activity or media success body is incomplete', async () => {
    const activityHarness = recordingClient();
    const activityRepository = createServiceRepositories(activityHarness.client).createTripRepository('trip-1');
    activityHarness.responses.push({ revision: 7, destinations: [], routeLegs: [], activities: [] });
    await activityRepository.loadSnapshot?.();
    activityHarness.responses.push({ revision: 8, activity: {} });
    await expect(activityRepository.createActivity({ destinationId: 'destination-1', title: 'Museum' }))
      .rejects.toThrow('Plotter service did not return the created activity.');
    activityHarness.responses.push({ revision: 9 });
    await activityRepository.deleteDestination('destination-1');
    expect(responseBody(activityHarness.calls[2]!)).toEqual({
      expectedRevision: 7,
      mutation: { type: 'delete-destination', destinationId: 'destination-1' },
    });

    const mediaHarness = recordingClient();
    const mediaRepository = createServiceRepositories(mediaHarness.client).createTripRepository('trip-1');
    mediaHarness.responses.push({ revision: 3, destinations: [], routeLegs: [], activities: [] });
    await mediaRepository.loadSnapshot?.();
    mediaHarness.responses.push({ revision: 4, mediaItem: {} });
    await expect(mediaRepository.uploadDestinationMedia({
      destinationId: 'destination-1', file: new File(['image'], 'alps.png', { type: 'image/png' }),
    })).rejects.toThrow('Plotter service did not return the uploaded media.');
    mediaHarness.responses.push({ revision: 5 });
    await mediaRepository.deleteDestinationMedia('media-1');
    expect(responseBody(mediaHarness.calls[2]!)).toEqual({ expectedRevision: 3 });

    const reorderHarness = recordingClient();
    const reorderRepository = createServiceRepositories(reorderHarness.client).createTripRepository('trip-1');
    reorderHarness.responses.push({ revision: 12, destinations: [], routeLegs: [], activities: [] });
    await reorderRepository.loadSnapshot?.();
    reorderHarness.responses.push({ revision: 13, mediaItems: [{}] });
    await expect(reorderRepository.reorderDestinationMedia('destination-1', ['media-1']))
      .rejects.toThrow('Plotter service did not return reordered media.');
    reorderHarness.responses.push({ revision: 14 });
    await reorderRepository.deleteDestinationMedia('media-1');
    expect(responseBody(reorderHarness.calls[2]!)).toEqual({ expectedRevision: 12 });
  });

  it('uses bounded media routes, carries revisions through multipart upload, and retains service-relative media URLs', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).createTripRepository('trip-1');
    const serviceMedia = { id: 'media-1', url: '/api/v1/media/media-1/content', caption: '', credit: '', sortOrder: 0, bucketId: 'local-media', objectPath: 'media/media-1.png', uploadedAt: '2026-08-17T10:00:00.000Z' };
    const media = { ...serviceMedia, url: 'api/v1/media/media-1/content' };

    harness.responses.push({ revision: 2, destinations: [], routeLegs: [], activities: [] });
    await repository.loadSnapshot?.();
    harness.responses.push({ revision: 3, mediaItem: serviceMedia });
    await expect(repository.uploadDestinationMedia({
      destinationId: 'destination-1', file: new File(['image'], 'alps.png', { type: 'image/png' }), caption: 'Alps',
    })).resolves.toEqual(media);

    expect(harness.calls[1]).toMatchObject({
      path: '/api/v1/trips/trip-1/destinations/destination-1/media',
      expectedRevision: 2,
    });
    expect(harness.calls[1]?.form?.get('caption')).toBe('Alps');
    expect(media.url).toBe('api/v1/media/media-1/content');
  });

});
