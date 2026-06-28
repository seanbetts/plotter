import type { Coordinates, DestinationLocation } from '../domain/types';

export type PlaceSearchResult =
  | {
      kind: 'place';
      id: string;
      label: string;
      coordinates: Coordinates;
      location: DestinationLocation;
    }
  | {
      kind: 'coordinates';
      id: string;
      label: string;
      coordinates: Coordinates;
    };

type SearchOptions = {
  apiKey: string;
  signal?: AbortSignal;
};

type MapTilerContextItem = {
  id?: string;
  text?: string;
  short_code?: string;
};

type MapTilerFeature = {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  properties?: {
    country_code?: string;
  };
  context?: MapTilerContextItem[];
};

type MapTilerResponse = {
  features?: MapTilerFeature[];
};

const mapTilerBaseUrl = 'https://api.maptiler.com/geocoding';
const usefulTypes = ['place', 'locality', 'municipality', 'region', 'subregion', 'county'];

export function parseCoordinateQuery(query: string): Coordinates | null {
  const match = query
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)$/);

  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

export async function searchMapTilerPlaces(
  query: string,
  options: SearchOptions,
): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const coordinates = parseCoordinateQuery(trimmed);
  if (coordinates) {
    return [
      {
        kind: 'coordinates',
        id: `coordinates:${coordinates.lat},${coordinates.lng}`,
        label: `Use coordinates ${coordinates.lat}, ${coordinates.lng}`,
        coordinates,
      },
    ];
  }

  const url = new URL(`${mapTilerBaseUrl}/${encodeURIComponent(trimmed)}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '6');
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('types', usefulTypes.join(','));

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error('Place search failed');
  }

  return mapMapTilerFeatures(await response.json());
}

export async function resolveMapTilerCoordinates(
  coordinates: Coordinates,
  options: SearchOptions,
): Promise<Extract<PlaceSearchResult, { kind: 'place' }>> {
  const url = new URL(`${mapTilerBaseUrl}/${coordinates.lng},${coordinates.lat}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '1');
  url.searchParams.set('types', usefulTypes.join(','));

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error('Coordinate lookup failed');
  }

  const [result] = mapMapTilerFeatures(await response.json());
  if (!result || result.kind !== 'place') {
    throw new Error('No location found for coordinates');
  }

  return result;
}

function mapMapTilerFeatures(responseJson: MapTilerResponse): PlaceSearchResult[] {
  return (responseJson.features ?? []).flatMap((feature) => {
    const center = feature.center;
    if (!center || center.length !== 2) return [];

    return [
      {
        kind: 'place' as const,
        id: feature.id ?? feature.place_name ?? `${center[1]},${center[0]}`,
        label: feature.place_name ?? feature.text ?? 'Unnamed place',
        coordinates: { lat: center[1], lng: center[0] },
        location: mapFeatureLocation(feature),
      },
    ];
  });
}

function mapFeatureLocation(feature: MapTilerFeature): DestinationLocation {
  const context = feature.context ?? [];
  const country = findContext(context, 'country');
  const region =
    findContext(context, 'county') ?? findContext(context, 'region') ?? findContext(context, 'subregion');
  const countryCode = feature.properties?.country_code ?? country?.short_code;

  return {
    placeName: feature.text ?? feature.place_name?.split(',')[0]?.trim() ?? 'Unnamed place',
    regionName: region?.text ?? '',
    countryName: country?.text ?? '',
    countryCode,
    sourceLabel: feature.place_name ?? feature.text ?? 'Unnamed place',
    sourceProvider: 'maptiler',
    sourceFeatureId: feature.id,
  };
}

function findContext(context: MapTilerContextItem[], type: string): MapTilerContextItem | undefined {
  return context.find((item) => item.id?.startsWith(`${type}.`));
}
