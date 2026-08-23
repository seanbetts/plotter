import type { Activity, Destination, MediaItem, MediaRollupItem, RouteLeg } from '../domain/types';
import type { LinkPreviewResult } from '../services/linkPreviewClient';
import type { WebImageSearchResult, WebImageSearchStopContext } from '../services/webImageSearchClient';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import type { TripMutationDelta } from '../storage/tripRepository';
import type { DirectorySnapshot, RevisionEvent, TripContextSnapshot, TripSnapshot } from '../storage/revision';

export const plotterApiVersion = 'v1';

export type ApiErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'conflict'
  | 'storage-unavailable'
  | 'internal-error';

export type ApiErrorResponse =
  | { status: 400; error: { code: 'invalid-request'; message: string } }
  | { status: 404; error: { code: 'not-found'; message: string } }
  | { status: 409; error: { code: 'conflict'; message: string; currentRevision: number } }
  | { status: 503; error: { code: 'storage-unavailable'; message: string } }
  | { status: 500; error: { code: 'internal-error'; message: string } };

export type ApiSuccessResponse<T, Status extends 200 | 201 | 204 = 200> = {
  status: Status;
  body: T;
};

export type ApiRouteResponse<T, Status extends 200 | 201 | 204 = 200> =
  | ApiSuccessResponse<T, Status>
  | ApiErrorResponse;

export type DirectoryReadResponse = DirectorySnapshot;
export type TripReadResponse = TripSnapshot;
export type TripContextReadResponse = TripContextSnapshot;

export type CreateTripRequest = {
  expectedRevision: number;
  name: string;
  routingVehicle?: TripSummary['routingVehicle'];
};

export type UpdateTripRequest = {
  expectedRevision: number;
  patch: {
    name?: string;
    description?: string;
    routingVehicle?: TripSummary['routingVehicle'];
  };
};

export type DeleteTripRequest = {
  expectedRevision: number;
};

export type DirectoryWriteResponse = {
  revision: number;
  trip?: TripSummary;
};

export type ActivityPatch = Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>;
export type MediaPatch = Pick<Partial<MediaItem>, 'caption' | 'credit'>;
export type ReplaceTripDataRequest = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  activities?: Activity[];
};

/** Every non-media trip mutation has a bounded repository equivalent. */
export type TripMutationRequest =
  | { type: 'save-destination'; destination: Destination }
  | { type: 'delete-destination'; destinationId: string }
  | { type: 'delete-destinations'; destinationIds: string[] }
  | { type: 'save-route-leg'; routeLeg: RouteLeg }
  | { type: 'delete-route-leg'; routeLegId: string }
  | { type: 'apply-trip-mutation'; delta: TripMutationDelta }
  | { type: 'replace-trip-data'; snapshot: ReplaceTripDataRequest }
  | {
      type: 'create-activity';
      input: {
        destinationId: string;
        title: string;
        order?: number;
        location?: Activity['location'];
      };
    }
  | { type: 'update-activity'; activityId: string; patch: ActivityPatch }
  | { type: 'delete-activity'; activityId: string }
  | { type: 'reorder-activities'; destinationId: string; orderedActivityIds: string[] };

export type RevisionedTripMutationRequest = {
  expectedRevision: number;
  mutation: TripMutationRequest;
};

export type TripWriteResponse = {
  revision: number;
  activity?: Activity;
};

/** Multipart bodies carry bytes separately; this is their JSON field contract. */
export type DestinationMediaUploadFields = {
  expectedRevision: number;
  caption?: string;
  credit?: string;
};

export type ActivityMediaUploadFields = DestinationMediaUploadFields;

export type DestinationMediaImportRequest = {
  expectedRevision: number;
  result: WebImageSearchResult;
};

export type ActivityMediaImportRequest = DestinationMediaImportRequest;

export type UpdateMediaRequest = {
  expectedRevision: number;
  patch: MediaPatch;
};

export type DeleteMediaRequest = {
  expectedRevision: number;
};

export type ReorderMediaRequest = {
  expectedRevision: number;
  orderedMediaIds: string[];
};

export type MediaWriteResponse = {
  revision: number;
  mediaItem?: MediaItem;
  mediaItems?: MediaItem[];
};

export type DestinationMediaReadResponse = { mediaItems: MediaItem[] };
export type ActivityMediaReadResponse = { mediaItems: MediaItem[] };
export type DestinationMediaRollupReadResponse = { media: MediaRollupItem[] };

/** Binary media is streamed directly rather than encoded as a JSON success body. */
export type MediaContentSuccessResponse = {
  status: 200;
  contentType: string;
  contentLength: number;
  bytes: AsyncIterable<Uint8Array>;
};

export type MediaContentRouteResponse = MediaContentSuccessResponse | ApiErrorResponse;

export type LinkPreviewRequest = { url: string };
export type LinkPreviewResponse = { preview: LinkPreviewResult };
export type ImageSearchRequest = { query: string; context: WebImageSearchStopContext };
export type ImageSearchResponse = { results: WebImageSearchResult[] };

export type BackupSummary = {
  id: string;
  createdAt: string;
  schemaVersion: number;
  directoryRevision: number;
  tripRevisions: Record<string, number>;
};

export type BackupFileManifest = {
  path: string;
  byteCount: number;
  sha256: string;
};

export type BackupManifest = BackupSummary & {
  files: BackupFileManifest[];
};

export type CreateBackupResponse = { backup: BackupSummary };
export type ListBackupsResponse = { backups: BackupSummary[] };
export type InspectBackupResponse = { backup: BackupManifest };
export type RestoreBackupRequest = { confirmation: string };
export type RestoreBackupResponse = { restored: BackupSummary };
export type HealthResponse = { ready: boolean; reason?: string };

/** The exact public routes; dynamic segments are represented by named templates. */
export type PlotterApiRoute =
  | { method: 'GET'; path: '/healthz'; response: ApiRouteResponse<HealthResponse> }
  | { method: 'GET'; path: '/api/v1/trips'; response: ApiRouteResponse<DirectoryReadResponse> }
  | { method: 'POST'; path: '/api/v1/trips'; request: CreateTripRequest; response: ApiRouteResponse<DirectoryWriteResponse, 201> }
  | { method: 'GET'; path: '/api/v1/trips/:tripId'; response: ApiRouteResponse<TripReadResponse> }
  | { method: 'GET'; path: '/api/v1/trips/:tripId/context'; response: ApiRouteResponse<TripContextReadResponse> }
  | { method: 'PATCH'; path: '/api/v1/trips/:tripId'; request: UpdateTripRequest; response: ApiRouteResponse<DirectoryWriteResponse> }
  | { method: 'DELETE'; path: '/api/v1/trips/:tripId'; request: DeleteTripRequest; response: ApiRouteResponse<DirectoryWriteResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/mutations'; request: RevisionedTripMutationRequest; response: ApiRouteResponse<TripWriteResponse> }
  | { method: 'GET'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media'; response: ApiRouteResponse<DestinationMediaReadResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media'; request: DestinationMediaUploadFields; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media/import'; request: DestinationMediaImportRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'PATCH'; path: '/api/v1/trips/:tripId/destination-media/:mediaId'; request: UpdateMediaRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'DELETE'; path: '/api/v1/trips/:tripId/destination-media/:mediaId'; request: DeleteMediaRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media/reorder'; request: ReorderMediaRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'GET'; path: '/api/v1/trips/:tripId/activities/:activityId/media'; response: ApiRouteResponse<ActivityMediaReadResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/activities/:activityId/media'; request: ActivityMediaUploadFields; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/activities/:activityId/media/import'; request: ActivityMediaImportRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'PATCH'; path: '/api/v1/trips/:tripId/activity-media/:mediaId'; request: UpdateMediaRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'DELETE'; path: '/api/v1/trips/:tripId/activity-media/:mediaId'; request: DeleteMediaRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/activities/:activityId/media/reorder'; request: ReorderMediaRequest; response: ApiRouteResponse<MediaWriteResponse> }
  | { method: 'GET'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media-rollup'; response: ApiRouteResponse<DestinationMediaRollupReadResponse> }
  | { method: 'GET'; path: '/api/v1/media/:mediaId/content'; response: MediaContentRouteResponse }
  | { method: 'POST'; path: '/api/v1/link-preview'; request: LinkPreviewRequest; response: ApiRouteResponse<LinkPreviewResponse> }
  | { method: 'POST'; path: '/api/v1/image-search'; request: ImageSearchRequest; response: ApiRouteResponse<ImageSearchResponse> }
  | { method: 'GET'; path: '/api/v1/events'; response: ApiRouteResponse<RevisionEvent> }
  | { method: 'POST'; path: '/api/v1/backups'; response: ApiRouteResponse<CreateBackupResponse, 201> }
  | { method: 'GET'; path: '/api/v1/backups'; response: ApiRouteResponse<ListBackupsResponse> }
  | { method: 'GET'; path: '/api/v1/backups/:backupId'; response: ApiRouteResponse<InspectBackupResponse> }
  | { method: 'POST'; path: '/api/v1/backups/:backupId/restore'; request: RestoreBackupRequest; response: ApiRouteResponse<RestoreBackupResponse> };
