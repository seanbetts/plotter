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

export function formatLocationContext(label: string, names: string | string[]): string {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return '';

  const comparisonNames = (Array.isArray(names) ? names : [names])
    .map(normalizeLocationSegment)
    .filter(Boolean);
  if (comparisonNames.length === 0) return trimmedLabel;

  const labelParts = trimmedLabel
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const [firstPart, ...remainingParts] = labelParts;

  if (!firstPart) return trimmedLabel;

  if (comparisonNames.includes(normalizeLocationSegment(firstPart))) {
    return remainingParts.join(', ');
  }

  return trimmedLabel;
}

export function formatDestinationLocation(destination: Destination): string {
  const locationParts = formatLocationParts(destination.location);

  if (!locationParts || destination.name === destination.location.placeName) {
    return locationParts || destination.name;
  }

  return [destination.name, locationParts].filter(Boolean).join(', ');
}

function normalizeLocationSegment(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.'’]/g, '');
}
