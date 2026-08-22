import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  existsSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import type {
  ActivityPatch,
  BackupManifest,
  BackupSummary,
  ImageSearchRequest,
  LinkPreviewRequest,
  RestoreBackupRequest,
  TripMutationRequest,
} from '../src/api/contracts';
import { isCanonicalId } from '../src/api/identifiers';
import type { Activity, Destination, MediaItem, RouteLeg, TripRoutingVehicle } from '../src/domain/types';
import { buildWebImageProviderQuery, type WebImageSearchResult } from '../src/services/webImageSearchClient';
import { TripStorageConflictError, type RevisionEvent } from '../src/storage/revision';
import type { RevisionedDirectoryStore } from './directoryRepository';
import { MAX_MEDIA_BYTES, type MediaStore } from './mediaStore';
import {
  PortableBackupCreateError,
  PortableBackupInvalidError,
  PortableRestoreConfirmationError,
  PortableRestoreIncompleteError,
  PortableRestoreRecoveredError,
  type StorageOperationGate,
} from './portableBackup';
import type { RevisionedTripStore } from './tripRepository';

const MAX_JSON_BYTES = 1_048_576;
const MAX_MULTIPART_BYTES = MAX_MEDIA_BYTES + MAX_JSON_BYTES;
const SSE_HEARTBEAT_MS = 15_000;
const INVALID_REQUEST_MESSAGE = 'The request is invalid.';
const STORAGE_UNAVAILABLE_MESSAGE = 'Plotter storage is unavailable.';
const INTERNAL_ERROR_MESSAGE = 'Plotter could not complete the request.';
const NOT_FOUND_MESSAGE = 'The requested Plotter resource was not found.';

type BinaryContent = {
  contentType: string;
  contentLength: number;
  filename?: string;
  bytes: AsyncIterable<Uint8Array>;
};

export type RevisionEventSource = {
  subscribe(listener: (event: RevisionEvent) => void): () => void;
};

export type MediaContentReader = {
  open(mediaId: string): Promise<BinaryContent>;
};

export type PlotterProviderOperations = {
  linkPreview(input: { url: string }, signal: AbortSignal): Promise<{
    url: string;
    title: string;
    domain: string;
    imageUrl?: string;
  }>;
  imageSearch(
    input: { query: string },
    apiKey: string,
    signal: AbortSignal,
  ): Promise<WebImageSearchResult[]>;
  remoteImage(
    input: { url: string },
    signal: AbortSignal,
  ): Promise<{ bytes: ReadableStream<Uint8Array>; contentType: string }>;
  imageSearchApiKey?: string;
};

export type PlotterBackupOperations = {
  create(): Promise<BackupSummary>;
  list(): Promise<BackupSummary[]>;
  inspect(backupId: string): Promise<BackupManifest>;
  restore(backupId: string, request: RestoreBackupRequest): Promise<BackupSummary>;
};

export type PlotterHttpDependencies = {
  directory: RevisionedDirectoryStore;
  tripRepository(tripId: string): RevisionedTripStore;
  media: MediaStore;
  mediaContent: MediaContentReader;
  events: RevisionEventSource;
  readiness(): { ready: boolean; reason?: string };
  providers: PlotterProviderOperations;
  backups: PlotterBackupOperations;
  operations?: StorageOperationGate;
  publicRoot: string;
};

class HttpError extends Error {
  readonly status: 400 | 404 | 503;

  constructor(
    status: 400 | 404 | 503,
    message: string,
  ) {
    super(message);
    this.status = status;
  }
}

export class BackupOperationsUnavailableError extends Error {
  constructor() {
    super('Portable backup operations are not available yet.');
    this.name = 'BackupOperationsUnavailableError';
  }
}

function invalid(): never {
  throw new HttpError(400, INVALID_REQUEST_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, allowedKeys: readonly string[], requiredKeys: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value)) invalid();
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key)) || requiredKeys.some((key) => !(key in value))) invalid();
  return value;
}

function stringValue(value: unknown, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) invalid();
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : stringValue(value);
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function idValue(value: unknown): string {
  const id = stringValue(value, false);
  if (!isCanonicalId(id)) invalid();
  return id;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}

function stringArray(value: unknown, ids = false): string[] {
  if (!Array.isArray(value)) invalid();
  return value.map((item) => ids ? idValue(item) : stringValue(item));
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : finiteNumber(value);
}

function coordinates(value: unknown): { lat: number; lng: number } {
  const input = record(value, ['lat', 'lng'], ['lat', 'lng']);
  return { lat: finiteNumber(input.lat), lng: finiteNumber(input.lng) };
}

function routingVehicle(value: unknown): TripRoutingVehicle {
  const input = record(value, ['preset', 'profile', 'vehicleType', 'restrictions'], ['preset', 'profile', 'restrictions']);
  const restrictions = record(input.restrictions, ['length', 'width', 'height', 'weight', 'axleLoad']);
  return {
    preset: oneOf(input.preset, ['standard', 'large-camper', 'expedition-truck'] as const),
    profile: oneOf(input.profile, ['driving-car', 'driving-hgv'] as const),
    ...(input.vehicleType === undefined ? {} : { vehicleType: oneOf(input.vehicleType, ['hgv'] as const) }),
    restrictions: {
      ...(restrictions.length === undefined ? {} : { length: finiteNumber(restrictions.length) }),
      ...(restrictions.width === undefined ? {} : { width: finiteNumber(restrictions.width) }),
      ...(restrictions.height === undefined ? {} : { height: finiteNumber(restrictions.height) }),
      ...(restrictions.weight === undefined ? {} : { weight: finiteNumber(restrictions.weight) }),
      ...(restrictions.axleLoad === undefined ? {} : { axleLoad: finiteNumber(restrictions.axleLoad) }),
    },
  };
}

function destinationLocation(value: unknown): Destination['location'] {
  const input = record(value,
    ['placeName', 'regionName', 'countryName', 'countryCode', 'sourceLabel', 'sourceProvider', 'sourceFeatureId'],
    ['placeName', 'regionName', 'countryName', 'sourceLabel', 'sourceProvider']);
  return {
    placeName: stringValue(input.placeName),
    regionName: stringValue(input.regionName),
    countryName: stringValue(input.countryName),
    ...(input.countryCode === undefined ? {} : { countryCode: stringValue(input.countryCode) }),
    sourceLabel: stringValue(input.sourceLabel),
    sourceProvider: oneOf(input.sourceProvider, ['maptiler', 'legacy'] as const),
    ...(input.sourceFeatureId === undefined ? {} : { sourceFeatureId: stringValue(input.sourceFeatureId) }),
  };
}

function researchLink(value: unknown) {
  const input = record(value, ['id', 'title', 'url', 'domain', 'imageUrl', 'sortOrder', 'previewFetchedAt'], ['id', 'title', 'url', 'domain', 'sortOrder']);
  return {
    id: idValue(input.id),
    title: stringValue(input.title),
    url: stringValue(input.url),
    domain: stringValue(input.domain),
    ...(input.imageUrl === undefined ? {} : { imageUrl: stringValue(input.imageUrl) }),
    sortOrder: nonNegativeInteger(input.sortOrder),
    ...(input.previewFetchedAt === undefined ? {} : { previewFetchedAt: stringValue(input.previewFetchedAt) }),
  };
}

function mediaItem(value: unknown): MediaItem {
  const input = record(value,
    ['id', 'url', 'thumbnailUrl', 'previewUrl', 'fullUrl', 'caption', 'credit', 'sortOrder', 'bucketId', 'objectPath', 'contentType', 'sizeBytes', 'uploadedAt'],
    ['id', 'url', 'caption', 'credit']);
  return {
    id: idValue(input.id),
    url: stringValue(input.url),
    ...(input.thumbnailUrl === undefined ? {} : { thumbnailUrl: stringValue(input.thumbnailUrl) }),
    ...(input.previewUrl === undefined ? {} : { previewUrl: stringValue(input.previewUrl) }),
    ...(input.fullUrl === undefined ? {} : { fullUrl: stringValue(input.fullUrl) }),
    caption: stringValue(input.caption),
    credit: stringValue(input.credit),
    ...(input.sortOrder === undefined ? {} : { sortOrder: nonNegativeInteger(input.sortOrder) }),
    ...(input.bucketId === undefined ? {} : { bucketId: stringValue(input.bucketId) }),
    ...(input.objectPath === undefined ? {} : { objectPath: stringValue(input.objectPath) }),
    ...(input.contentType === undefined ? {} : { contentType: stringValue(input.contentType) }),
    ...(input.sizeBytes === undefined ? {} : { sizeBytes: nonNegativeInteger(input.sizeBytes) }),
    ...(input.uploadedAt === undefined ? {} : { uploadedAt: stringValue(input.uploadedAt) }),
  };
}

function destination(value: unknown): Destination {
  const input = record(value, [
    'id', 'name', 'countryRegion', 'coordinates', 'routingAnchors', 'location', 'order', 'status', 'priority',
    'timing', 'why', 'media', 'research', 'activities', 'routeContext', 'tags', 'createdAt', 'updatedAt',
  ], [
    'id', 'name', 'countryRegion', 'coordinates', 'routingAnchors', 'location', 'order', 'status', 'priority',
    'timing', 'why', 'media', 'research', 'activities', 'routeContext', 'tags', 'createdAt', 'updatedAt',
  ]);
  const anchors = record(input.routingAnchors, ['driving-car', 'driving-hgv']);
  for (const anchorValue of Object.values(anchors)) {
    const anchor = record(anchorValue, ['profile', 'coordinates', 'originalCoordinates', 'snapDistanceKm', 'provider', 'resolvedAt'], ['profile', 'coordinates', 'originalCoordinates', 'snapDistanceKm', 'provider', 'resolvedAt']);
    oneOf(anchor.profile, ['driving-car', 'driving-hgv'] as const);
    coordinates(anchor.coordinates);
    coordinates(anchor.originalCoordinates);
    finiteNumber(anchor.snapDistanceKm);
    oneOf(anchor.provider, ['openrouteservice'] as const);
    stringValue(anchor.resolvedAt);
  }
  const timing = record(input.timing, ['idealMonths', 'expectedStayDays', 'provisionalStartDate', 'provisionalEndDate'], ['idealMonths', 'expectedStayDays', 'provisionalStartDate', 'provisionalEndDate']);
  const why = record(input.why, ['summary', 'highlights', 'personalRationale'], ['summary', 'highlights', 'personalRationale']);
  const research = record(input.research, ['notes', 'links', 'bookReferences'], ['notes', 'links', 'bookReferences']);
  const activities = record(input.activities, ['items'], ['items']);
  const routeContext = record(input.routeContext, ['previousNextNotes', 'drivingNotes', 'borderShippingNotes', 'notes'], ['previousNextNotes', 'drivingNotes', 'borderShippingNotes', 'notes']);
  if (!Array.isArray(input.media) || !Array.isArray(research.links) || !Array.isArray(research.bookReferences) || !Array.isArray(activities.items)) invalid();
  for (const book of research.bookReferences) {
    const parsed = record(book, ['id', 'source', 'reference', 'note'], ['id', 'source', 'reference', 'note']);
    idValue(parsed.id); stringValue(parsed.source); stringValue(parsed.reference); stringValue(parsed.note);
  }
  for (const item of activities.items) {
    const parsed = record(item, ['id', 'label', 'category', 'notes'], ['id', 'label', 'category', 'notes']);
    idValue(parsed.id); stringValue(parsed.label); stringValue(parsed.category); stringValue(parsed.notes);
  }
  return {
    id: idValue(input.id),
    name: stringValue(input.name),
    countryRegion: stringValue(input.countryRegion),
    coordinates: coordinates(input.coordinates),
    routingAnchors: input.routingAnchors as Destination['routingAnchors'],
    location: destinationLocation(input.location),
    order: nonNegativeInteger(input.order),
    status: oneOf(input.status, ['idea', 'planned', 'confirmed', 'visited'] as const),
    priority: oneOf(input.priority, ['low', 'medium', 'high', 'must-do'] as const),
    timing: {
      idealMonths: stringArray(timing.idealMonths),
      expectedStayDays: finiteNumber(timing.expectedStayDays),
      provisionalStartDate: stringValue(timing.provisionalStartDate),
      provisionalEndDate: stringValue(timing.provisionalEndDate),
    },
    why: { summary: stringValue(why.summary), highlights: stringValue(why.highlights), personalRationale: stringValue(why.personalRationale) },
    media: input.media.map(mediaItem),
    research: { notes: stringValue(research.notes), links: research.links.map(researchLink), bookReferences: research.bookReferences as Destination['research']['bookReferences'] },
    activities: { items: activities.items as Destination['activities']['items'] },
    routeContext: {
      previousNextNotes: stringValue(routeContext.previousNextNotes), drivingNotes: stringValue(routeContext.drivingNotes),
      borderShippingNotes: stringValue(routeContext.borderShippingNotes), notes: stringValue(routeContext.notes),
    },
    tags: stringArray(input.tags),
    createdAt: stringValue(input.createdAt),
    updatedAt: stringValue(input.updatedAt),
  };
}

function activityLocation(value: unknown): Activity['location'] {
  const input = record(value, ['name', 'address', 'coordinates', 'sourceProvider', 'sourceFeatureId'], ['name', 'address']);
  return {
    name: stringValue(input.name), address: stringValue(input.address),
    ...(input.coordinates === undefined ? {} : { coordinates: coordinates(input.coordinates) }),
    ...(input.sourceProvider === undefined ? {} : { sourceProvider: oneOf(input.sourceProvider, ['maptiler', 'manual'] as const) }),
    ...(input.sourceFeatureId === undefined ? {} : { sourceFeatureId: stringValue(input.sourceFeatureId) }),
  };
}

function activityPatch(value: unknown): ActivityPatch {
  const input = record(value, ['order', 'title', 'description', 'category', 'status', 'priority', 'location', 'links', 'notes', 'tags']);
  if (input.links !== undefined && !Array.isArray(input.links)) invalid();
  return {
    ...(input.order === undefined ? {} : { order: nonNegativeInteger(input.order) }),
    ...(input.title === undefined ? {} : { title: stringValue(input.title) }),
    ...(input.description === undefined ? {} : { description: stringValue(input.description) }),
    ...(input.category === undefined ? {} : { category: oneOf(input.category, ['food', 'culture', 'outdoors', 'street-art', 'ski', 'detour', 'logistics', 'other'] as const) }),
    ...(input.status === undefined ? {} : { status: oneOf(input.status, ['idea', 'planned', 'booked', 'done', 'skipped'] as const) }),
    ...(input.priority === undefined ? {} : { priority: oneOf(input.priority, ['low', 'medium', 'high', 'must-do'] as const) }),
    ...(input.location === undefined ? {} : { location: activityLocation(input.location) }),
    ...(input.links === undefined ? {} : { links: input.links.map(researchLink) }),
    ...(input.notes === undefined ? {} : { notes: stringValue(input.notes) }),
    ...(input.tags === undefined ? {} : { tags: stringArray(input.tags) }),
  };
}

function activity(value: unknown): Activity {
  const input = record(value, ['id', 'destinationId', 'order', 'title', 'description', 'category', 'status', 'priority', 'location', 'links', 'notes', 'tags', 'createdAt', 'updatedAt'], ['id', 'destinationId', 'order', 'title', 'description', 'category', 'status', 'priority', 'links', 'notes', 'tags', 'createdAt', 'updatedAt']);
  return {
    id: idValue(input.id), destinationId: idValue(input.destinationId), order: nonNegativeInteger(input.order),
    title: stringValue(input.title), description: stringValue(input.description),
    category: oneOf(input.category, ['food', 'culture', 'outdoors', 'street-art', 'ski', 'detour', 'logistics', 'other'] as const),
    status: oneOf(input.status, ['idea', 'planned', 'booked', 'done', 'skipped'] as const),
    priority: oneOf(input.priority, ['low', 'medium', 'high', 'must-do'] as const),
    ...(input.location === undefined ? {} : { location: activityLocation(input.location) }),
    links: Array.isArray(input.links) ? input.links.map(researchLink) : invalid(),
    notes: stringValue(input.notes), tags: stringArray(input.tags), createdAt: stringValue(input.createdAt), updatedAt: stringValue(input.updatedAt),
  };
}

function routeWaypoint(value: unknown): NonNullable<RouteLeg['waypoints']>[number] {
  const input = record(value, ['id', 'order', 'name', 'coordinates', 'location', 'notes', 'links'], ['id', 'order', 'name', 'coordinates', 'location', 'notes', 'links']);
  if (!Array.isArray(input.links)) invalid();
  return {
    id: idValue(input.id), order: nonNegativeInteger(input.order), name: stringValue(input.name),
    coordinates: coordinates(input.coordinates), location: destinationLocation(input.location),
    notes: stringValue(input.notes), links: input.links.map(researchLink),
  };
}

function routeIntent(value: unknown) {
  const input = record(value, ['movement', 'calculation', 'ferryPolicy', 'waypoints', 'notes'], ['movement', 'calculation', 'ferryPolicy', 'waypoints', 'notes']);
  if (!Array.isArray(input.waypoints)) invalid();
  return {
    movement: oneOf(input.movement, ['drive', 'vehicle-shipping'] as const),
    calculation: oneOf(input.calculation, ['automatic', 'manual'] as const),
    ferryPolicy: oneOf(input.ferryPolicy, ['allow', 'avoid', 'require'] as const),
    waypoints: input.waypoints.map(routeWaypoint), notes: stringValue(input.notes),
  };
}

function routeWarning(value: unknown): NonNullable<RouteLeg['warnings']>[number] {
  const input = record(value, ['code', 'message', 'context'], ['code', 'message']);
  let context: NonNullable<NonNullable<RouteLeg['warnings']>[number]['context']> | undefined;
  if (input.context !== undefined) {
    const parsed = record(input.context, ['sourceRouteLegId', 'unresolvedIntent'], ['sourceRouteLegId', 'unresolvedIntent']);
    context = { sourceRouteLegId: idValue(parsed.sourceRouteLegId), unresolvedIntent: routeIntent(parsed.unresolvedIntent) };
  }
  return {
    code: oneOf(input.code, ['SUSPICIOUS_DETOUR', 'FERRY_REQUIRED_NOT_FOUND', 'FERRY_AVOIDED_BUT_FOUND', 'ROUTING_ANCHOR_ADJUSTED', 'VEHICLE_PROFILE_FALLBACK', 'ROUTE_INTENT_REASSIGNMENT_REQUIRED'] as const),
    message: stringValue(input.message),
    ...(context === undefined ? {} : { context }),
  };
}

function routeSection(value: unknown): NonNullable<RouteLeg['sections']>[number] {
  const input = record(value, ['kind', 'startGeometryIndex', 'endGeometryIndex', 'distanceKm'], ['kind', 'startGeometryIndex', 'endGeometryIndex', 'distanceKm']);
  return {
    kind: oneOf(input.kind, ['road', 'ferry'] as const),
    startGeometryIndex: nonNegativeInteger(input.startGeometryIndex),
    endGeometryIndex: nonNegativeInteger(input.endGeometryIndex),
    distanceKm: finiteNumber(input.distanceKm),
  };
}

function providerDiagnostic(value: unknown): NonNullable<RouteLeg['providerDiagnostic']> {
  const input = record(value, ['provider', 'httpStatus', 'code', 'providerMessage', 'coordinateIndex', 'requestedProfile', 'actualProfile', 'retryAfterMs', 'attempts', 'retryAttempts'], ['provider', 'httpStatus', 'providerMessage']);
  return {
    provider: oneOf(input.provider, ['openrouteservice'] as const),
    httpStatus: nonNegativeInteger(input.httpStatus),
    ...(input.code === undefined ? {} : { code: finiteNumber(input.code) }),
    providerMessage: stringValue(input.providerMessage),
    ...(input.coordinateIndex === undefined ? {} : { coordinateIndex: nonNegativeInteger(input.coordinateIndex) }),
    ...(input.requestedProfile === undefined ? {} : { requestedProfile: oneOf(input.requestedProfile, ['driving-car', 'driving-hgv'] as const) }),
    ...(input.actualProfile === undefined ? {} : { actualProfile: oneOf(input.actualProfile, ['driving-car', 'driving-hgv'] as const) }),
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: nonNegativeInteger(input.retryAfterMs) }),
    ...(input.attempts === undefined ? {} : { attempts: nonNegativeInteger(input.attempts) }),
    ...(input.retryAttempts === undefined ? {} : { retryAttempts: nonNegativeInteger(input.retryAttempts) }),
  };
}

function routeLeg(value: unknown): RouteLeg {
  const input = record(value, [
    'id', 'originDestinationId', 'targetDestinationId', 'movement', 'calculation', 'ferryPolicy', 'waypoints', 'sections', 'warnings',
    'status', 'distanceKm', 'travelTimeHours', 'geometry', 'provider', 'profile', 'routeKey', 'calculatedAt', 'error', 'providerDiagnostic', 'notes', 'createdAt', 'updatedAt',
  ], ['id', 'originDestinationId', 'targetDestinationId', 'movement', 'calculation', 'status', 'notes', 'createdAt', 'updatedAt']);
  if (input.waypoints !== undefined && !Array.isArray(input.waypoints)) invalid();
  if (input.sections !== undefined && !Array.isArray(input.sections)) invalid();
  if (input.warnings !== undefined && !Array.isArray(input.warnings)) invalid();
  if (input.geometry !== undefined) {
    const geometry = record(input.geometry, ['type', 'coordinates'], ['type', 'coordinates']);
    oneOf(geometry.type, ['LineString'] as const);
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.some((point) => !Array.isArray(point) || point.length < 2 || point.some((number) => typeof number !== 'number' || !Number.isFinite(number)))) invalid();
  }
  return {
    id: idValue(input.id), originDestinationId: idValue(input.originDestinationId), targetDestinationId: idValue(input.targetDestinationId),
    movement: oneOf(input.movement, ['drive', 'vehicle-shipping'] as const), calculation: oneOf(input.calculation, ['automatic', 'manual'] as const),
    ...(input.ferryPolicy === undefined ? {} : { ferryPolicy: oneOf(input.ferryPolicy, ['allow', 'avoid', 'require'] as const) }),
    ...(input.waypoints === undefined ? {} : { waypoints: input.waypoints.map(routeWaypoint) }),
    ...(input.sections === undefined ? {} : { sections: input.sections.map(routeSection) }),
    ...(input.warnings === undefined ? {} : { warnings: input.warnings.map(routeWarning) }),
    status: oneOf(input.status, ['pending', 'calculating', 'ready', 'failed', 'manual', 'review-required'] as const),
    ...(input.distanceKm === undefined ? {} : { distanceKm: finiteNumber(input.distanceKm) }),
    ...(input.travelTimeHours === undefined ? {} : { travelTimeHours: finiteNumber(input.travelTimeHours) }),
    ...(input.geometry === undefined ? {} : { geometry: input.geometry as RouteLeg['geometry'] }),
    ...(input.provider === undefined ? {} : { provider: stringValue(input.provider) }),
    ...(input.profile === undefined ? {} : { profile: stringValue(input.profile) }),
    ...(input.routeKey === undefined ? {} : { routeKey: stringValue(input.routeKey) }),
    ...(input.calculatedAt === undefined ? {} : { calculatedAt: stringValue(input.calculatedAt) }),
    ...(input.error === undefined ? {} : { error: stringValue(input.error) }),
    ...(input.providerDiagnostic === undefined ? {} : { providerDiagnostic: providerDiagnostic(input.providerDiagnostic) }),
    notes: stringValue(input.notes), createdAt: stringValue(input.createdAt), updatedAt: stringValue(input.updatedAt),
  };
}

function tripMutation(value: unknown): TripMutationRequest {
  const input = record(value, ['type', 'destination', 'destinationId', 'destinationIds', 'routeLeg', 'routeLegId', 'delta', 'snapshot', 'input', 'activityId', 'patch', 'orderedActivityIds'], ['type']);
  switch (input.type) {
    case 'save-destination':
      record(input, ['type', 'destination'], ['type', 'destination']);
      return { type: input.type, destination: destination(input.destination) };
    case 'delete-destination':
      record(input, ['type', 'destinationId'], ['type', 'destinationId']);
      return { type: input.type, destinationId: idValue(input.destinationId) };
    case 'delete-destinations':
      record(input, ['type', 'destinationIds'], ['type', 'destinationIds']);
      return { type: input.type, destinationIds: stringArray(input.destinationIds, true) };
    case 'save-route-leg':
      record(input, ['type', 'routeLeg'], ['type', 'routeLeg']);
      return { type: input.type, routeLeg: routeLeg(input.routeLeg) };
    case 'delete-route-leg':
      record(input, ['type', 'routeLegId'], ['type', 'routeLegId']);
      return { type: input.type, routeLegId: idValue(input.routeLegId) };
    case 'apply-trip-mutation': {
      record(input, ['type', 'delta'], ['type', 'delta']);
      const delta = record(input.delta, ['destinationsToUpsert', 'destinationIdsToDelete', 'routeLegsToUpsert', 'routeLegIdsToDelete'], ['destinationsToUpsert', 'destinationIdsToDelete', 'routeLegsToUpsert', 'routeLegIdsToDelete']);
      if (!Array.isArray(delta.destinationsToUpsert) || !Array.isArray(delta.routeLegsToUpsert)) invalid();
      return { type: input.type, delta: {
        destinationsToUpsert: delta.destinationsToUpsert.map(destination),
        destinationIdsToDelete: stringArray(delta.destinationIdsToDelete, true),
        routeLegsToUpsert: delta.routeLegsToUpsert.map(routeLeg),
        routeLegIdsToDelete: stringArray(delta.routeLegIdsToDelete, true),
      } };
    }
    case 'replace-trip-data': {
      record(input, ['type', 'snapshot'], ['type', 'snapshot']);
      const snapshot = record(input.snapshot, ['destinations', 'routeLegs', 'activities'], ['destinations', 'routeLegs']);
      if (!Array.isArray(snapshot.destinations) || !Array.isArray(snapshot.routeLegs) || (snapshot.activities !== undefined && !Array.isArray(snapshot.activities))) invalid();
      return { type: input.type, snapshot: {
        destinations: snapshot.destinations.map(destination), routeLegs: snapshot.routeLegs.map(routeLeg),
        ...(snapshot.activities === undefined ? {} : { activities: snapshot.activities.map(activity) }),
      } };
    }
    case 'create-activity': {
      record(input, ['type', 'input'], ['type', 'input']);
      const create = record(input.input, ['destinationId', 'title', 'order', 'location'], ['destinationId', 'title']);
      return { type: input.type, input: {
        destinationId: idValue(create.destinationId), title: stringValue(create.title),
        ...(create.order === undefined ? {} : { order: nonNegativeInteger(create.order) }),
        ...(create.location === undefined ? {} : { location: activityLocation(create.location) }),
      } };
    }
    case 'update-activity':
      record(input, ['type', 'activityId', 'patch'], ['type', 'activityId', 'patch']);
      return { type: input.type, activityId: idValue(input.activityId), patch: activityPatch(input.patch) };
    case 'delete-activity':
      record(input, ['type', 'activityId'], ['type', 'activityId']);
      return { type: input.type, activityId: idValue(input.activityId) };
    case 'reorder-activities':
      record(input, ['type', 'destinationId', 'orderedActivityIds'], ['type', 'destinationId', 'orderedActivityIds']);
      return { type: input.type, destinationId: idValue(input.destinationId), orderedActivityIds: stringArray(input.orderedActivityIds, true) };
    default:
      return invalid();
  }
}

function imageSearchResult(value: unknown): WebImageSearchResult {
  const input = record(value, ['id', 'title', 'sourceName', 'sourceUrl', 'thumbnailUrl', 'imageUrl', 'width', 'height'], ['id', 'title', 'sourceName', 'sourceUrl', 'thumbnailUrl', 'imageUrl']);
  for (const key of ['sourceUrl', 'thumbnailUrl', 'imageUrl'] as const) {
    const candidate = stringValue(input[key]);
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') invalid();
    } catch {
      invalid();
    }
  }
  return {
    id: idValue(input.id), title: stringValue(input.title), sourceName: stringValue(input.sourceName),
    sourceUrl: stringValue(input.sourceUrl), thumbnailUrl: stringValue(input.thumbnailUrl), imageUrl: stringValue(input.imageUrl),
    ...(input.width === undefined ? {} : { width: finiteNumber(input.width) }),
    ...(input.height === undefined ? {} : { height: finiteNumber(input.height) }),
  };
}

async function readBody(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) invalid();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > maximum) invalid();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function requireContentType(request: IncomingMessage, expected: 'json' | 'multipart'): string {
  const value = request.headers['content-type'];
  if (typeof value !== 'string') invalid();
  if (
    expected === 'json'
    && !/^[ \t]*application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?[ \t]*$/i.test(value)
  ) invalid();
  if (expected === 'multipart' && !/^multipart\/form-data\s*;.*\bboundary=/i.test(value)) invalid();
  return value;
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  requireContentType(request, 'json');
  const bytes = await readBody(request, MAX_JSON_BYTES);
  if (bytes.byteLength === 0) invalid();
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return invalid();
  }
}

async function multipartBody(request: IncomingMessage): Promise<FormData> {
  const contentType = requireContentType(request, 'multipart');
  const bytes = await readBody(request, MAX_MULTIPART_BYTES);
  try {
    return await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    return invalid();
  }
}

function requireWrite(request: IncomingMessage): void {
  if (request.headers['x-plotter-write'] !== '1') invalid();
}

function decodedId(value: string | undefined): string {
  if (value === undefined) invalid();
  try {
    return idValue(decodeURIComponent(value));
  } catch {
    return invalid();
  }
}

function json(response: ServerResponse, status: number, body: unknown, omitBody = false): void {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(omitBody ? undefined : bytes);
}

function errorBody(status: 400 | 404 | 503 | 500, code: 'invalid-request' | 'not-found' | 'storage-unavailable' | 'internal-error', message: string) {
  return { status, error: { code, message } };
}

function sendCaughtError(response: ServerResponse, error: unknown): void {
  if (response.destroyed || response.headersSent) {
    if (!response.destroyed) response.destroy();
    return;
  }
  if (error instanceof TripStorageConflictError) {
    json(response, 409, { status: 409, error: { code: 'conflict', message: error.message, currentRevision: error.currentRevision } });
    return;
  }
  if (error instanceof HttpError) {
    const code = error.status === 400 ? 'invalid-request' : error.status === 404 ? 'not-found' : 'storage-unavailable';
    json(response, error.status, errorBody(error.status, code, error.message));
    return;
  }
  if (error instanceof BackupOperationsUnavailableError) {
    json(response, 503, errorBody(503, 'storage-unavailable', 'Portable backup operations are unavailable.'));
    return;
  }
  if (error instanceof PortableBackupInvalidError || error instanceof PortableRestoreConfirmationError) {
    json(response, 400, errorBody(400, 'invalid-request', INVALID_REQUEST_MESSAGE));
    return;
  }
  if (
    error instanceof PortableBackupCreateError
    || error instanceof PortableRestoreRecoveredError
    || error instanceof PortableRestoreIncompleteError
  ) {
    json(response, 503, errorBody(503, 'storage-unavailable', STORAGE_UNAVAILABLE_MESSAGE));
    return;
  }
  if (error instanceof Error && error.name === 'AutomaticBackupError') {
    json(response, 503, errorBody(503, 'storage-unavailable', STORAGE_UNAVAILABLE_MESSAGE));
    return;
  }
  if (error instanceof Error && /not found\.?$/i.test(error.message)) {
    json(response, 404, errorBody(404, 'not-found', NOT_FOUND_MESSAGE));
    return;
  }
  if (error instanceof Error && [
    'Destination IDs must be unique.',
    'Route leg IDs must be unique.',
    'Activity IDs must be unique.',
    'Route leg endpoints must belong to the trip.',
    'Destination set does not match the current trip.',
    'Activity destinations must belong to the trip.',
    'Route leg set does not match the current trip.',
    'Route leg deletion set must include every affected leg.',
    'Activity order must include each destination activity exactly once.',
  ].includes(error.message) || (error instanceof Error && /^Media order must include each (?:destination|activity) media item exactly once\./.test(error.message))) {
    json(response, 400, errorBody(400, 'invalid-request', INVALID_REQUEST_MESSAGE));
    return;
  }
  if (error instanceof Error && [
    'Enter a URL.',
    'Enter a valid URL.',
    'Links must use http or https.',
    'Enter a public URL.',
    'Unable to resolve URL host.',
    'Enter a valid image URL.',
    'Image URLs must use http or https.',
    'Enter a public image URL.',
    'Unable to resolve image URL host.',
    'Too many redirects while fetching image.',
    'Redirect response is missing a Location header.',
    'Selected result did not return a supported image.',
    'Selected image is too large.',
    'Selected image was empty.',
  ].includes(error.message)) {
    json(response, 400, errorBody(400, 'invalid-request', INVALID_REQUEST_MESSAGE));
    return;
  }
  if (error instanceof Error && error.message === 'Set SERPAPI_API_KEY before searching web images.') {
    json(response, 503, errorBody(503, 'storage-unavailable', 'Web image search is unavailable.'));
    return;
  }
  json(response, 500, errorBody(500, 'internal-error', INTERNAL_ERROR_MESSAGE));
}

function ensureReady(dependencies: PlotterHttpDependencies): void {
  if (!dependencies.readiness().ready) throw new HttpError(503, STORAGE_UNAVAILABLE_MESSAGE);
}

function requestAbort(request: IncomingMessage, response: ServerResponse): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!response.writableEnded) controller.abort(); };
  request.once('aborted', abort);
  response.once('close', close);
  return {
    signal: controller.signal,
    cleanup() {
      request.off('aborted', abort);
      response.off('close', close);
    },
  };
}

class ResponseDisconnectedError extends Error {
  constructor() {
    super('Response disconnected.');
    this.name = 'ResponseDisconnectedError';
  }
}

function responseLifecycle(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new ResponseDisconnectedError());
  };
  request.once('aborted', abort);
  response.once('close', abort);
  response.once('error', abort);
  if (request.aborted || response.destroyed) abort();
  return {
    signal: controller.signal,
    cleanup() {
      request.off('aborted', abort);
      response.off('close', abort);
      response.off('error', abort);
    },
  };
}

function abortable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolvePromise, reject) => {
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(operation).then(
      (value) => { cleanup(); resolvePromise(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted || response.destroyed || !response.writable) {
    return Promise.reject(signal.reason ?? new ResponseDisconnectedError());
  }
  return new Promise<void>((resolvePromise, reject) => {
    const drained = () => { cleanup(); resolvePromise(); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => {
      response.off('drain', drained);
      signal.removeEventListener('abort', aborted);
    };
    response.once('drain', drained);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function writeBinary(request: IncomingMessage, response: ServerResponse, content: BinaryContent): Promise<void> {
  const lifecycle = responseLifecycle(request, response);
  const iterator = content.bytes[Symbol.asyncIterator]();
  let complete = false;
  try {
    while (true) {
      const result = await abortable(iterator.next(), lifecycle.signal);
      if (result.done) {
        complete = true;
        response.end();
        return;
      }
      if (!(result.value instanceof Uint8Array)) throw new Error('Media stream is invalid.');
      if (lifecycle.signal.aborted || response.destroyed || !response.writable) {
        throw lifecycle.signal.reason ?? new ResponseDisconnectedError();
      }
      if (!response.write(result.value)) await waitForDrain(response, lifecycle.signal);
    }
  } finally {
    lifecycle.cleanup();
    if (!complete && iterator.return) await iterator.return();
  }
}

function safeFilename(filename: string | undefined, mediaId: string): string {
  const safe = (filename ?? mediaId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160);
  return safe || mediaId;
}

function sendMedia(request: IncomingMessage, response: ServerResponse, mediaId: string, content: BinaryContent): Promise<void> {
  if (!Number.isSafeInteger(content.contentLength) || content.contentLength < 0 || !/^image\/(?:jpeg|png|webp|gif)$/.test(content.contentType)) {
    throw new Error('Stored media metadata is invalid.');
  }
  response.writeHead(200, {
    'content-type': content.contentType,
    'content-length': content.contentLength,
    'content-disposition': `inline; filename="${safeFilename(content.filename, mediaId)}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=31536000, immutable',
  });
  return writeBinary(request, response, content);
}

function uploadFields(form: FormData): { expectedRevision: number; caption?: string; credit?: string; file: File } {
  const allowed = new Set(['expectedRevision', 'caption', 'credit', 'file']);
  for (const key of form.keys()) if (!allowed.has(key)) invalid();
  for (const key of allowed) if (form.getAll(key).length > 1) invalid();
  const expectedRevisionRaw = form.get('expectedRevision');
  const file = form.get('file');
  if (
    typeof expectedRevisionRaw !== 'string'
    || !/^\d+$/.test(expectedRevisionRaw)
    || !(file instanceof File)
    || file.size === 0
    || file.size > MAX_MEDIA_BYTES
    || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
  ) invalid();
  const caption = form.get('caption');
  const credit = form.get('credit');
  if ((caption !== null && typeof caption !== 'string') || (credit !== null && typeof credit !== 'string')) invalid();
  return {
    expectedRevision: nonNegativeInteger(Number(expectedRevisionRaw)),
    ...(caption === null ? {} : { caption }),
    ...(credit === null ? {} : { credit }),
    file,
  };
}

function revisionRequest(value: unknown): { expectedRevision: number } {
  const input = record(value, ['expectedRevision'], ['expectedRevision']);
  return { expectedRevision: nonNegativeInteger(input.expectedRevision) };
}

function mediaPatchRequest(value: unknown) {
  const input = record(value, ['expectedRevision', 'patch'], ['expectedRevision', 'patch']);
  const patch = record(input.patch, ['caption', 'credit']);
  return {
    expectedRevision: nonNegativeInteger(input.expectedRevision),
    patch: {
      ...(patch.caption === undefined ? {} : { caption: stringValue(patch.caption) }),
      ...(patch.credit === undefined ? {} : { credit: stringValue(patch.credit) }),
    },
  };
}

function reorderRequest(value: unknown) {
  const input = record(value, ['expectedRevision', 'orderedMediaIds'], ['expectedRevision', 'orderedMediaIds']);
  return { expectedRevision: nonNegativeInteger(input.expectedRevision), orderedMediaIds: stringArray(input.orderedMediaIds, true) };
}

function importRequest(value: unknown) {
  const input = record(value, ['expectedRevision', 'result'], ['expectedRevision', 'result']);
  return { expectedRevision: nonNegativeInteger(input.expectedRevision), result: imageSearchResult(input.result) };
}

async function importRemoteImage(
  dependencies: PlotterHttpDependencies,
  request: IncomingMessage,
  response: ServerResponse,
  result: WebImageSearchResult,
  create: (input: { bytes: ReadableStream<Uint8Array>; contentType: string; caption: string; credit: string }) => Promise<unknown>,
): Promise<unknown> {
  const abort = requestAbort(request, response);
  let remote: { bytes: ReadableStream<Uint8Array>; contentType: string } | undefined;
  try {
    remote = await dependencies.providers.remoteImage({ url: result.imageUrl }, abort.signal);
    return await create({ bytes: remote.bytes, contentType: remote.contentType, caption: result.title, credit: result.sourceName });
  } catch (error) {
    if (remote) await remote.bytes.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    abort.cleanup();
  }
}

function mediaRollup(
  destinationId: string,
  destinationMedia: MediaItem[],
  activitiesWithMedia: Array<{ activity: Activity; media: MediaItem[] }>,
) {
  return [
    ...destinationMedia.map((mediaItemValue) => ({ mediaItem: mediaItemValue, ownerType: 'destination' as const, destinationId, canReorderInStopCarousel: true })),
    ...activitiesWithMedia.flatMap(({ activity: activityValue, media }) => media.map((mediaItemValue) => ({
      mediaItem: mediaItemValue, ownerType: 'activity' as const, destinationId, activityId: activityValue.id,
      activityTitle: activityValue.title, canReorderInStopCarousel: false,
    }))),
  ];
}

function sse(request: IncomingMessage, response: ServerResponse, events: RevisionEventSource): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-content-type-options': 'nosniff',
  });
  response.flushHeaders();
  response.write(': heartbeat\n\n');
  const unsubscribe = events.subscribe((event) => {
    if (!response.destroyed && !response.writableEnded) {
      const scopeId = event.scope === 'directory' ? 'directory' : `trip:${event.tripId}`;
      const id = event.kind === 'revision'
        ? `revision:${event.epoch}:${scopeId}:${event.revision}`
        : `restore-reset:${event.epoch}:${scopeId}`;
      response.write(`id: ${id}\nevent: revision\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(': heartbeat\n\n');
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.once('aborted', cleanup);
  response.once('close', cleanup);
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`));
}

async function frontend(request: IncomingMessage, response: ServerResponse, root: string, pathname: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(404, NOT_FOUND_MESSAGE);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    invalid();
  }
  if (decoded.split('/').includes('..') || decoded.includes('\\') || decoded.includes('\0')) invalid();
  const canonicalRoot = realpathSync(root);
  if (!statSync(canonicalRoot).isDirectory()) throw new Error('Public root is invalid.');
  const requested = resolve(canonicalRoot, `.${decoded}`);
  if (!contained(canonicalRoot, requested)) invalid();
  let selected = resolve(canonicalRoot, 'index.html');
  let asset = false;
  if (existsSync(requested) && statSync(requested).isFile()) {
    selected = await realpath(requested);
    if (!contained(canonicalRoot, selected)) invalid();
    asset = extname(selected) !== '.html';
  }
  if (!existsSync(selected) || !statSync(selected).isFile()) throw new HttpError(404, NOT_FOUND_MESSAGE);
  const bytes = await readFile(selected);
  response.writeHead(200, {
    'content-type': contentTypes[extname(selected).toLowerCase()] ?? 'application/octet-stream',
    'content-length': bytes.byteLength,
    'cache-control': asset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

function pathnameFrom(request: IncomingMessage): string {
  const raw = request.url ?? '/';
  if (/%(?:2e|2f|5c)/i.test(raw)) invalid();
  try {
    const parsed = new URL(raw, 'http://127.0.0.1');
    if ((parsed.pathname === '/api' || parsed.pathname.startsWith('/api/') || parsed.pathname === '/healthz') && parsed.search !== '') invalid();
    return parsed.pathname;
  } catch {
    return invalid();
  }
}

function usesCanonicalStorage(pathname: string): boolean {
  return pathname === '/api/v1/trips'
    || pathname.startsWith('/api/v1/trips/')
    || pathname.startsWith('/api/v1/media/')
    || pathname === '/api/v1/backups'
    || pathname.startsWith('/api/v1/backups/');
}

export function createPlotterHttpHandler(dependencies: PlotterHttpDependencies) {
  void dependencies.media;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const pathname = pathnameFrom(request);
      const method = request.method ?? '';
      const handle = async (): Promise<void> => {

      if (pathname === '/healthz' && (method === 'GET' || method === 'HEAD')) {
        if (dependencies.readiness().ready) json(response, 200, { ready: true }, method === 'HEAD');
        else json(response, 503, errorBody(503, 'storage-unavailable', STORAGE_UNAVAILABLE_MESSAGE), method === 'HEAD');
        return;
      }

      if (pathname === '/api/v1/events' && method === 'GET') {
        sse(request, response, dependencies.events);
        return;
      }

      if (pathname === '/api/v1/trips' && method === 'GET') {
        ensureReady(dependencies);
        json(response, 200, await dependencies.directory.load());
        return;
      }
      if (pathname === '/api/v1/trips' && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const input = record(await jsonBody(request), ['expectedRevision', 'name', 'routingVehicle'], ['expectedRevision', 'name']);
        const parsed = {
          expectedRevision: nonNegativeInteger(input.expectedRevision), name: stringValue(input.name, false),
          ...(input.routingVehicle === undefined ? {} : { routingVehicle: routingVehicle(input.routingVehicle) }),
        };
        json(response, 201, await dependencies.directory.create(parsed.expectedRevision, parsed));
        return;
      }

      const tripMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)$/);
      if (tripMatch && method === 'GET') {
        ensureReady(dependencies);
        json(response, 200, await dependencies.tripRepository(decodedId(tripMatch[1])).load());
        return;
      }
      if (tripMatch && method === 'PATCH') {
        requireWrite(request); ensureReady(dependencies);
        const tripId = decodedId(tripMatch[1]);
        const input = record(await jsonBody(request), ['expectedRevision', 'patch'], ['expectedRevision', 'patch']);
        const patch = record(input.patch, ['name', 'description', 'routingVehicle']);
        if (patch.name !== undefined) stringValue(patch.name, false);
        if (patch.description !== undefined) stringValue(patch.description);
        const parsed = {
          expectedRevision: nonNegativeInteger(input.expectedRevision),
          patch: {
            ...(patch.name === undefined ? {} : { name: stringValue(patch.name, false) }),
            ...(patch.description === undefined ? {} : { description: stringValue(patch.description) }),
            ...(patch.routingVehicle === undefined ? {} : { routingVehicle: routingVehicle(patch.routingVehicle) }),
          },
        };
        json(response, 200, await dependencies.directory.update(parsed.expectedRevision, tripId, parsed));
        return;
      }
      if (tripMatch && method === 'DELETE') {
        requireWrite(request); ensureReady(dependencies);
        const parsed = revisionRequest(await jsonBody(request));
        json(response, 200, await dependencies.directory.delete(parsed.expectedRevision, decodedId(tripMatch[1])));
        return;
      }

      const mutationMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/mutations$/);
      if (mutationMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const input = record(await jsonBody(request), ['expectedRevision', 'mutation'], ['expectedRevision', 'mutation']);
        json(response, 200, await dependencies.tripRepository(decodedId(mutationMatch[1])).mutate(nonNegativeInteger(input.expectedRevision), tripMutation(input.mutation)));
        return;
      }

      const destinationListMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destinations\/([^/]+)\/media$/);
      if (destinationListMatch && method === 'GET') {
        ensureReady(dependencies);
        const items = await dependencies.tripRepository(decodedId(destinationListMatch[1])).listDestinationMedia(decodedId(destinationListMatch[2]));
        json(response, 200, { mediaItems: items });
        return;
      }
      if (destinationListMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const trip = dependencies.tripRepository(decodedId(destinationListMatch[1]));
        const fields = uploadFields(await multipartBody(request));
        json(response, 200, await trip.createDestinationMedia(fields.expectedRevision, decodedId(destinationListMatch[2]), {
          bytes: fields.file.stream(), contentType: fields.file.type, ...(fields.caption === undefined ? {} : { caption: fields.caption }), ...(fields.credit === undefined ? {} : { credit: fields.credit }),
        }));
        return;
      }

      const activityListMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/activities\/([^/]+)\/media$/);
      if (activityListMatch && method === 'GET') {
        ensureReady(dependencies);
        const items = await dependencies.tripRepository(decodedId(activityListMatch[1])).listActivityMedia(decodedId(activityListMatch[2]));
        json(response, 200, { mediaItems: items });
        return;
      }

      const activityUploadMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destinations\/([^/]+)\/activities\/([^/]+)\/media$/);
      if (activityUploadMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const fields = uploadFields(await multipartBody(request));
        const trip = dependencies.tripRepository(decodedId(activityUploadMatch[1]));
        json(response, 200, await trip.createActivityMedia(fields.expectedRevision, decodedId(activityUploadMatch[2]), decodedId(activityUploadMatch[3]), {
          bytes: fields.file.stream(), contentType: fields.file.type, ...(fields.caption === undefined ? {} : { caption: fields.caption }), ...(fields.credit === undefined ? {} : { credit: fields.credit }),
        }));
        return;
      }

      const destinationImportMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destinations\/([^/]+)\/media\/import$/);
      if (destinationImportMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const parsed = importRequest(await jsonBody(request));
        const trip = dependencies.tripRepository(decodedId(destinationImportMatch[1]));
        const destinationId = decodedId(destinationImportMatch[2]);
        const result = await importRemoteImage(dependencies, request, response, parsed.result, (mediaInput) => trip.createDestinationMedia(parsed.expectedRevision, destinationId, mediaInput));
        json(response, 200, result);
        return;
      }

      const activityImportMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destinations\/([^/]+)\/activities\/([^/]+)\/media\/import$/);
      if (activityImportMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const parsed = importRequest(await jsonBody(request));
        const trip = dependencies.tripRepository(decodedId(activityImportMatch[1]));
        const destinationId = decodedId(activityImportMatch[2]);
        const activityId = decodedId(activityImportMatch[3]);
        const result = await importRemoteImage(dependencies, request, response, parsed.result, (mediaInput) => trip.createActivityMedia(parsed.expectedRevision, destinationId, activityId, mediaInput));
        json(response, 200, result);
        return;
      }

      const destinationMediaMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destination-media\/([^/]+)$/);
      if (destinationMediaMatch && (method === 'PATCH' || method === 'DELETE')) {
        requireWrite(request); ensureReady(dependencies);
        const trip = dependencies.tripRepository(decodedId(destinationMediaMatch[1]));
        const mediaId = decodedId(destinationMediaMatch[2]);
        if (method === 'PATCH') {
          const parsed = mediaPatchRequest(await jsonBody(request));
          json(response, 200, await trip.updateDestinationMedia(parsed.expectedRevision, mediaId, parsed.patch));
        } else {
          const parsed = revisionRequest(await jsonBody(request));
          json(response, 200, await trip.deleteDestinationMedia(parsed.expectedRevision, mediaId));
        }
        return;
      }

      const activityMediaMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/activity-media\/([^/]+)$/);
      if (activityMediaMatch && (method === 'PATCH' || method === 'DELETE')) {
        requireWrite(request); ensureReady(dependencies);
        const trip = dependencies.tripRepository(decodedId(activityMediaMatch[1]));
        const mediaId = decodedId(activityMediaMatch[2]);
        if (method === 'PATCH') {
          const parsed = mediaPatchRequest(await jsonBody(request));
          json(response, 200, await trip.updateActivityMedia(parsed.expectedRevision, mediaId, parsed.patch));
        } else {
          const parsed = revisionRequest(await jsonBody(request));
          json(response, 200, await trip.deleteActivityMedia(parsed.expectedRevision, mediaId));
        }
        return;
      }

      const destinationReorderMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destinations\/([^/]+)\/media\/reorder$/);
      if (destinationReorderMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const parsed = reorderRequest(await jsonBody(request));
        json(response, 200, await dependencies.tripRepository(decodedId(destinationReorderMatch[1])).reorderDestinationMedia(parsed.expectedRevision, decodedId(destinationReorderMatch[2]), parsed.orderedMediaIds));
        return;
      }

      const activityReorderMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/activities\/([^/]+)\/media\/reorder$/);
      if (activityReorderMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const parsed = reorderRequest(await jsonBody(request));
        json(response, 200, await dependencies.tripRepository(decodedId(activityReorderMatch[1])).reorderActivityMedia(parsed.expectedRevision, decodedId(activityReorderMatch[2]), parsed.orderedMediaIds));
        return;
      }

      const rollupMatch = pathname.match(/^\/api\/v1\/trips\/([^/]+)\/destinations\/([^/]+)\/media-rollup$/);
      if (rollupMatch && method === 'GET') {
        ensureReady(dependencies);
        const trip = dependencies.tripRepository(decodedId(rollupMatch[1]));
        const destinationId = decodedId(rollupMatch[2]);
        const snapshot = await trip.load();
        const ownedActivities = snapshot.activities.filter((activityValue) => activityValue.destinationId === destinationId);
        const [destinationItems, ...activityItems] = await Promise.all([
          trip.listDestinationMedia(destinationId),
          ...ownedActivities.map((activityValue) => trip.listActivityMedia(activityValue.id)),
        ]);
        json(response, 200, { media: mediaRollup(destinationId, destinationItems, ownedActivities.map((activityValue, index) => ({ activity: activityValue, media: activityItems[index]! }))) });
        return;
      }

      const contentMatch = pathname.match(/^\/api\/v1\/media\/([^/]+)\/content$/);
      if (contentMatch && method === 'GET') {
        ensureReady(dependencies);
        const mediaId = decodedId(contentMatch[1]);
        await sendMedia(request, response, mediaId, await dependencies.mediaContent.open(mediaId));
        return;
      }

      if (pathname === '/api/v1/link-preview' && method === 'POST') {
        const input = record(await jsonBody(request), ['url'], ['url']);
        const parsed: LinkPreviewRequest = { url: stringValue(input.url, false) };
        const abort = requestAbort(request, response);
        try { json(response, 200, { preview: await dependencies.providers.linkPreview(parsed, abort.signal) }); }
        finally { abort.cleanup(); }
        return;
      }

      if (pathname === '/api/v1/image-search' && method === 'POST') {
        const input = record(await jsonBody(request), ['query', 'context'], ['query', 'context']);
        const context = record(input.context, ['stopName', 'locationName', 'address', 'latitude', 'longitude', 'regionName', 'countryName', 'countryCode'], ['stopName']);
        const parsed: ImageSearchRequest = {
          query: stringValue(input.query),
          context: {
            stopName: stringValue(context.stopName), locationName: optionalString(context.locationName), address: optionalString(context.address),
            latitude: optionalFiniteNumber(context.latitude), longitude: optionalFiniteNumber(context.longitude), regionName: optionalString(context.regionName),
            countryName: optionalString(context.countryName), countryCode: optionalString(context.countryCode),
          },
        };
        const abort = requestAbort(request, response);
        try {
          const results = await dependencies.providers.imageSearch(
            { query: buildWebImageProviderQuery(parsed.query, parsed.context) },
            dependencies.providers.imageSearchApiKey ?? '',
            abort.signal,
          );
          json(response, 200, { results });
        } finally { abort.cleanup(); }
        return;
      }

      if (pathname === '/api/v1/backups' && method === 'POST') {
        requireWrite(request); ensureReady(dependencies); requireContentType(request, 'json');
        if ((await readBody(request, MAX_JSON_BYTES)).byteLength !== 0) invalid();
        json(response, 201, { backup: await dependencies.backups.create() });
        return;
      }
      if (pathname === '/api/v1/backups' && method === 'GET') {
        ensureReady(dependencies); json(response, 200, { backups: await dependencies.backups.list() }); return;
      }
      const backupMatch = pathname.match(/^\/api\/v1\/backups\/([^/]+)$/);
      if (backupMatch && method === 'GET') {
        ensureReady(dependencies); json(response, 200, { backup: await dependencies.backups.inspect(decodedId(backupMatch[1])) }); return;
      }
      const restoreMatch = pathname.match(/^\/api\/v1\/backups\/([^/]+)\/restore$/);
      if (restoreMatch && method === 'POST') {
        requireWrite(request); ensureReady(dependencies);
        const input = record(await jsonBody(request), ['confirmation'], ['confirmation']);
        const parsed: RestoreBackupRequest = { confirmation: stringValue(input.confirmation, false) };
        json(response, 200, { restored: await dependencies.backups.restore(decodedId(restoreMatch[1]), parsed) });
        return;
      }

      if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/healthz') {
        throw new HttpError(404, NOT_FOUND_MESSAGE);
      }
      await frontend(request, response, dependencies.publicRoot, pathname);
      };
      if (dependencies.operations && usesCanonicalStorage(pathname)) {
        await dependencies.operations.run(handle);
      } else {
        await handle();
      }
    } catch (error) {
      sendCaughtError(response, error);
    }
  };
}
