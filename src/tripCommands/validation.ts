import { normalizeResearchLinkUrl } from '../domain/researchLinks';
import type { Coordinates } from '../domain/types';
import type { ActivityDraft, ActivityPatch, PlaceInput, StopDraft, StopPatch } from './types';

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
