import { describe, expect, it } from 'vitest';
import type {
  ApiErrorResponse,
  DestinationMediaUploadFields,
  PlotterApiRoute,
} from './contracts';

const uploadFields: DestinationMediaUploadFields = {
  expectedRevision: 7,
  caption: 'Northern lights',
  credit: 'Example photographer',
};

const mediaReadRoutes: PlotterApiRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/trips/:tripId/destinations/:destinationId/media',
    response: { status: 200, body: { mediaItems: [] } },
  },
  {
    method: 'GET',
    path: '/api/v1/trips/:tripId/activities/:activityId/media',
    response: { status: 200, body: { mediaItems: [] } },
  },
  {
    method: 'GET',
    path: '/api/v1/trips/:tripId/destinations/:destinationId/media-rollup',
    response: { status: 200, body: { media: [] } },
  },
];

const conflict: Extract<ApiErrorResponse, { status: 409 }> = {
  status: 409,
  error: {
    code: 'conflict',
    message: 'Another device changed this data. Plotter reloaded the latest version.',
    currentRevision: 8,
  },
};

const mediaContentRoute: Extract<PlotterApiRoute, { path: '/api/v1/media/:mediaId/content' }> = {
  method: 'GET',
  path: '/api/v1/media/:mediaId/content',
  response: {
    status: 200,
    contentType: 'image/webp',
    contentLength: 1234,
    bytes: (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })(),
  },
};

describe('Plotter API contracts', () => {
  it('requires revisions for uploads and exposes typed media reads and conflicts', () => {
    expect(uploadFields.expectedRevision).toBe(7);
    expect(mediaReadRoutes).toHaveLength(3);
    expect(conflict.error.currentRevision).toBe(8);
    expect(mediaContentRoute.response.status).toBe(200);
  });
});
