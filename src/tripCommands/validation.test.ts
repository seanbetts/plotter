import { describe, expect, it } from 'vitest';
import {
  TripCommandValidationError,
  validateActivityDraft,
  validateActivityPatch,
  validateStopDraft,
  validateStopPatch,
  validateUrlInput,
} from './validation';

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

  it('requires stop patches to include at least one field', () => {
    expect(() => validateStopPatch({})).toThrow('Stop patch must include at least one field.');
  });

});
