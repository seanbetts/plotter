import type { Destination, DestinationLocation } from './types';

export function createLegacyLocation(input: {
  name: string;
  countryRegion?: string;
}): DestinationLocation {
  const countryName = input.countryRegion?.trim() ?? '';

  return {
    placeName: input.name,
    regionName: '',
    countryName,
    sourceLabel: [input.name, countryName].filter(Boolean).join(', '),
    sourceProvider: 'legacy',
  };
}

export function formatLocationParts(location: DestinationLocation): string {
  return [location.placeName, location.regionName, location.countryName].filter(Boolean).join(', ');
}

export function formatDestinationLocation(destination: Destination): string {
  const locationParts = formatLocationParts(destination.location);

  if (!locationParts || destination.name === destination.location.placeName) {
    return locationParts || destination.name;
  }

  return [destination.name, locationParts].filter(Boolean).join(', ');
}
