import type { Coordinates, DestinationLocation } from '../domain/types';

export type PlaceSearchContextItem = {
  id?: string;
  text?: string;
  shortCode?: string;
};

export type PlaceSearchMetadata = {
  placeTypes?: string[];
  placeTypeNames?: string[];
  address?: string;
  bbox?: [number, number, number, number];
  relevance?: number;
  matchingText?: string;
  matchingPlaceName?: string;
  context?: PlaceSearchContextItem[];
  distanceFromProximityKm?: number;
};

export type PlaceSearchResult =
  | ({
      kind: 'place';
      id: string;
      label: string;
      coordinates: Coordinates;
      location: DestinationLocation;
    } & PlaceSearchMetadata)
  | ({
      kind: 'coordinates';
      id: string;
      label: string;
      coordinates: Coordinates;
    } & Pick<PlaceSearchMetadata, 'distanceFromProximityKm'>);

export type SearchProfile = 'stop' | 'activity';

type SearchOptions = {
  apiKey: string;
  profile?: SearchProfile;
  proximity?: Coordinates;
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
  matching_text?: string;
  matching_place_name?: string;
  center?: [number, number];
  bbox?: [number, number, number, number];
  relevance?: number;
  place_type?: string[];
  place_type_name?: string[];
  address?: string;
  properties?: {
    country_code?: string;
  };
  context?: MapTilerContextItem[];
};

type MapTilerResponse = {
  features?: MapTilerFeature[];
};

const mapTilerBaseUrl = 'https://api.maptiler.com/geocoding';

const placeTypesByProfile: Record<SearchProfile, string[]> = {
  stop: [
    'place',
    'locality',
    'municipality',
    'municipal_district',
    'joint_municipality',
    'joint_submunicipality',
    'county',
    'subregion',
    'region',
  ],
  activity: ['poi', 'address', 'road', 'neighbourhood', 'place', 'locality'],
};

const resultLimitByProfile: Record<SearchProfile, number> = {
  stop: 8,
  activity: 10,
};

function getSearchProfile(options: SearchOptions): SearchProfile {
  return options.profile ?? 'stop';
}

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
        ...(options.proximity
          ? { distanceFromProximityKm: calculateDistanceKm(options.proximity, coordinates) }
          : {}),
      },
    ];
  }

  const profile = getSearchProfile(options);
  const url = new URL(`${mapTilerBaseUrl}/${encodeURIComponent(trimmed)}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', String(resultLimitByProfile[profile]));
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('types', placeTypesByProfile[profile].join(','));
  if (options.proximity) {
    url.searchParams.set('proximity', `${options.proximity.lng},${options.proximity.lat}`);
  }

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error('Place search failed');
  }

  return mapMapTilerFeatures(await response.json(), options.proximity);
}

export async function resolveMapTilerCoordinates(
  coordinates: Coordinates,
  options: SearchOptions,
): Promise<Extract<PlaceSearchResult, { kind: 'place' }>> {
  const profile = getSearchProfile(options);
  const url = new URL(`${mapTilerBaseUrl}/${coordinates.lng},${coordinates.lat}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '1');
  url.searchParams.set('types', placeTypesByProfile[profile].join(','));

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error('Coordinate lookup failed');
  }

  const [result] = mapMapTilerFeatures(await response.json(), options.proximity);
  if (!result || result.kind !== 'place') {
    throw new Error('No location found for coordinates');
  }

  return result;
}

function mapMapTilerFeatures(
  responseJson: MapTilerResponse,
  proximity?: Coordinates,
): PlaceSearchResult[] {
  return (responseJson.features ?? []).flatMap((feature) => {
    const center = feature.center;
    if (!center || center.length !== 2) return [];
    const coordinates = { lat: center[1], lng: center[0] };

    return [
      {
        kind: 'place' as const,
        id: feature.id ?? feature.place_name ?? `${center[1]},${center[0]}`,
        label: feature.place_name ?? feature.text ?? 'Unnamed place',
        coordinates,
        location: mapFeatureLocation(feature),
        ...mapFeatureMetadata(feature, proximity, coordinates),
      },
    ];
  });
}

function mapFeatureMetadata(
  feature: MapTilerFeature,
  proximity: Coordinates | undefined,
  coordinates: Coordinates,
): PlaceSearchMetadata {
  return {
    ...(feature.place_type ? { placeTypes: feature.place_type } : {}),
    ...(feature.place_type_name ? { placeTypeNames: feature.place_type_name } : {}),
    ...(feature.address ? { address: feature.address } : {}),
    ...(feature.bbox ? { bbox: feature.bbox } : {}),
    ...(feature.relevance !== undefined ? { relevance: feature.relevance } : {}),
    ...(feature.matching_text ? { matchingText: feature.matching_text } : {}),
    ...(feature.matching_place_name ? { matchingPlaceName: feature.matching_place_name } : {}),
    ...(feature.context ? { context: mapFeatureContext(feature.context) } : {}),
    ...(proximity ? { distanceFromProximityKm: calculateDistanceKm(proximity, coordinates) } : {}),
  };
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

function mapFeatureContext(context: MapTilerContextItem[]): PlaceSearchContextItem[] {
  return context.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    ...(item.text ? { text: item.text } : {}),
    ...(item.short_code ? { shortCode: item.short_code } : {}),
  }));
}

function calculateDistanceKm(from: Coordinates, to: Coordinates): number {
  const earthRadiusKm = 6371;
  const deltaLat = degreesToRadians(to.lat - from.lat);
  const deltaLng = degreesToRadians(to.lng - from.lng);
  const fromLat = degreesToRadians(from.lat);
  const toLat = degreesToRadians(to.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.ceil(earthRadiusKm * c * 10) / 10;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
