import { normalizeResearchLinkUrl } from '../domain/researchLinks';
import type { Coordinates } from '../domain/types';
import type {
  ActivityDraft,
  ActivityManifestDraft,
  ActivityPatch,
  PlaceInput,
  RouteLegDirectiveDraftV2,
  RouteLegDirectiveInputV1,
  RouteLegIntentPatch,
  RouteWaypointDraft,
  StopDraft,
  StopManifestDraft,
  StopPatch,
  TripManifestDraft,
} from './types';

// Manifest V1 boundary compatibility only. Runtime route legs never retain this field or value.
const legacyManifestRouteTypeField = ['ty', 'pe'].join('');
const legacyManifestManualShippingValue = ['shipping', 'manual'].join('-');

export class TripCommandValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'TripCommandValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const unknownField = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownField) {
    const fieldPath = path ? `${path}.${unknownField}` : unknownField;
    throw new TripCommandValidationError('FIELD_NOT_ALLOWED', `${fieldPath} is not allowed.`, fieldPath);
  }
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TripCommandValidationError('INVALID_STRING', `${path} must be a string.`, path);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(value: unknown, label: string, path: string) {
  const trimmed = optionalString(value, path);
  if (!trimmed) {
    throw new TripCommandValidationError('REQUIRED_STRING', `${label} is required.`, path);
  }
  return trimmed;
}

function optionalRequiredString(value: unknown, label: string, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label, path);
}

function optionalClearableString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TripCommandValidationError('INVALID_STRING', `${path} must be a string.`, path);
  }
  return value.trim();
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TripCommandValidationError('INVALID_STRING_ARRAY', `${path} must be an array of strings.`, path);
  }

  const deduped: string[] = [];
  value.forEach((item, index) => {
    const normalized = requiredString(item, `${path}[${index}]`, `${path}[${index}]`);
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  });

  return deduped;
}

function optionalUrlArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TripCommandValidationError('INVALID_URL_ARRAY', `${path} must be an array of URLs.`, path);
  }

  const deduped: string[] = [];
  value.forEach((item, index) => {
    const normalized = validateUrlInput(item, `${path}[${index}]`);
    if (!deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  });
  return deduped;
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new TripCommandValidationError('INVALID_POSITIVE_INTEGER', `${path} must be a positive integer.`, path);
  }
  return parsed;
}

function validateCoordinates(value: unknown, path: string): Coordinates | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TripCommandValidationError('INVALID_COORDINATES', `${path} must include lat and lng.`, path);
  }
  rejectUnknownFields(value, ['lat', 'lng'], path);

  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat)) {
    throw new TripCommandValidationError('INVALID_LATITUDE', 'Latitude must be a number.', `${path}.lat`);
  }
  if (!Number.isFinite(lng)) {
    throw new TripCommandValidationError('INVALID_LONGITUDE', 'Longitude must be a number.', `${path}.lng`);
  }
  if (lat < -90 || lat > 90) {
    throw new TripCommandValidationError('INVALID_LATITUDE', 'Latitude must be between -90 and 90.', `${path}.lat`);
  }
  if (lng < -180 || lng > 180) {
    throw new TripCommandValidationError('INVALID_LONGITUDE', 'Longitude must be between -180 and 180.', `${path}.lng`);
  }

  return { lat, lng };
}

export function validatePlaceInput(
  value: unknown,
  path: string,
  options: { required: boolean },
): PlaceInput | undefined {
  if (value === undefined) {
    if (options.required) {
      throw new TripCommandValidationError('STOP_LOCATION_REQUIRED', 'Place input is required.', path);
    }
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TripCommandValidationError('INVALID_PLACE', `${path} must be an object.`, path);
  }

  const place = {
    query: optionalString(value.query, `${path}.query`),
    coordinates: validateCoordinates(value.coordinates, `${path}.coordinates`),
  };

  if (!place.query && !place.coordinates) {
    throw new TripCommandValidationError('PLACE_REQUIRED', `${path} needs coordinates or a query.`, path);
  }

  return place;
}

function validateManifestPlace(value: unknown, path: string, required: boolean) {
  if (isRecord(value)) {
    rejectUnknownFields(value, ['query', 'coordinates'], path);
  }
  return validatePlaceInput(value, path, { required });
}

function validateActivityManifest(input: unknown, path: string): ActivityManifestDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ACTIVITY', `${path} must be an object.`, path);
  }
  rejectUnknownFields(input, ['title', 'place', 'description', 'notes', 'tags', 'links'], path);

  const place = validateManifestPlace(input.place, `${path}.place`, false);
  const description = optionalString(input.description, `${path}.description`);
  const notes = optionalString(input.notes, `${path}.notes`);

  return {
    title: requiredString(input.title, 'Activity title', `${path}.title`),
    ...(place ? { place } : {}),
    ...(description ? { description } : {}),
    ...(notes ? { notes } : {}),
    tags: optionalStringArray(input.tags, `${path}.tags`) ?? [],
    links: optionalUrlArray(input.links, `${path}.links`) ?? [],
  };
}

function validateStopManifest(input: unknown, path: string): StopManifestDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_STOP', `${path} must be an object.`, path);
  }
  rejectUnknownFields(
    input,
    ['key', 'name', 'place', 'expectedStayDays', 'notes', 'tags', 'links', 'activities'],
    path,
  );

  if (input.expectedStayDays === undefined) {
    const stayPath = `${path}.expectedStayDays`;
    throw new TripCommandValidationError('REQUIRED_POSITIVE_INTEGER', `${stayPath} is required.`, stayPath);
  }
  const expectedStayDays = optionalPositiveInteger(input.expectedStayDays, `${path}.expectedStayDays`);
  const place = validateManifestPlace(input.place, `${path}.place`, true);
  if (!place || expectedStayDays === undefined) {
    throw new TripCommandValidationError('INVALID_STOP', `${path} is invalid.`, path);
  }
  if (input.activities !== undefined && !Array.isArray(input.activities)) {
    throw new TripCommandValidationError(
      'INVALID_ACTIVITY_ARRAY',
      `${path}.activities must be an array.`,
      `${path}.activities`,
    );
  }
  const notes = optionalString(input.notes, `${path}.notes`);

  return {
    key: requiredString(input.key, 'Stop key', `${path}.key`),
    name: requiredString(input.name, 'Stop name', `${path}.name`),
    place,
    expectedStayDays,
    ...(notes ? { notes } : {}),
    tags: optionalStringArray(input.tags, `${path}.tags`) ?? [],
    links: optionalUrlArray(input.links, `${path}.links`) ?? [],
    activities: (input.activities ?? []).map((activity, index) => (
      validateActivityManifest(activity, `${path}.activities[${index}]`)
    )),
  };
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TripCommandValidationError(code, `${path} must be one of: ${allowed.join(', ')}.`, path);
  }
  return value as T;
}

function validateRouteWaypointDraft(input: unknown, path: string): RouteWaypointDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ROUTE_WAYPOINT', `${path} must be an object.`, path);
  }
  rejectUnknownFields(input, ['name', 'place', 'notes', 'links'], path);
  const place = validateManifestPlace(input.place, `${path}.place`, true);
  if (!place) {
    throw new TripCommandValidationError('INVALID_ROUTE_WAYPOINT', `${path} is invalid.`, path);
  }
  const notes = optionalString(input.notes, `${path}.notes`);
  return {
    name: requiredString(input.name, 'Waypoint name', `${path}.name`),
    place,
    ...(notes ? { notes } : {}),
    links: optionalUrlArray(input.links, `${path}.links`) ?? [],
  };
}

function validateRouteLegDirectiveV2(input: unknown, path: string): RouteLegDirectiveDraftV2 {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ROUTE_LEG', `${path} must be an object.`, path);
  }
  rejectUnknownFields(
    input,
    ['fromStopKey', 'toStopKey', 'movement', 'calculation', 'ferryPolicy', 'waypoints', 'notes'],
    path,
  );
  const movement = validateEnum(input.movement, ['drive', 'vehicle-shipping'], `${path}.movement`, 'INVALID_ROUTE_MOVEMENT') ?? 'drive';
  const calculation = validateEnum(input.calculation, ['automatic', 'manual'], `${path}.calculation`, 'INVALID_ROUTE_CALCULATION') ?? 'automatic';
  if (!((movement === 'drive' && calculation === 'automatic') || (movement === 'vehicle-shipping' && calculation === 'manual'))) {
    throw new TripCommandValidationError(
      'UNSUPPORTED_ROUTE_INTENT',
      `${path} uses an unsupported movement and calculation pair.`,
      path,
    );
  }
  if (input.waypoints !== undefined && !Array.isArray(input.waypoints)) {
    throw new TripCommandValidationError('INVALID_ROUTE_WAYPOINT_ARRAY', `${path}.waypoints must be an array.`, `${path}.waypoints`);
  }
  const ferryPolicy = validateEnum(input.ferryPolicy, ['allow', 'avoid', 'require'], `${path}.ferryPolicy`, 'INVALID_FERRY_POLICY') ?? 'allow';
  const notes = optionalString(input.notes, `${path}.notes`);
  return {
    fromStopKey: requiredString(input.fromStopKey, 'Route start stop key', `${path}.fromStopKey`),
    toStopKey: requiredString(input.toStopKey, 'Route end stop key', `${path}.toStopKey`),
    movement,
    calculation,
    ferryPolicy,
    waypoints: (input.waypoints ?? []).map((waypoint, index) => validateRouteWaypointDraft(waypoint, `${path}.waypoints[${index}]`)),
    ...(notes ? { notes } : {}),
  };
}

function validateRouteLegDirectiveV1(input: unknown, path: string): RouteLegDirectiveDraftV2 {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ROUTE_LEG', `${path} must be an object.`, path);
  }
  const boundaryInput: RouteLegDirectiveInputV1 = input;
  if (!(legacyManifestRouteTypeField in boundaryInput)) {
    return validateRouteLegDirectiveV2(boundaryInput, path);
  }
  rejectUnknownFields(
    boundaryInput,
    ['fromStopKey', 'toStopKey', legacyManifestRouteTypeField, 'notes'],
    path,
  );
  if (boundaryInput[legacyManifestRouteTypeField] !== legacyManifestManualShippingValue) {
    throw new TripCommandValidationError(
      'INVALID_ROUTE_LEG_TYPE',
      `${path}.${legacyManifestRouteTypeField} must be the supported version 1 manual shipping value.`,
      `${path}.${legacyManifestRouteTypeField}`,
    );
  }
  const notes = optionalString(boundaryInput.notes, `${path}.notes`);
  return {
    fromStopKey: requiredString(boundaryInput.fromStopKey, 'Route start stop key', `${path}.fromStopKey`),
    toStopKey: requiredString(boundaryInput.toStopKey, 'Route end stop key', `${path}.toStopKey`),
    movement: 'vehicle-shipping',
    calculation: 'manual',
    ferryPolicy: 'allow',
    waypoints: [],
    ...(notes ? { notes } : {}),
  };
}

export function validateVehiclePreset(input: unknown, path = 'preset') {
  if (input === undefined) {
    throw new TripCommandValidationError(
      'VEHICLE_PRESET_REQUIRED',
      'Vehicle preset is required.',
      path,
    );
  }
  return validateEnum(input, ['standard', 'large-camper', 'expedition-truck'], path, 'INVALID_VEHICLE_PRESET')!;
}

export function validateRouteLegIntentPatch(input: unknown, path = 'patch'): RouteLegIntentPatch {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ROUTE_LEG_PATCH', `${path} must be an object.`, path);
  }
  rejectUnknownFields(input, ['movement', 'calculation', 'ferryPolicy', 'waypoints', 'notes'], path);
  if (Object.keys(input).length === 0) {
    throw new TripCommandValidationError('EMPTY_ROUTE_LEG_PATCH', 'Route leg patch must include at least one field.', path);
  }
  if (input.waypoints !== undefined && !Array.isArray(input.waypoints)) {
    throw new TripCommandValidationError('INVALID_ROUTE_WAYPOINT_ARRAY', `${path}.waypoints must be an array.`, `${path}.waypoints`);
  }
  const movement = validateEnum(input.movement, ['drive', 'vehicle-shipping'], `${path}.movement`, 'INVALID_ROUTE_MOVEMENT');
  const calculation = validateEnum(input.calculation, ['automatic', 'manual'], `${path}.calculation`, 'INVALID_ROUTE_CALCULATION');
  const ferryPolicy = validateEnum(input.ferryPolicy, ['allow', 'avoid', 'require'], `${path}.ferryPolicy`, 'INVALID_FERRY_POLICY');
  const notes = optionalClearableString(input.notes, `${path}.notes`);
  return {
    ...(movement ? { movement } : {}),
    ...(calculation ? { calculation } : {}),
    ...(ferryPolicy ? { ferryPolicy } : {}),
    ...(input.waypoints ? {
      waypoints: input.waypoints.map((waypoint, index) => validateRouteWaypointDraft(waypoint, `${path}.waypoints[${index}]`)),
    } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

export function validateTripManifest(input: unknown): TripManifestDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_TRIP_MANIFEST', 'Trip manifest must be an object.');
  }
  if (input.manifestVersion !== 1 && input.manifestVersion !== 2) {
    throw new TripCommandValidationError(
      'UNSUPPORTED_MANIFEST_VERSION',
      'manifestVersion must be 1 or 2.',
      'manifestVersion',
    );
  }
  rejectUnknownFields(
    input,
    input.manifestVersion === 2
      ? ['manifestVersion', 'name', 'vehiclePreset', 'stops', 'routeLegs']
      : ['manifestVersion', 'name', 'stops', 'routeLegs'],
    '',
  );
  const vehiclePreset = input.manifestVersion === 2
    ? validateEnum(input.vehiclePreset, ['standard', 'large-camper', 'expedition-truck'], 'vehiclePreset', 'INVALID_VEHICLE_PRESET')
    : undefined;
  if (input.manifestVersion === 2 && !vehiclePreset) {
    throw new TripCommandValidationError('VEHICLE_PRESET_REQUIRED', 'vehiclePreset is required.', 'vehiclePreset');
  }
  if (!Array.isArray(input.stops)) {
    throw new TripCommandValidationError('INVALID_STOP_ARRAY', 'stops must be an array.', 'stops');
  }
  if (input.routeLegs !== undefined && !Array.isArray(input.routeLegs)) {
    throw new TripCommandValidationError('INVALID_ROUTE_LEG_ARRAY', 'routeLegs must be an array.', 'routeLegs');
  }

  const stops = input.stops.map((stop, index) => validateStopManifest(stop, `stops[${index}]`));
  const stopIndexes = new Map<string, number>();
  stops.forEach((stop, index) => {
    if (stopIndexes.has(stop.key)) {
      const path = `stops[${index}].key`;
      throw new TripCommandValidationError('DUPLICATE_STOP_KEY', `${path} must be unique.`, path);
    }
    stopIndexes.set(stop.key, index);
  });

  const routeLegs = (input.routeLegs ?? []).map((leg, index) => (
    input.manifestVersion === 1
      ? validateRouteLegDirectiveV1(leg, `routeLegs[${index}]`)
      : validateRouteLegDirectiveV2(leg, `routeLegs[${index}]`)
  ));
  const directivePairs = new Set<string>();
  routeLegs.forEach((leg, index) => {
    const path = `routeLegs[${index}]`;
    const fromIndex = stopIndexes.get(leg.fromStopKey);
    const toIndex = stopIndexes.get(leg.toStopKey);
    if (fromIndex === undefined) {
      throw new TripCommandValidationError(
        'UNKNOWN_ROUTE_STOP_KEY',
        `${path}.fromStopKey must reference a stop key.`,
        `${path}.fromStopKey`,
      );
    }
    if (toIndex === undefined) {
      throw new TripCommandValidationError(
        'UNKNOWN_ROUTE_STOP_KEY',
        `${path}.toStopKey must reference a stop key.`,
        `${path}.toStopKey`,
      );
    }
    if (toIndex !== fromIndex + 1) {
      throw new TripCommandValidationError(
        'NON_ADJACENT_ROUTE_STOPS',
        `${path} must connect adjacent stops in order.`,
        path,
      );
    }
    const pair = `${leg.fromStopKey}\u0000${leg.toStopKey}`;
    if (directivePairs.has(pair)) {
      throw new TripCommandValidationError(
        'DUPLICATE_ROUTE_DIRECTIVE',
        `${path} duplicates an existing route directive.`,
        path,
      );
    }
    directivePairs.add(pair);
  });

  const name = requiredString(input.name, 'Trip name', 'name');
  return input.manifestVersion === 2
    ? { manifestVersion: 2, name, vehiclePreset: vehiclePreset!, stops, routeLegs: routeLegs as RouteLegDirectiveDraftV2[] }
    : { manifestVersion: 1, name, stops, routeLegs: routeLegs as RouteLegDirectiveDraftV2[] };
}

export function validateStopDraft(input: unknown, path = 'stop'): StopDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_STOP', `${path} must be an object.`, path);
  }

  const name = requiredString(input.name, 'Stop name', `${path}.name`);
  const place = (() => {
    try {
      const validatedPlace = validatePlaceInput(input.place, `${path}.place`, { required: true });
      if (!validatedPlace) {
        throw new TripCommandValidationError(
          'STOP_LOCATION_REQUIRED',
          `Stop '${name}' needs place coordinates or a place query before it can be added.`,
          path,
        );
      }
      return validatedPlace;
    } catch (error) {
      if (error instanceof TripCommandValidationError && (error.code === 'STOP_LOCATION_REQUIRED' || error.code === 'PLACE_REQUIRED')) {
        throw new TripCommandValidationError(
          'STOP_LOCATION_REQUIRED',
          `Stop '${name}' needs place coordinates or a place query before it can be added.`,
          path,
        );
      }
      throw error;
    }
  })();

  const expectedStayDays = optionalPositiveInteger(input.expectedStayDays, `${path}.expectedStayDays`);
  const notes = optionalString(input.notes, `${path}.notes`);
  const tags = optionalStringArray(input.tags, `${path}.tags`);
  const id = optionalString(input.id, `${path}.id`);

  return {
    ...(id ? { id } : {}),
    name,
    place,
    ...(expectedStayDays !== undefined ? { expectedStayDays } : {}),
    ...(notes ? { notes } : {}),
    ...(tags ? { tags } : {}),
  };
}

export function validateStopPatch(input: unknown, path = 'patch'): StopPatch {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_STOP_PATCH', `${path} must be an object.`, path);
  }

  const patch: StopPatch = {};
  const name = optionalRequiredString(input.name, 'Stop name', `${path}.name`);
  const place = validatePlaceInput(input.place, `${path}.place`, { required: false });
  const expectedStayDays = optionalPositiveInteger(input.expectedStayDays, `${path}.expectedStayDays`);
  const notes = optionalClearableString(input.notes, `${path}.notes`);
  const tags = optionalStringArray(input.tags, `${path}.tags`);

  if (name !== undefined) patch.name = name;
  if (place !== undefined) patch.place = place;
  if (expectedStayDays !== undefined) patch.expectedStayDays = expectedStayDays;
  if (notes !== undefined) patch.notes = notes;
  if (tags !== undefined) patch.tags = tags;

  if (Object.keys(patch).length === 0) {
    throw new TripCommandValidationError('EMPTY_STOP_PATCH', 'Stop patch must include at least one field.', path);
  }

  return patch;
}

export function validateActivityDraft(input: unknown, path = 'activity'): ActivityDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ACTIVITY', `${path} must be an object.`, path);
  }

  const draft: ActivityDraft = {
    title: requiredString(input.title, 'Activity title', `${path}.title`),
  };

  const place = validatePlaceInput(input.place, `${path}.place`, { required: false });
  if (place !== undefined) {
    draft.place = place;
  }

  return draft;
}

export function validateActivityPatch(input: unknown, path = 'patch'): ActivityPatch {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ACTIVITY_PATCH', `${path} must be an object.`, path);
  }

  const patch: ActivityPatch = {};
  const title = optionalRequiredString(input.title, 'Activity title', `${path}.title`);
  const description = optionalClearableString(input.description, `${path}.description`);
  const notes = optionalClearableString(input.notes, `${path}.notes`);
  const tags = optionalStringArray(input.tags, `${path}.tags`);
  const place = validatePlaceInput(input.place, `${path}.place`, { required: false });

  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (notes !== undefined) patch.notes = notes;
  if (tags !== undefined) patch.tags = tags;
  if (place !== undefined) patch.place = place;

  if (Object.keys(patch).length === 0) {
    throw new TripCommandValidationError('EMPTY_ACTIVITY_PATCH', 'Activity patch must include at least one field.', path);
  }

  return patch;
}

export function validateUrlInput(input: unknown, path = 'url') {
  if (typeof input !== 'string') {
    throw new TripCommandValidationError('INVALID_URL', `${path} must be a string.`, path);
  }

  try {
    return normalizeResearchLinkUrl(input);
  } catch (error) {
    if (error instanceof Error) {
      throw new TripCommandValidationError('INVALID_URL', error.message, path);
    }
    throw new TripCommandValidationError('INVALID_URL', `${path} must be a valid URL.`, path);
  }
}
