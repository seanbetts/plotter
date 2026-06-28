import { describe, expect, it } from 'vitest';
import { createDestination, updateDestination } from './destinations';
import { formatDestinationLocation } from './locations';

describe('destination helpers', () => {
  it('creates a destination with structured location fields', () => {
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'maptiler-balcombe',
      },
    });

    expect(destination.name).toBe('Balcombe');
    expect(destination.location.placeName).toBe('Balcombe');
    expect(destination.location.regionName).toBe('West Sussex');
    expect(destination.location.countryName).toBe('United Kingdom');
    expect(destination.countryRegion).toBe('United Kingdom');
    expect(destination.status).toBe('idea');
    expect(destination.priority).toBe('medium');
    expect(destination.order).toBe(0);
    expect(destination.timing.expectedStayDays).toBe(3);
    expect(destination.why.summary).toBe('');
    expect(destination.media).toEqual([]);
    expect(destination.research.links).toEqual([]);
    expect(destination.activities.items).toEqual([]);
    expect(destination.routeContext.notes).toBe('');
    expect(destination.tags).toEqual([]);
  });

  it('formats editable stop names separately from geocoded location names', () => {
    const destination = createDestination({
      name: 'Home',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    expect(formatDestinationLocation(destination)).toBe('Home, Balcombe, West Sussex, United Kingdom');
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

  it('accepts an explicit itinerary order', () => {
    const destination = createDestination({
      name: 'Tbilisi',
      coordinates: { lat: 41.7151, lng: 44.8271 },
      order: 12,
    });

    expect(destination.order).toBe(12);
  });
});
