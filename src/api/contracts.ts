import type { Activity, Destination, MediaItem, RouteLeg } from '../domain/types';
import type { LinkPreviewResult } from '../services/linkPreviewClient';
import type { WebImageSearchResult, WebImageSearchStopContext } from '../services/webImageSearchClient';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import type { TripMutationDelta } from '../storage/tripRepository';
import type { DirectorySnapshot, RevisionEvent, TripSnapshot } from '../storage/revision';

export const plotterApiVersion = 'v1';

export type ApiErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'conflict'
  | 'storage-unavailable'
  | 'internal-error';

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    currentRevision?: number;
  };
};

export type DirectoryReadResponse = DirectorySnapshot;
export type TripReadResponse = TripSnapshot;

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
  destinationId: string;
  caption?: string;
  credit?: string;
};

export type ActivityMediaUploadFields = DestinationMediaUploadFields & {
  activityId: string;
};

export type DestinationMediaImportRequest = {
  expectedRevision: number;
  result: WebImageSearchResult;
};

export type ActivityMediaImportRequest = DestinationMediaImportRequest & {
  destinationId: string;
};

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

/** The exact public routes; dynamic segments are represented by named templates. */
export type PlotterApiRoute =
  | { method: 'GET'; path: '/healthz' }
  | { method: 'GET'; path: '/api/v1/trips'; response: DirectoryReadResponse }
  | { method: 'POST'; path: '/api/v1/trips'; request: CreateTripRequest; response: DirectoryWriteResponse }
  | { method: 'GET'; path: '/api/v1/trips/:tripId'; response: TripReadResponse }
  | { method: 'PATCH'; path: '/api/v1/trips/:tripId'; request: UpdateTripRequest; response: DirectoryWriteResponse }
  | { method: 'DELETE'; path: '/api/v1/trips/:tripId'; request: DeleteTripRequest; response: DirectoryWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/mutations'; request: RevisionedTripMutationRequest; response: TripWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media'; request: DestinationMediaUploadFields; response: MediaWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media/import'; request: DestinationMediaImportRequest; response: MediaWriteResponse }
  | { method: 'PATCH'; path: '/api/v1/trips/:tripId/destination-media/:mediaId'; request: UpdateMediaRequest; response: MediaWriteResponse }
  | { method: 'DELETE'; path: '/api/v1/trips/:tripId/destination-media/:mediaId'; request: DeleteMediaRequest; response: MediaWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/media/reorder'; request: ReorderMediaRequest; response: MediaWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/activities/:activityId/media'; request: ActivityMediaUploadFields; response: MediaWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/destinations/:destinationId/activities/:activityId/media/import'; request: ActivityMediaImportRequest; response: MediaWriteResponse }
  | { method: 'PATCH'; path: '/api/v1/trips/:tripId/activity-media/:mediaId'; request: UpdateMediaRequest; response: MediaWriteResponse }
  | { method: 'DELETE'; path: '/api/v1/trips/:tripId/activity-media/:mediaId'; request: DeleteMediaRequest; response: MediaWriteResponse }
  | { method: 'POST'; path: '/api/v1/trips/:tripId/activities/:activityId/media/reorder'; request: ReorderMediaRequest; response: MediaWriteResponse }
  | { method: 'GET'; path: '/api/v1/media/:mediaId/content' }
  | { method: 'POST'; path: '/api/v1/link-preview'; request: LinkPreviewRequest; response: LinkPreviewResponse }
  | { method: 'POST'; path: '/api/v1/image-search'; request: ImageSearchRequest; response: ImageSearchResponse }
  | { method: 'GET'; path: '/api/v1/events'; response: RevisionEvent }
  | { method: 'POST'; path: '/api/v1/backups'; response: CreateBackupResponse }
  | { method: 'GET'; path: '/api/v1/backups'; response: ListBackupsResponse }
  | { method: 'GET'; path: '/api/v1/backups/:backupId'; response: InspectBackupResponse }
  | { method: 'POST'; path: '/api/v1/backups/:backupId/restore'; request: RestoreBackupRequest; response: RestoreBackupResponse };
