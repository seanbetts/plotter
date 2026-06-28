import type { Coordinates } from '../domain/types';

export type PlaceSearchResult = {
  id: string;
  label: string;
  coordinates: Coordinates;
  countryRegion: string;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

export async function searchNominatimPlaces(query: string): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(
      trimmed,
    )}`,
  );

  if (!response.ok) {
    throw new Error('Place search failed');
  }

  const results = (await response.json()) as NominatimResult[];

  return results.map((result) => {
    const labelParts = result.display_name.split(',').map((part) => part.trim());
    const countryRegion = labelParts.at(-1) ?? '';

    return {
      id: String(result.place_id),
      label: result.display_name,
      coordinates: {
        lat: Number(result.lat),
        lng: Number(result.lon),
      },
      countryRegion,
    };
  });
}
