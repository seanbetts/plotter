import { describe, expect, it } from 'vitest';
import { createDestination, updateDestination } from './destinations';

describe('destination helpers', () => {
  it('creates a destination with consistent structured profile fields', () => {
    const destination = createDestination({
      name: 'Cappadocia',
      coordinates: { lat: 38.6431, lng: 34.8289 },
      countryRegion: 'Turkey',
    });

    expect(destination.name).toBe('Cappadocia');
    expect(destination.countryRegion).toBe('Turkey');
    expect(destination.status).toBe('idea');
    expect(destination.priority).toBe('medium');
    expect(destination.timing.expectedStayDays).toBe(3);
    expect(destination.why.summary).toBe('');
    expect(destination.media).toEqual([]);
    expect(destination.research.links).toEqual([]);
    expect(destination.activities.items).toEqual([]);
    expect(destination.routeContext.notes).toBe('');
    expect(destination.tags).toEqual([]);
  });

  it('updates nested profile sections without dropping existing data', () => {
    const destination = createDestination({
      name: 'Queenstown',
      coordinates: { lat: -45.0312, lng: 168.6626 },
      countryRegion: 'New Zealand',
    });

    const updated = updateDestination(destination, {
      timing: { ...destination.timing, expectedStayDays: 7 },
      why: { ...destination.why, summary: 'Southern Alps base for skiing and roads.' },
      tags: ['ski', 'mountains'],
    });

    expect(updated.id).toBe(destination.id);
    expect(updated.timing.expectedStayDays).toBe(7);
    expect(updated.why.summary).toContain('Southern Alps');
    expect(updated.tags).toEqual(['ski', 'mountains']);
    expect(updated.updatedAt).not.toBe(destination.updatedAt);
  });
});
