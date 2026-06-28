import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
};

type DestinationFeatureProperties = {
  id: string;
  name: string;
  order: number;
  selected: boolean;
};

type RouteFeatureProperties = {
  id: string;
  type: RouteLeg['type'] | 'failed';
  status: RouteLeg['status'];
};

type CityFeatureProperties = {
  id: string;
  name: string;
};

type GeoJsonSource = maplibregl.GeoJSONSource & {
  setData: (data: FeatureCollection) => void;
};

type MapDetailCategory = {
  id: string;
  label: string;
  group: string;
  idPatterns?: string[];
  sourceLayers?: string[];
  defaultVisible: boolean;
};

const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';
const styleUrl = mapTilerApiKey
  ? `https://api.maptiler.com/maps/streets-v4/style.json?key=${mapTilerApiKey}`
  : 'https://demotiles.maplibre.org/style.json';
const majorCityMinZoom = 5;
const showMapDetailDevTools = import.meta.env.VITE_ENABLE_MAP_DETAIL_DEV_TOOLS === 'true';
const minDetailZoom = 1;
const maxDetailZoom = 18;
const hiddenBasemapLayerPatterns = [
  'aerialway',
  'barrier',
  'building',
  'contour',
  'housenumber',
  'landuse',
  'mountain',
  'park-label',
  'parking',
  'poi',
  'rail',
  'shop',
  'trail',
  'transit',
];
const softenedLineLayerPatterns = ['minor', 'path', 'track', 'service'];
const mapDetailCategories: MapDetailCategory[] = [
  { id: 'water', label: 'Water', group: 'Natural', sourceLayers: ['water'], defaultVisible: true },
  { id: 'waterway', label: 'Rivers & streams', group: 'Natural', sourceLayers: ['waterway'], defaultVisible: true },
  {
    id: 'water-labels',
    label: 'Water labels',
    group: 'Natural',
    sourceLayers: ['water_label', 'water_centroid'],
    defaultVisible: true,
  },
  {
    id: 'landcover',
    label: 'Forests & vegetation',
    group: 'Natural',
    sourceLayers: ['forest', 'wood', 'vegetation', 'grass', 'tree'],
    defaultVisible: true,
  },
  {
    id: 'terrain',
    label: 'Terrain surfaces',
    group: 'Natural',
    sourceLayers: ['farmland', 'ice', 'sand'],
    defaultVisible: true,
  },
  { id: 'contour', label: 'Contours', group: 'Natural', idPatterns: ['contour'], defaultVisible: false },
  { id: 'dam-pier', label: 'Dams & piers', group: 'Natural', sourceLayers: ['dam', 'pier'], defaultVisible: true },
  {
    id: 'country-borders',
    label: 'Country borders',
    group: 'Borders',
    sourceLayers: ['country_border', 'country_border_disputed'],
    defaultVisible: true,
  },
  { id: 'sub-borders', label: 'Regional borders', group: 'Borders', sourceLayers: ['sub_border'], defaultVisible: true },
  { id: 'aerialway', label: 'Aerialways', group: 'Transport', sourceLayers: ['aerialway'], defaultVisible: false },
  {
    id: 'airports',
    label: 'Airports',
    group: 'Transport',
    sourceLayers: ['aviation', 'aviation_line'],
    idPatterns: ['airport', 'aeroway', 'heliport'],
    defaultVisible: false,
  },
  { id: 'ferries', label: 'Ferries', group: 'Transport', sourceLayers: ['ferry', 'ferry_label'], defaultVisible: false },
  { id: 'rail', label: 'Railways', group: 'Transport', sourceLayers: ['railway', 'railway_label'], defaultVisible: false },
  { id: 'transit', label: 'Transit stops', group: 'Transport', sourceLayers: ['poi_station'], defaultVisible: false },
  {
    id: 'bridges',
    label: 'Bridges',
    group: 'Roads',
    sourceLayers: ['bridge'],
    defaultVisible: true,
  },
  { id: 'highways', label: 'Highways', group: 'Roads', idPatterns: ['highway'], defaultVisible: true },
  {
    id: 'major-roads',
    label: 'Major roads',
    group: 'Roads',
    idPatterns: ['major road', 'road_major'],
    defaultVisible: true,
  },
  { id: 'minor', label: 'Minor roads', group: 'Roads', idPatterns: ['minor road', 'road_minor'], defaultVisible: true },
  { id: 'service', label: 'Service roads', group: 'Roads', idPatterns: ['service road'], defaultVisible: true },
  {
    id: 'restricted-roads',
    label: 'Restricted roads',
    group: 'Roads',
    idPatterns: ['no access'],
    defaultVisible: false,
  },
  {
    id: 'road-construction',
    label: 'Road construction',
    group: 'Roads',
    idPatterns: ['under construction'],
    defaultVisible: false,
  },
  { id: 'other-roads', label: 'Other roads', group: 'Roads', sourceLayers: ['road'], defaultVisible: true },
  { id: 'road-labels', label: 'Road labels', group: 'Roads', sourceLayers: ['road_label', 'road_exit'], defaultVisible: true },
  {
    id: 'paths-cycleways',
    label: 'Paths & cycleways',
    group: 'Paths',
    sourceLayers: ['pathway', 'pathway_label'],
    idPatterns: ['cycleway', 'pathway'],
    defaultVisible: true,
  },
  { id: 'track', label: 'Tracks', group: 'Paths', idPatterns: ['track'], defaultVisible: true },
  { id: 'steps', label: 'Steps', group: 'Paths', idPatterns: ['steps'], defaultVisible: false },
  { id: 'building', label: 'Buildings', group: 'Land use', sourceLayers: ['building'], defaultVisible: false },
  {
    id: 'building-numbers',
    label: 'Building numbers',
    group: 'Land use',
    sourceLayers: ['building_number'],
    defaultVisible: false,
  },
  {
    id: 'residential',
    label: 'Residential areas',
    group: 'Land use',
    sourceLayers: ['residential'],
    defaultVisible: true,
  },
  {
    id: 'commercial-industrial',
    label: 'Commercial & industrial',
    group: 'Land use',
    sourceLayers: ['commercial', 'industrial'],
    defaultVisible: true,
  },
  {
    id: 'education-health',
    label: 'Education & healthcare',
    group: 'Land use',
    sourceLayers: ['education', 'hospital'],
    defaultVisible: true,
  },
  {
    id: 'leisure-culture',
    label: 'Leisure & culture areas',
    group: 'Land use',
    sourceLayers: ['leisure', 'cemetery'],
    defaultVisible: true,
  },
  {
    id: 'construction',
    label: 'Construction areas',
    group: 'Land use',
    sourceLayers: ['construction'],
    defaultVisible: false,
  },
  { id: 'military', label: 'Military areas', group: 'Land use', sourceLayers: ['military'], defaultVisible: false },
  { id: 'pedestrian', label: 'Pedestrian areas', group: 'Land use', sourceLayers: ['pedestrian'], defaultVisible: true },
  { id: 'parking', label: 'Parking', group: 'Places', sourceLayers: ['parking'], defaultVisible: false },
  { id: 'poi-food', label: 'Food', group: 'Places', sourceLayers: ['poi_food'], defaultVisible: false },
  { id: 'poi-shopping', label: 'Shopping', group: 'Places', sourceLayers: ['poi_shopping'], defaultVisible: false },
  {
    id: 'poi-accommodation',
    label: 'Accommodation',
    group: 'Places',
    sourceLayers: ['poi_accommodation'],
    defaultVisible: false,
  },
  {
    id: 'poi-tourism-culture',
    label: 'Tourism & culture',
    group: 'Places',
    sourceLayers: ['poi_tourism', 'poi_culture'],
    defaultVisible: false,
  },
  {
    id: 'poi-health-education',
    label: 'Health & education POIs',
    group: 'Places',
    sourceLayers: ['poi_healthcare', 'poi_education'],
    defaultVisible: false,
  },
  {
    id: 'poi-public-sport',
    label: 'Public & sport POIs',
    group: 'Places',
    sourceLayers: ['poi_public', 'poi_sport'],
    defaultVisible: false,
  },
  { id: 'poi-transport', label: 'Transport POIs', group: 'Places', sourceLayers: ['poi_transport'], defaultVisible: false },
  { id: 'poi', label: 'POIs', group: 'Places', idPatterns: ['poi'], defaultVisible: false },
  { id: 'street-furniture', label: 'Street furniture', group: 'Places', sourceLayers: ['street_furniture'], defaultVisible: false },
  {
    id: 'country-labels',
    label: 'Country labels',
    group: 'Labels',
    sourceLayers: ['country_label', 'country_disputed_label'],
    defaultVisible: true,
  },
  {
    id: 'region-labels',
    label: 'Region labels',
    group: 'Labels',
    sourceLayers: ['state_label'],
    defaultVisible: true,
  },
  {
    id: 'capital-city-labels',
    label: 'Capital city labels',
    group: 'Labels',
    idPatterns: ['capital city labels'],
    defaultVisible: true,
  },
  { id: 'city-labels', label: 'City labels', group: 'Labels', idPatterns: ['city labels'], defaultVisible: true },
  {
    id: 'town-place-labels',
    label: 'Town & place labels',
    group: 'Labels',
    sourceLayers: ['town_label', 'place_label', 'island_label'],
    defaultVisible: true,
  },
  {
    id: 'continent-labels',
    label: 'Continent labels',
    group: 'Labels',
    sourceLayers: ['continent_label', 'archipelago_label'],
    defaultVisible: true,
  },
  {
    id: 'housenumber',
    label: 'House numbers',
    group: 'Labels',
    idPatterns: ['housenumber'],
    defaultVisible: false,
  },
  {
    id: 'mountain',
    label: 'Mountain labels',
    group: 'Labels',
    idPatterns: ['mountain'],
    defaultVisible: false,
  },
  { id: 'park-label', label: 'Park labels', group: 'Labels', idPatterns: ['park-label'], defaultVisible: false },
];
const mapDetailGroups = Array.from(new Set(mapDetailCategories.map((category) => category.group)));
const zoom1EnabledCategories = [
  'water',
  'water-labels',
  'landcover',
  'country-borders',
  'continent-labels',
];
const zoom3EnabledCategories = [...zoom1EnabledCategories, 'country-labels'];
const zoom4EnabledCategories = [
  ...zoom3EnabledCategories,
  'sub-borders',
  'capital-city-labels',
];
const zoom5EnabledCategories = [...zoom4EnabledCategories, 'highways', 'city-labels'];
const zoom6EnabledCategories = [
  ...zoom5EnabledCategories,
  'major-roads',
  'road-labels',
  'region-labels',
];
const zoom7EnabledCategories = [
  ...zoom6EnabledCategories,
  'waterway',
  'terrain',
  'dam-pier',
  'bridges',
  'other-roads',
  'town-place-labels',
];
const zoom8EnabledCategories = [
  ...zoom7EnabledCategories,
  'minor',
  'rail',
  'ferries',
  'airports',
];
const zoom9EnabledCategories = [
  ...zoom8EnabledCategories,
  'service',
  'residential',
  'commercial-industrial',
  'education-health',
  'leisure-culture',
  'pedestrian',
];
const zoom10EnabledCategories = [
  ...zoom9EnabledCategories,
  'paths-cycleways',
  'track',
  'transit',
];
const zoom11EnabledCategories = [
  ...zoom10EnabledCategories,
  'parking',
  'poi-transport',
  'poi-tourism-culture',
  'poi-accommodation',
];
const zoom12EnabledCategories = [
  ...zoom11EnabledCategories,
  'poi-food',
  'poi-shopping',
  'poi-health-education',
  'poi-public-sport',
  'park-label',
];
const zoom13EnabledCategories = [
  ...zoom12EnabledCategories,
  'building',
  'construction',
  'restricted-roads',
  'road-construction',
  'steps',
];
const zoom14EnabledCategories = [
  ...zoom13EnabledCategories,
  'street-furniture',
  'mountain',
  'aerialway',
];
const zoom15EnabledCategories = [
  ...zoom14EnabledCategories,
  'building-numbers',
  'housenumber',
];
const calibratedMapDetailEnabledCategories: Record<number, string[]> = {
  1: zoom1EnabledCategories,
  2: zoom1EnabledCategories,
  3: zoom3EnabledCategories,
  4: zoom4EnabledCategories,
  5: zoom5EnabledCategories,
  6: zoom6EnabledCategories,
  7: zoom7EnabledCategories,
  8: zoom8EnabledCategories,
  9: zoom9EnabledCategories,
  10: zoom10EnabledCategories,
  11: zoom11EnabledCategories,
  12: zoom12EnabledCategories,
  13: zoom13EnabledCategories,
  14: zoom14EnabledCategories,
  15: zoom15EnabledCategories,
  16: zoom15EnabledCategories,
  17: zoom15EnabledCategories,
  18: zoom15EnabledCategories,
};

const majorCities = [
  { id: 'london', name: 'London', coordinates: { lat: 51.5072, lng: -0.1276 } },
  { id: 'paris', name: 'Paris', coordinates: { lat: 48.8566, lng: 2.3522 } },
  { id: 'istanbul', name: 'Istanbul', coordinates: { lat: 41.0082, lng: 28.9784 } },
  { id: 'cairo', name: 'Cairo', coordinates: { lat: 30.0444, lng: 31.2357 } },
  { id: 'mumbai', name: 'Mumbai', coordinates: { lat: 19.076, lng: 72.8777 } },
  { id: 'bangkok', name: 'Bangkok', coordinates: { lat: 13.7563, lng: 100.5018 } },
  { id: 'tokyo', name: 'Tokyo', coordinates: { lat: 35.6762, lng: 139.6503 } },
  { id: 'sydney', name: 'Sydney', coordinates: { lat: -33.8688, lng: 151.2093 } },
  { id: 'los-angeles', name: 'Los Angeles', coordinates: { lat: 34.0522, lng: -118.2437 } },
  { id: 'mexico-city', name: 'Mexico City', coordinates: { lat: 19.4326, lng: -99.1332 } },
  { id: 'bogota', name: 'Bogota', coordinates: { lat: 4.711, lng: -74.0721 } },
  { id: 'buenos-aires', name: 'Buenos Aires', coordinates: { lat: -34.6037, lng: -58.3816 } },
  { id: 'cape-town', name: 'Cape Town', coordinates: { lat: -33.9249, lng: 18.4241 } },
  { id: 'nairobi', name: 'Nairobi', coordinates: { lat: -1.2921, lng: 36.8219 } },
  { id: 'madrid', name: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
  { id: 'rome', name: 'Rome', coordinates: { lat: 41.9028, lng: 12.4964 } },
  { id: 'athens', name: 'Athens', coordinates: { lat: 37.9838, lng: 23.7275 } },
  { id: 'dubai', name: 'Dubai', coordinates: { lat: 25.2048, lng: 55.2708 } },
  { id: 'delhi', name: 'Delhi', coordinates: { lat: 28.6139, lng: 77.209 } },
  { id: 'singapore', name: 'Singapore', coordinates: { lat: 1.3521, lng: 103.8198 } },
  { id: 'seoul', name: 'Seoul', coordinates: { lat: 37.5665, lng: 126.978 } },
  { id: 'auckland', name: 'Auckland', coordinates: { lat: -36.8509, lng: 174.7645 } },
  { id: 'vancouver', name: 'Vancouver', coordinates: { lat: 49.2827, lng: -123.1207 } },
  { id: 'new-york', name: 'New York', coordinates: { lat: 40.7128, lng: -74.006 } },
  { id: 'santiago', name: 'Santiago', coordinates: { lat: -33.4489, lng: -70.6693 } },
  { id: 'lima', name: 'Lima', coordinates: { lat: -12.0464, lng: -77.0428 } },
  { id: 'casablanca', name: 'Casablanca', coordinates: { lat: 33.5731, lng: -7.5898 } },
  { id: 'addis-ababa', name: 'Addis Ababa', coordinates: { lat: 8.9806, lng: 38.7578 } },
];

const destinationsSourceId = 'world-tour-destinations';
const routesSourceId = 'world-tour-routes';
const majorCitiesSourceId = 'world-tour-major-cities';
const destinationPointsLayerId = 'world-tour-destination-points';
const destinationLabelsLayerId = 'world-tour-destination-labels';
const routeLineLayerId = 'world-tour-routes-line';
const cityPointsLayerId = 'world-tour-city-points';
const cityLabelsLayerId = 'world-tour-city-labels';

const mapColorTokenFallbacks = {
  '--color-accent': '#d9467a',
  '--color-map-selected': '#f7f0d0',
  '--color-route-shipping': '#7ec8e3',
  '--color-text': '#f5efe3',
  '--color-text-rgb': '245 239 227',
  '--color-text-inverse': '#111814',
  '--color-text-inverse-rgb': '17 24 20',
};

function readCssToken(tokenName: keyof typeof mapColorTokenFallbacks) {
  if (typeof window === 'undefined') {
    return mapColorTokenFallbacks[tokenName];
  }

  return (
    window.getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim() ||
    mapColorTokenFallbacks[tokenName]
  );
}

function readCssRgbToken(tokenName: keyof typeof mapColorTokenFallbacks, alpha: number) {
  const rgbChannels = readCssToken(tokenName).split(/\s+/).join(', ');

  return `rgba(${rgbChannels}, ${alpha})`;
}

function getMapLayerColors() {
  return {
    accent: readCssToken('--color-accent'),
    selected: readCssToken('--color-map-selected'),
    shipping: readCssToken('--color-route-shipping'),
    text: readCssToken('--color-text'),
    textInverse: readCssToken('--color-text-inverse'),
    cityText: readCssRgbToken('--color-text-inverse-rgb', 0.82),
    cityHalo: readCssRgbToken('--color-text-rgb', 0.82),
  };
}

function emptyFeatureCollection<TGeometry extends Point | LineString, TProperties>(): FeatureCollection<
  TGeometry,
  TProperties
> {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function buildDestinationFeatures(
  destinations: Destination[],
  selectedDestinationId: string | null,
): FeatureCollection<Point, DestinationFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: destinations.map((destination, index) => ({
      type: 'Feature',
      id: destination.id,
      geometry: {
        type: 'Point',
        coordinates: [destination.coordinates.lng, destination.coordinates.lat],
      },
      properties: {
        id: destination.id,
        name: destination.name,
        order: index + 1,
        selected: destination.id === selectedDestinationId,
      },
    })),
  };
}

function buildMajorCityFeatures(): FeatureCollection<Point, CityFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: majorCities.map((city) => ({
      type: 'Feature',
      id: city.id,
      geometry: {
        type: 'Point',
        coordinates: [city.coordinates.lng, city.coordinates.lat],
      },
      properties: {
        id: city.id,
        name: city.name,
      },
    })),
  };
}

function findDestination(destinations: Destination[], destinationId: string) {
  return destinations.find((destination) => destination.id === destinationId);
}

function straightLineGeometry(origin: Destination, target: Destination): LineString {
  return {
    type: 'LineString',
    coordinates: [
      [origin.coordinates.lng, origin.coordinates.lat],
      [target.coordinates.lng, target.coordinates.lat],
    ],
  };
}

function hasUsableLineString(geometry: RouteLeg['geometry']): geometry is LineString {
  return geometry?.type === 'LineString' && geometry.coordinates.length >= 2;
}

function routeGeometryForLeg(destinations: Destination[], leg: RouteLeg): LineString | null {
  if (leg.type === 'driving-auto' && leg.status === 'ready' && hasUsableLineString(leg.geometry)) {
    return leg.geometry;
  }

  const origin = findDestination(destinations, leg.originDestinationId);
  const target = findDestination(destinations, leg.targetDestinationId);
  if (!origin || !target) return null;

  if (leg.type === 'shipping-manual') {
    return hasUsableLineString(leg.geometry) ? leg.geometry : straightLineGeometry(origin, target);
  }

  if (leg.status === 'failed') {
    return straightLineGeometry(origin, target);
  }

  return null;
}

function routeTypeForLeg(leg: RouteLeg): RouteFeatureProperties['type'] {
  return leg.status === 'failed' ? 'failed' : leg.type;
}

function buildRouteFeatures(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): FeatureCollection<LineString, RouteFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: routeLegs.flatMap((leg) => {
      const geometry = routeGeometryForLeg(destinations, leg);
      if (!geometry) return [];

      return [
        {
          type: 'Feature' as const,
          id: leg.id,
          geometry,
          properties: {
            id: leg.id,
            type: routeTypeForLeg(leg),
            status: leg.status,
          },
        },
      ];
    }),
  };
}

function getGeoJsonSource(map: maplibregl.Map, sourceId: string) {
  return map.getSource(sourceId) as GeoJsonSource | undefined;
}

function setSourceData(map: maplibregl.Map, sourceId: string, data: FeatureCollection) {
  getGeoJsonSource(map, sourceId)?.setData(data);
}

function layerMatchesPattern(layerId: string, patterns: string[]) {
  const normalizedLayerId = layerId.toLowerCase();

  return patterns.some((pattern) => normalizedLayerId.includes(pattern));
}

function clampDetailZoomStep(zoom: number) {
  return Math.min(maxDetailZoom, Math.max(minDetailZoom, Math.round(zoom)));
}

function createDefaultMapDetailSettings() {
  return Object.fromEntries(
    Array.from({ length: maxDetailZoom - minDetailZoom + 1 }, (_, index) => {
      const zoomStep = minDetailZoom + index;
      const calibratedEnabledCategories = calibratedMapDetailEnabledCategories[zoomStep];
      const calibratedEnabledCategorySet = calibratedEnabledCategories
        ? new Set(calibratedEnabledCategories)
        : null;

      return [
        zoomStep,
        Object.fromEntries(
          mapDetailCategories.map((category) => [
            category.id,
            calibratedEnabledCategorySet
              ? calibratedEnabledCategorySet.has(category.id)
              : category.defaultVisible,
          ]),
        ) as Record<string, boolean>,
      ];
    }),
  ) as Record<number, Record<string, boolean>>;
}

function sourceLayerForLayer(layer: maplibregl.LayerSpecification) {
  return 'source-layer' in layer ? layer['source-layer'] : undefined;
}

function layerMatchesCategory(layer: maplibregl.LayerSpecification, category: MapDetailCategory) {
  const sourceLayer = sourceLayerForLayer(layer);
  const matchesSourceLayer = sourceLayer
    ? category.sourceLayers?.includes(sourceLayer) ?? false
    : false;
  const matchesLayerId = category.idPatterns
    ? layerMatchesPattern(layer.id, category.idPatterns)
    : false;

  return matchesSourceLayer || matchesLayerId;
}

function findMapDetailCategory(layer: maplibregl.LayerSpecification) {
  return mapDetailCategories.find((category) => layerMatchesCategory(layer, category));
}

function applyMapDetailSettings(map: maplibregl.Map, settings: Record<string, boolean>) {
  const layers = map.getStyle()?.layers ?? [];

  for (const layer of layers) {
    const category = findMapDetailCategory(layer);
    if (!category) continue;

    map.setLayoutProperty(
      layer.id,
      'visibility',
      settings[category.id] ? 'visible' : 'none',
    );
  }
}

function calmBasemapStyle(map: maplibregl.Map) {
  const layers = map.getStyle()?.layers ?? [];

  for (const layer of layers) {
    if (layerMatchesPattern(layer.id, hiddenBasemapLayerPatterns)) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
      continue;
    }

    if (layer.type === 'line' && layerMatchesPattern(layer.id, softenedLineLayerPatterns)) {
      map.setPaintProperty(layer.id, 'line-opacity', 0.32);
    }
  }
}

export function MapCanvas({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latestDestinationsRef = useRef(destinations);
  const latestRouteLegsRef = useRef(routeLegs);
  const latestSelectedDestinationIdRef = useRef(selectedDestinationId);
  const onSelectDestinationRef = useRef(onSelectDestination);
  const previousDestinationCountRef = useRef(0);
  const [selectedZoomStep, setSelectedZoomStep] = useState(1);
  const [currentMapZoom, setCurrentMapZoom] = useState(1.4);
  const [mapDetailSettings, setMapDetailSettings] = useState(createDefaultMapDetailSettings);
  const selectedZoomStepRef = useRef(selectedZoomStep);
  const mapDetailSettingsRef = useRef(mapDetailSettings);

  const applyCurrentMapDetailSettings = useCallback(() => {
    const map = mapRef.current;
    if (!map || !showMapDetailDevTools) return;

    applyMapDetailSettings(
      map,
      mapDetailSettingsRef.current[selectedZoomStepRef.current],
    );
  }, []);

  useEffect(() => {
    selectedZoomStepRef.current = selectedZoomStep;
    mapDetailSettingsRef.current = mapDetailSettings;
    applyCurrentMapDetailSettings();
  }, [applyCurrentMapDetailSettings, mapDetailSettings, selectedZoomStep]);

  const updateMapSources = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    setSourceData(
      map,
      destinationsSourceId,
      buildDestinationFeatures(
        latestDestinationsRef.current,
        latestSelectedDestinationIdRef.current,
      ),
    );
    setSourceData(
      map,
      routesSourceId,
      buildRouteFeatures(latestDestinationsRef.current, latestRouteLegsRef.current),
    );
    setSourceData(map, majorCitiesSourceId, buildMajorCityFeatures());
  }, []);

  const fitMapToDestinations = useCallback((nextDestinations: Destination[]) => {
    const map = mapRef.current;
    if (!map || nextDestinations.length < 2) return;

    const lngs = nextDestinations.map((destination) => destination.coordinates.lng);
    const lats = nextDestinations.map((destination) => destination.coordinates.lat);

    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: 92,
        maxZoom: 6,
        duration: 700,
      },
    );
  }, []);

  useEffect(() => {
    const previousDestinationCount = previousDestinationCountRef.current;
    latestDestinationsRef.current = destinations;
    latestRouteLegsRef.current = routeLegs;
    latestSelectedDestinationIdRef.current = selectedDestinationId;
    onSelectDestinationRef.current = onSelectDestination;
    updateMapSources();

    if (destinations.length > previousDestinationCount) {
      fitMapToDestinations(destinations);
    }
    if (mapRef.current) {
      previousDestinationCountRef.current = destinations.length;
    }
  }, [
    destinations,
    routeLegs,
    selectedDestinationId,
    onSelectDestination,
    fitMapToDestinations,
    updateMapSources,
  ]);

  const addMapLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const mapColors = getMapLayerColors();

    if (!map.getSource(destinationsSourceId)) {
      map.addSource(destinationsSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<Point, DestinationFeatureProperties>(),
      });
    }

    if (!map.getSource(routesSourceId)) {
      map.addSource(routesSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<LineString, RouteFeatureProperties>(),
      });
    }

    if (!map.getSource(majorCitiesSourceId)) {
      map.addSource(majorCitiesSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<Point, CityFeatureProperties>(),
      });
    }

    if (!map.getLayer(routeLineLayerId)) {
      map.addLayer({
        id: routeLineLayerId,
        type: 'line',
        source: routesSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': [
            'match',
            ['get', 'type'],
            'shipping-manual',
            mapColors.shipping,
            'failed',
            mapColors.text,
            mapColors.accent,
          ],
          'line-dasharray': [
            'match',
            ['get', 'type'],
            'shipping-manual',
            ['literal', [2, 2]],
            'failed',
            ['literal', [1, 2]],
            ['literal', [1, 0]],
          ],
          'line-opacity': ['case', ['==', ['get', 'type'], 'failed'], 0.72, 0.92],
          'line-width': 4,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(destinationPointsLayerId)) {
      map.addLayer({
        id: destinationPointsLayerId,
        type: 'circle',
        source: destinationsSourceId,
        paint: {
          'circle-color': ['case', ['get', 'selected'], mapColors.selected, mapColors.accent],
          'circle-radius': ['case', ['get', 'selected'], 9, 7],
          'circle-stroke-color': mapColors.textInverse,
          'circle-stroke-width': 2,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(destinationLabelsLayerId)) {
      map.addLayer({
        id: destinationLabelsLayerId,
        type: 'symbol',
        source: destinationsSourceId,
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'order']], '. ', ['get', 'name']],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.25],
          'text-size': 12,
        },
        paint: {
          'text-color': mapColors.textInverse,
          'text-halo-color': mapColors.text,
          'text-halo-width': 1.5,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(cityPointsLayerId)) {
      map.addLayer({
        id: cityPointsLayerId,
        type: 'circle',
        source: majorCitiesSourceId,
        minzoom: majorCityMinZoom,
        paint: {
          'circle-color': mapColors.selected,
          'circle-radius': 3,
          'circle-stroke-color': mapColors.textInverse,
          'circle-stroke-width': 1,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(cityLabelsLayerId)) {
      map.addLayer({
        id: cityLabelsLayerId,
        type: 'symbol',
        source: majorCitiesSourceId,
        minzoom: majorCityMinZoom,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-offset': [0.7, 0],
          'text-size': 11,
          'text-anchor': 'left',
        },
        paint: {
          'text-color': mapColors.cityText,
          'text-halo-color': mapColors.cityHalo,
          'text-halo-width': 1.2,
        },
      } as maplibregl.LayerSpecification);
    }

    updateMapSources();
    fitMapToDestinations(latestDestinationsRef.current);
    previousDestinationCountRef.current = latestDestinationsRef.current.length;
  }, [fitMapToDestinations, updateMapSources]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: [18, 24],
      zoom: 1.4,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const handleLoad = () => {
      if (showMapDetailDevTools) {
        applyCurrentMapDetailSettings();
      } else {
        calmBasemapStyle(map);
      }
      addMapLayers();
    };
    const handleZoomEnd = () => {
      const nextZoom = map.getZoom();
      setCurrentMapZoom(nextZoom);
      setSelectedZoomStep(clampDetailZoomStep(nextZoom));
    };
    const handleDestinationClick = (event: maplibregl.MapLayerMouseEvent) => {
      const destinationId = event.features?.[0]?.properties?.id;

      if (typeof destinationId === 'string') {
        onSelectDestinationRef.current(destinationId);
      }
    };
    const handleDestinationMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const handleDestinationMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('load', handleLoad);
    map.on('zoomend', handleZoomEnd);
    map.on('click', destinationPointsLayerId, handleDestinationClick);
    map.on('mouseenter', destinationPointsLayerId, handleDestinationMouseEnter);
    map.on('mouseleave', destinationPointsLayerId, handleDestinationMouseLeave);

    mapRef.current = map;

    return () => {
      map.off('load', handleLoad);
      map.off('zoomend', handleZoomEnd);
      map.off('click', destinationPointsLayerId, handleDestinationClick);
      map.off('mouseenter', destinationPointsLayerId, handleDestinationMouseEnter);
      map.off('mouseleave', destinationPointsLayerId, handleDestinationMouseLeave);
      map.remove();
      mapRef.current = null;
    };
  }, [addMapLayers, applyCurrentMapDetailSettings]);

  const selectedZoomSettings = mapDetailSettings[selectedZoomStep];
  const visibleDetailCount = mapDetailCategories.filter(
    (category) => selectedZoomSettings[category.id],
  ).length;
  const hiddenDetailCount = mapDetailCategories.length - visibleDetailCount;

  const setZoomStep = (nextZoom: number) => {
    const nextZoomStep = clampDetailZoomStep(nextZoom);
    setSelectedZoomStep(nextZoomStep);
    setCurrentMapZoom(nextZoomStep);
    mapRef.current?.jumpTo({ zoom: nextZoomStep });
  };

  const handleZoomStepChange = (event: ChangeEvent<HTMLInputElement>) => {
    setZoomStep(Number(event.currentTarget.value));
  };

  const handleDetailCategoryChange = (categoryId: string, enabled: boolean) => {
    setMapDetailSettings((currentSettings) => ({
      ...currentSettings,
      [selectedZoomStep]: {
        ...currentSettings[selectedZoomStep],
        [categoryId]: enabled,
      },
    }));
  };

  return (
    <section className="map-canvas" aria-label="Interactive world tour map">
      <div ref={mapContainerRef} className="maplibre-container" data-testid="map-container" />
      {destinations.length === 0 ? <div className="map-empty-label">Blank planning map</div> : null}
      {showMapDetailDevTools ? (
        <section className="map-detail-dev-panel" role="group" aria-label="Map detail by zoom">
          <div className="map-detail-dev-panel__header">
            <h2>Map detail by zoom</h2>
            <span>Current map zoom: {currentMapZoom.toFixed(1)}</span>
          </div>
          <div className="map-detail-dev-panel__zoom">
            <span id="map-detail-zoom-step-label">Zoom step</span>
            <strong>z{selectedZoomStep}</strong>
            <div className="map-detail-dev-panel__zoom-controls">
              <button
                type="button"
                aria-label="Decrease zoom step"
                disabled={selectedZoomStep <= minDetailZoom}
                onClick={() => setZoomStep(selectedZoomStep - 1)}
              >
                -
              </button>
              <input
                type="range"
                min={minDetailZoom}
                max={maxDetailZoom}
                step={1}
                value={selectedZoomStep}
                aria-labelledby="map-detail-zoom-step-label"
                onChange={handleZoomStepChange}
              />
              <button
                type="button"
                aria-label="Increase zoom step"
                disabled={selectedZoomStep >= maxDetailZoom}
                onClick={() => setZoomStep(selectedZoomStep + 1)}
              >
                +
              </button>
            </div>
          </div>
          <div className="map-detail-dev-panel__summary">
            {visibleDetailCount} on / {hiddenDetailCount} off at zoom {selectedZoomStep}
          </div>
          <div className="map-detail-dev-panel__groups">
            {mapDetailGroups.map((group) => (
              <div key={group} className="map-detail-dev-panel__group">
                <h3>{group}</h3>
                {mapDetailCategories
                  .filter((category) => category.group === group)
                  .map((category) => (
                    <label key={category.id} className="map-detail-dev-panel__option">
                      <input
                        type="checkbox"
                        checked={selectedZoomSettings[category.id]}
                        onChange={(event) =>
                          handleDetailCategoryChange(category.id, event.currentTarget.checked)
                        }
                      />
                      <span>{category.label}</span>
                    </label>
                  ))}
              </div>
            ))}
          </div>
          <details className="map-detail-dev-panel__config">
            <summary>Config JSON</summary>
            <pre aria-label="Map detail settings JSON">
              {JSON.stringify(mapDetailSettings, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}
      <div className="map-accessible-destination-list" aria-label="Destination pins">
        {destinations.map((destination) => (
          <button
            key={destination.id}
            type="button"
            className={destination.id === selectedDestinationId ? 'is-selected' : ''}
            aria-label={`Select ${destination.name}`}
            onClick={() => onSelectDestinationRef.current(destination.id)}
          />
        ))}
      </div>
    </section>
  );
}
