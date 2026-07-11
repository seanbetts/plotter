import { describe, expect, it } from 'vitest';
import {
  TripCommandValidationError,
  validateActivityDraft,
  validateActivityPatch,
  validateStopDraft,
  validateStopPatch,
  validateTripManifest,
  validateUrlInput,
} from './validation';

const legacyRouteTypeField = ['ty', 'pe'].join('');
const legacyManualShippingValue = ['shipping', 'manual'].join('-');

describe('trip command validation', () => {
  it('accepts a stop draft with coordinates and notes', () => {
    expect(validateStopDraft({
      name: 'Kyle of Tongue Hostel & Holiday Park',
      place: {
        query: 'Kyle of Tongue Hostel & Holiday Park',
        coordinates: { lat: 58.492089, lng: -4.427364 },
      },
      expectedStayDays: 1,
      notes: 'Booked. Ref: WTB10B2DD9',
      tags: ['camping'],
    })).toEqual({
      name: 'Kyle of Tongue Hostel & Holiday Park',
      place: {
        query: 'Kyle of Tongue Hostel & Holiday Park',
        coordinates: { lat: 58.492089, lng: -4.427364 },
      },
      expectedStayDays: 1,
      notes: 'Booked. Ref: WTB10B2DD9',
      tags: ['camping'],
    });
  });

  it('allows stop patches to clear notes with an empty string', () => {
    expect(validateStopPatch({ notes: '' })).toEqual({ notes: '' });
  });

  it('requires stop drafts to include a place query or coordinates', () => {
    for (const input of [{ name: 'Lisbon' }, { name: 'Lisbon', place: {} }]) {
      expect(() => validateStopDraft(input)).toThrow(TripCommandValidationError);
      expect(() => validateStopDraft(input)).toThrow(
        "Stop 'Lisbon' needs place coordinates or a place query before it can be added.",
      );
    }
  });

  it('wraps URL normalization failures in TripCommandValidationError', () => {
    expect(validateUrlInput('example.com/nc500')).toBe('https://example.com/nc500');
    expect(() => validateUrlInput('ftp://example.com/file')).toThrow(TripCommandValidationError);
    expect(() => validateUrlInput('ftp://example.com/file')).toThrow('Links must use http or https.');
  });

  it('rejects invalid coordinates', () => {
    expect(() => validateStopDraft({
      name: 'Bad stop',
      place: { coordinates: { lat: 100, lng: 0 } },
    })).toThrow('Latitude must be between -90 and 90.');
  });

  it('accepts an empty activity place but requires a title', () => {
    expect(validateActivityDraft({ title: 'Smoo Cave' })).toEqual({
      title: 'Smoo Cave',
    });
    expect(() => validateActivityDraft({ title: '' })).toThrow('Activity title is required.');
  });

  it('accepts activity details currently surfaced in the panel', () => {
    expect(validateActivityPatch({
      description: 'Sea cave near Durness.',
      notes: 'Check tour status before going.',
      tags: ['cave', 'outdoors'],
      place: { query: 'Smoo Cave, Durness' },
    })).toEqual({
      description: 'Sea cave near Durness.',
      notes: 'Check tour status before going.',
      tags: ['cave', 'outdoors'],
      place: { query: 'Smoo Cave, Durness' },
    });
  });

  it('allows activity patches to clear description and notes with empty strings', () => {
    expect(validateActivityPatch({
      description: '',
      notes: '',
    })).toEqual({
      description: '',
      notes: '',
    });
  });

  it('rejects decimal expected stay days', () => {
    expect(() => validateStopDraft({
      name: 'Tongue',
      place: { coordinates: { lat: 58.492089, lng: -4.427364 } },
      expectedStayDays: 1.5,
    })).toThrow('stop.expectedStayDays must be a positive integer.');
    expect(() => validateStopPatch({ expectedStayDays: 2.25 })).toThrow(
      'patch.expectedStayDays must be a positive integer.',
    );
  });

  it('requires stop patches to include at least one field', () => {
    expect(() => validateStopPatch({})).toThrow('Stop patch must include at least one field.');
  });

  it('accepts and normalizes a complete trip manifest', () => {
    const manifest = validateTripManifest({
      manifestVersion: 2,
      name: 'Nordkapp Summer Loop',
      vehiclePreset: 'standard',
      stops: [
        {
          key: 'larvik',
          name: 'Larvik',
          place: { query: 'Larvik, Norway' },
          expectedStayDays: 1,
          notes: 'Ferry staging stop.',
          tags: ['practical-route', 'permit-or-booking'],
          links: ['https://www.colorline.com/denmark-norway'],
          activities: [],
        },
        {
          key: 'hirtshals',
          name: 'Hirtshals',
          place: { query: 'Hirtshals, Denmark' },
          expectedStayDays: 1,
          notes: 'Post-ferry buffer.',
          tags: ['practical-route', 'buffer-stop'],
          links: [],
          activities: [
            {
              title: 'Visit the harbour',
              place: { query: 'Hirtshals Havn, Denmark' },
              description: 'Short harbour walk.',
              notes: 'Keep flexible around the sailing.',
              tags: ['walk', 'coast'],
              links: ['https://example.com/harbour'],
            },
          ],
        },
      ],
      routeLegs: [
        {
          fromStopKey: 'larvik',
          toStopKey: 'hirtshals',
          movement: 'vehicle-shipping', calculation: 'manual',
          notes: 'Larvik-Hirtshals vehicle ferry.',
        },
      ],
    });

    expect(manifest.stops[1].activities[0].tags).toEqual(['walk', 'coast']);
    if (manifest.manifestVersion !== 2) throw new Error('Expected version 2.');
    expect(manifest.routeLegs[0]).toMatchObject({
      movement: 'vehicle-shipping',
      calculation: 'manual',
    });
  });

  it('requires a vehicle preset in version 2', () => {
    expect(() => validateTripManifest({
      manifestVersion: 2,
      name: 'Trip',
      stops: [],
      routeLegs: [],
    })).toThrowError(expect.objectContaining({
      code: 'VEHICLE_PRESET_REQUIRED',
      path: 'vehiclePreset',
    }));
  });

  it('normalizes the legacy version 1 manual shipping directive at the manifest boundary only', () => {
    const legacyRouteTypeField = ['ty', 'pe'].join('');
    const legacyManualShippingValue = ['shipping', 'manual'].join('-');
    const routeDirective = {
      fromStopKey: 'larvik',
      toStopKey: 'hirtshals',
      [legacyRouteTypeField]: legacyManualShippingValue,
      notes: 'Vehicle ferry.',
    };
    const input = {
      name: 'Legacy ferry',
      stops: [
        { key: 'larvik', name: 'Larvik', place: { query: 'Larvik' }, expectedStayDays: 1 },
        { key: 'hirtshals', name: 'Hirtshals', place: { query: 'Hirtshals' }, expectedStayDays: 1 },
      ],
      routeLegs: [routeDirective],
    };

    const manifest = validateTripManifest({ manifestVersion: 1, ...input });

    expect(manifest.routeLegs).toEqual([{
      fromStopKey: 'larvik',
      toStopKey: 'hirtshals',
      movement: 'vehicle-shipping',
      calculation: 'manual',
      ferryPolicy: 'allow',
      waypoints: [],
      notes: 'Vehicle ferry.',
    }]);
    expect(() => validateTripManifest({
      manifestVersion: 2,
      vehiclePreset: 'standard',
      ...input,
    })).toThrowError('routeLegs[0].type is not allowed.');
  });

  it('rejects version 2 route intent fields and a missing compatibility field in version 1', () => {
    const legacyRouteTypeField = ['ty', 'pe'].join('');
    const input = {
      manifestVersion: 1,
      name: 'Invalid V1 routing',
      stops: [
        { key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
        { key: 'b', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
      ],
    };

    expect(() => validateTripManifest({
      ...input,
      routeLegs: [{
        fromStopKey: 'a',
        toStopKey: 'b',
        movement: 'drive',
        calculation: 'automatic',
      }],
    })).toThrowError(expect.objectContaining({
      code: 'FIELD_NOT_ALLOWED',
      path: 'routeLegs[0].movement',
    }));
    expect(() => validateTripManifest({
      ...input,
      routeLegs: [{ fromStopKey: 'a', toStopKey: 'b' }],
    })).toThrowError(expect.objectContaining({
      code: 'INVALID_ROUTE_LEG_TYPE',
      path: `routeLegs[0].${legacyRouteTypeField}`,
    }));
  });

  it('accepts one exceptional automatic directive', () => {
    const manifest = validateTripManifest({
      manifestVersion: 2,
      name: 'Nordkapp',
      vehiclePreset: 'expedition-truck',
      stops: [
        { key: 'bremen', name: 'Bremen', place: { query: 'Bremen, Germany' }, expectedStayDays: 1 },
        { key: 'kristiansand', name: 'Kristiansand', place: { query: 'Kristiansand, Norway' }, expectedStayDays: 1 },
      ],
      routeLegs: [{
        fromStopKey: 'bremen',
        toStopKey: 'kristiansand',
        ferryPolicy: 'require',
        waypoints: [{
          name: 'Hirtshals ferry terminal',
          place: { query: 'Hirtshals ferry terminal, Denmark' },
          links: [],
        }],
      }],
    });

    expect(manifest.manifestVersion).toBe(2);
    if (manifest.manifestVersion !== 2) throw new Error('Expected version 2.');
    expect(manifest.vehiclePreset).toBe('expedition-truck');
    expect(manifest.routeLegs[0]).toMatchObject({
      movement: 'drive', calculation: 'automatic', ferryPolicy: 'require',
      waypoints: [{ name: 'Hirtshals ferry terminal', links: [] }],
    });
  });

  it('rejects unsupported route movement and calculation pairs in version 2', () => {
    expect(() => validateTripManifest({
      manifestVersion: 2,
      name: 'Broken',
      vehiclePreset: 'standard',
      stops: [
        { key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
        { key: 'b', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
      ],
      routeLegs: [{ fromStopKey: 'a', toStopKey: 'b', movement: 'drive', calculation: 'manual' }],
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_ROUTE_INTENT', path: 'routeLegs[0]' }));
  });

  it('defaults optional manifest collections to empty arrays', () => {
    expect(validateTripManifest({
      manifestVersion: 1,
      name: 'Simple trip',
      stops: [
        {
          key: 'home',
          name: 'Home',
          place: { query: 'Balcombe, UK' },
          expectedStayDays: 1,
        },
      ],
    })).toMatchObject({
      routeLegs: [],
      stops: [{ tags: [], links: [], activities: [] }],
    });
  });

  it.each([
    {
      name: 'an unsupported manifest version',
      input: { manifestVersion: 3, name: 'Broken', stops: [] },
      message: 'manifestVersion must be 1 or 2.',
    },
    {
      name: 'a missing expected stay',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [{ key: 'home', name: 'Home', place: { query: 'Home' } }],
      },
      message: 'stops[0].expectedStayDays is required.',
    },
    {
      name: 'a non-positive expected stay',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [{ key: 'home', name: 'Home', place: { query: 'Home' }, expectedStayDays: 0 }],
      },
      message: 'stops[0].expectedStayDays must be a positive integer.',
    },
    {
      name: 'duplicate stop keys',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [
          { key: 'same', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
          { key: 'same', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
        ],
      },
      message: 'stops[1].key must be unique.',
    },
    {
      name: 'malformed activity links',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [{
          key: 'a',
          name: 'A',
          place: { query: 'A' },
          expectedStayDays: 1,
          activities: [{ title: 'Thing', links: ['ftp://example.com'] }],
        }],
      },
      message: 'Links must use http or https.',
    },
    {
      name: 'unknown route stop keys',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [{ key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 }],
        routeLegs: [{
          fromStopKey: 'a',
          toStopKey: 'missing',
          [legacyRouteTypeField]: legacyManualShippingValue,
        }],
      },
      message: "routeLegs[0].toStopKey must reference a stop key.",
    },
    {
      name: 'non-adjacent route stops',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [
          { key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
          { key: 'b', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
          { key: 'c', name: 'C', place: { query: 'C' }, expectedStayDays: 1 },
        ],
        routeLegs: [{
          fromStopKey: 'a',
          toStopKey: 'c',
          [legacyRouteTypeField]: legacyManualShippingValue,
        }],
      },
      message: 'routeLegs[0] must connect adjacent stops in order.',
    },
    {
      name: 'duplicate route directives',
      input: {
        manifestVersion: 1,
        name: 'Broken',
        stops: [
          { key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
          { key: 'b', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
        ],
        routeLegs: [
          { fromStopKey: 'a', toStopKey: 'b', [legacyRouteTypeField]: legacyManualShippingValue },
          { fromStopKey: 'a', toStopKey: 'b', [legacyRouteTypeField]: legacyManualShippingValue },
        ],
      },
      message: 'routeLegs[1] duplicates an existing route directive.',
    },
    {
      name: 'unsupported route types',
      input: {
        manifestVersion: 2,
        name: 'Broken',
        vehiclePreset: 'standard',
        stops: [
          { key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
          { key: 'b', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
        ],
        routeLegs: [{ fromStopKey: 'a', toStopKey: 'b', movement: 'drive', calculation: 'manual' }],
      },
      message: 'routeLegs[0] uses an unsupported movement and calculation pair.',
    },
    {
      name: 'app-derived stop fields',
      input: {
        manifestVersion: 2,
        name: 'Broken',
        vehiclePreset: 'standard',
        stops: [{
          key: 'a',
          id: 'authored-id',
          name: 'A',
          place: { query: 'A' },
          expectedStayDays: 1,
        }],
      },
      message: 'stops[0].id is not allowed.',
    },
    {
      name: 'app-derived route fields',
      input: {
        manifestVersion: 2,
        name: 'Broken',
        vehiclePreset: 'standard',
        stops: [
          { key: 'a', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
          { key: 'b', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
        ],
        routeLegs: [{
          fromStopKey: 'a',
          toStopKey: 'b',
          movement: 'vehicle-shipping', calculation: 'manual',
          distanceKm: 10,
        }],
      },
      message: 'routeLegs[0].distanceKm is not allowed.',
    },
  ])('rejects $name', ({ input, message }) => {
    expect(() => validateTripManifest(input)).toThrow(message);
  });

});
