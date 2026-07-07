import { resolveMapTilerCoordinates, searchMapTilerPlaces } from '../adapters/geocoding';
import { createLegacyLocation } from '../domain/locations';
import type { ActivityLocation } from '../domain/types';
import type { PlaceInput, PlaceResolver } from './types';

function manualActivityLocation(
  name: string,
  coordinates: NonNullable<PlaceInput['coordinates']>,
): ActivityLocation {
  return {
    name,
    address: 'TBC',
    coordinates,
    sourceProvider: 'manual',
  };
}

export function createPlaceResolver(options: { apiKey?: string }): PlaceResolver {
  return async ({ place, profile, fallbackName }) => {
    const apiKey = options.apiKey?.trim() ?? '';

    if (place.coordinates && apiKey) {
      try {
        const resolved = await resolveMapTilerCoordinates(place.coordinates, { apiKey, profile });
        return profile === 'activity'
          ? {
              coordinates: place.coordinates,
              activityLocation: {
                name: resolved.location.placeName,
                address: resolved.location.sourceLabel,
                coordinates: place.coordinates,
                sourceProvider: 'maptiler',
                sourceFeatureId: resolved.location.sourceFeatureId,
              },
            }
          : {
              coordinates: place.coordinates,
              location: resolved.location,
            };
      } catch {
        // Coordinates are still valid as a manual route/activity anchor.
      }
    }

    if (place.coordinates) {
      return profile === 'activity'
        ? {
            coordinates: place.coordinates,
            activityLocation: manualActivityLocation(fallbackName, place.coordinates),
          }
        : {
            coordinates: place.coordinates,
            location: createLegacyLocation({ name: fallbackName, countryRegion: '' }),
          };
    }

    if (!apiKey) {
      throw new Error('MapTiler API key is required to resolve place queries.');
    }

    const [result] = await searchMapTilerPlaces(place.query ?? '', { apiKey, profile });
    if (!result || result.kind !== 'place') {
      throw new Error(`Unable to resolve place query '${place.query}'.`);
    }

    return profile === 'activity'
      ? {
          coordinates: result.coordinates,
          activityLocation: {
            name: result.location.placeName,
            address: result.address ?? result.location.sourceLabel,
            coordinates: result.coordinates,
            sourceProvider: 'maptiler',
            sourceFeatureId: result.location.sourceFeatureId,
          },
        }
      : {
          coordinates: result.coordinates,
          location: result.location,
        };
  };
}
