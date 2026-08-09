import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Activity, Coordinates, Destination, RouteLeg } from '../domain/types';
import { calmBasemapStyle, mapLabelFontStack, mapStyleUrl, readMapLayerColors } from '../map/mapPresentation';
import { clampOverlayPosition, type OverlayPoint } from '../map/overlayGeometry';
import {
  buildStopPillPresentations,
  positionStopPillPresentations,
  stopPillCollisionBounds,
  stopPillClassName,
  type StopPillPresentation,
} from '../map/stopPillPresentation';
import { buildRenderableRouteFeatures } from '../map/tripRouteFeatures';
import type { RouteFeatureProperties } from '../map/tripRouteFeatures';
import { formatStopMarker } from './stopLabels';

export type MapAddStopRequest = {
  coordinates: Coordinates;
  screenPosition: {
    x: number;
    y: number;
  };
  source: 'context-menu' | 'long-press';
};

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  focusedActivities?: Activity[];
  selectedActivityId?: string | null;
  onSelectDestination: (destinationId: string) => void;
  onSelectActivity?: (activityId: string) => void;
  onRequestAddStop?: (request: MapAddStopRequest) => void;
};

type DestinationFeatureProperties = {
  id: string;
  name: string;
  order: number;
  label: string;
  selected: boolean;
};

type ActivityFeatureProperties = {
  id: string;
  title: string;
  order: number;
  selected: boolean;
};

type CityFeatureProperties = {
  id: string;
  name: string;
};

type ProjectedDestinationLabel = StopPillPresentation;

type ProjectedActivityLabel = {
  id: string;
  title: string;
  selected: boolean;
  position: LabelPosition;
  x: number;
  y: number;
};

type LabelPosition = 'below' | 'above';

type LabelBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type ActivityLabelCandidate = ProjectedActivityLabel & {
  order: number;
  bounds: LabelBounds;
};

type ActivityLabelCandidateGroup = {
  order: number;
  selected: boolean;
  placements: ActivityLabelCandidate[];
};

type MapViewport = {
  center: [number, number];
  zoom: number;
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

const missingMapTilerSpriteIds = new Set(['road_', ' ']);
const shouldRenderFallbackMajorCities = !import.meta.env.VITE_MAPTILER_API_KEY;
const majorCityMinZoom = 5;
const destinationLabelMinZoom = 4;
const showMapDetailDevTools = import.meta.env.VITE_ENABLE_MAP_DETAIL_DEV_TOOLS === 'true';
const minDetailZoom = 1;
const maxDetailZoom = 18;
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

function createTransparentPlaceholderImage() {
  return {
    width: 1,
    height: 1,
    data: new Uint8Array(4),
  };
}
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

const destinationsSourceId = 'plotter-destinations';
const focusedActivitiesSourceId = 'plotter-focused-activities';
const routesSourceId = 'plotter-routes';
const majorCitiesSourceId = 'plotter-major-cities';
const selectedDestinationHaloLayerId = 'plotter-selected-destination-halo';
const activityPointsLayerId = 'plotter-activity-points';
const selectedActivityHaloLayerId = 'plotter-selected-activity-halo';
const destinationPointsLayerId = 'plotter-destination-points';
const routeLineLayerId = 'plotter-routes-line';
const cityPointsLayerId = 'plotter-city-points';
const cityLabelsLayerId = 'plotter-city-labels';
const addStopMenuApproxSize = {
  width: 180,
  height: 112,
};
const stopFocusPreferredPadding = {
  top: 96,
  right: 760,
  bottom: 96,
  left: 96,
};
const stopFocusMinimumViewportPx = 48;
const stopFocusMaxZoom = 13;
const mapViewportTransitionMs = 700;
const defaultFocusedActivities: Activity[] = [];
const activityLabelMaxWidthPx = 190;
const activityLabelHeightPx = 24;
const activityLabelVerticalOffsetPx = 14;
const activityLabelCollisionPaddingPx = 6;
const activityLabelApproxCharacterWidthPx = 7.2;
const activityLabelHorizontalChromePx = 18;

function clampPaddingPair(leading: number, trailing: number, viewportSize: number): [number, number] {
  if (!Number.isFinite(viewportSize) || viewportSize <= 0) {
    return [leading, trailing];
  }

  const preferredTotal = leading + trailing;
  const maxTotal = Math.max(0, Math.floor(viewportSize - stopFocusMinimumViewportPx));
  if (preferredTotal <= maxTotal) {
    return [leading, trailing];
  }

  const scale = maxTotal / preferredTotal;
  const nextLeading = Math.floor(leading * scale);
  return [nextLeading, maxTotal - nextLeading];
}

function stopFocusPaddingForMap(map: Pick<maplibregl.Map, 'getContainer'>) {
  const container = map.getContainer();
  const bounds = container.getBoundingClientRect();
  const width = container.clientWidth || bounds.width;
  const height = container.clientHeight || bounds.height;
  const [left, right] = clampPaddingPair(stopFocusPreferredPadding.left, stopFocusPreferredPadding.right, width);
  const [top, bottom] = clampPaddingPair(stopFocusPreferredPadding.top, stopFocusPreferredPadding.bottom, height);

  return { top, right, bottom, left };
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
        label: formatStopMarker(index + 1, destinations.length),
        selected: destination.id === selectedDestinationId,
      },
    })),
  };
}

function buildFocusedActivityFeatures(
  selectedDestinationId: string | null,
  focusedActivities: Activity[],
  selectedActivityId: string | null,
): FeatureCollection<Point, ActivityFeatureProperties> {
  if (!selectedDestinationId) {
    return emptyFeatureCollection<Point, ActivityFeatureProperties>();
  }

  return {
    type: 'FeatureCollection',
    features: focusedActivities.flatMap((activity, index) => {
      if (activity.destinationId !== selectedDestinationId) return [];

      const coordinates = activity.location?.coordinates;
      if (!coordinates) return [];

      return [
        {
          type: 'Feature' as const,
          id: activity.id,
          geometry: {
            type: 'Point' as const,
            coordinates: [coordinates.lng, coordinates.lat],
          },
          properties: {
            id: activity.id,
            title: activity.title,
            order: index + 1,
            selected: activity.id === selectedActivityId,
          },
        },
      ];
    }),
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

function estimateActivityLabelWidth(title: string) {
  return Math.min(
    activityLabelMaxWidthPx,
    Math.max(activityLabelHeightPx, title.length * activityLabelApproxCharacterWidthPx + activityLabelHorizontalChromePx),
  );
}

function renderedLabelBounds(input: { title: string; x: number; y: number }, position: LabelPosition) {
  const width = estimateActivityLabelWidth(input.title);
  const left = input.x - width / 2;
  const top =
    position === 'above'
      ? input.y - activityLabelVerticalOffsetPx - activityLabelHeightPx
      : input.y + activityLabelVerticalOffsetPx;

  return {
    left,
    right: left + width,
    top,
    bottom: top + activityLabelHeightPx,
  };
}

function labelCandidateBounds(input: { title: string; x: number; y: number }, position: LabelPosition) {
  const renderedBounds = renderedLabelBounds(input, position);

  return {
    left: renderedBounds.left - activityLabelCollisionPaddingPx,
    right: renderedBounds.right + activityLabelCollisionPaddingPx,
    top: renderedBounds.top - activityLabelCollisionPaddingPx,
    bottom: renderedBounds.bottom + activityLabelCollisionPaddingPx,
  };
}

function activityLabelBoundsOverlap(left: LabelBounds, right: LabelBounds) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function visibleActivityLabels(
  candidateGroups: ActivityLabelCandidateGroup[],
  reservedBounds: LabelBounds[],
): ProjectedActivityLabel[] {
  const occupiedBounds = [...reservedBounds];
  const visibleCandidates: ActivityLabelCandidate[] = [];

  const prioritizedCandidates = [...candidateGroups].sort((left, right) => {
    if (left.selected !== right.selected) return left.selected ? -1 : 1;
    return left.order - right.order;
  });

  for (const candidateGroup of prioritizedCandidates) {
    const visiblePlacement = candidateGroup.placements.find(
      (placement) => !occupiedBounds.some((bounds) => activityLabelBoundsOverlap(placement.bounds, bounds)),
    );
    if (!visiblePlacement) continue;

    visibleCandidates.push(visiblePlacement);
    occupiedBounds.push(visiblePlacement.bounds);
  }

  return visibleCandidates
    .sort((left, right) => left.order - right.order)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      selected: candidate.selected,
      position: candidate.position,
      x: candidate.x,
      y: candidate.y,
    }));
}

function selectedDestinationForFocus(
  destinations: Destination[],
  selectedDestinationId: string | null,
) {
  return selectedDestinationId
    ? destinations.find((candidate) => candidate.id === selectedDestinationId) ?? null
    : null;
}

function getGeoJsonSource(map: maplibregl.Map, sourceId: string) {
  return map.getSource(sourceId) as GeoJsonSource | undefined;
}

function setSourceData(map: maplibregl.Map, sourceId: string, data: FeatureCollection) {
  getGeoJsonSource(map, sourceId)?.setData(data);
}

function mapViewport(map: maplibregl.Map): MapViewport {
  const center = map.getCenter();

  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
  };
}

function focusedCoordinatesForDestination(destination: Destination, focusedActivities: Activity[]): Coordinates[] {
  return [
    destination.coordinates,
    ...focusedActivities.flatMap((activity) =>
      activity.destinationId === destination.id && activity.location?.coordinates
        ? [activity.location.coordinates]
        : [],
    ),
  ];
}

function coordinateKey(coordinates: Coordinates) {
  return `${coordinates.lng},${coordinates.lat}`;
}

function stopFocusKeyForDestination(destination: Destination, focusedActivities: Activity[]) {
  const activityCoordinateKeys = Array.from(
    new Set(
      focusedActivities.flatMap((activity) =>
        activity.destinationId === destination.id && activity.location?.coordinates
          ? [coordinateKey(activity.location.coordinates)]
          : [],
      ),
    ),
  ).sort();

  return [
    destination.id,
    coordinateKey(destination.coordinates),
    ...activityCoordinateKeys,
  ].join('|');
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

export function MapCanvas({
  destinations,
  routeLegs,
  selectedDestinationId,
  focusedActivities = defaultFocusedActivities,
  selectedActivityId = null,
  onSelectDestination,
  onSelectActivity,
  onRequestAddStop,
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latestDestinationsRef = useRef(destinations);
  const latestRouteLegsRef = useRef(routeLegs);
  const latestFocusedActivitiesRef = useRef(focusedActivities);
  const latestSelectedActivityIdRef = useRef(selectedActivityId);
  const latestSelectedDestinationIdRef = useRef(selectedDestinationId);
  const onSelectDestinationRef = useRef(onSelectDestination);
  const onSelectActivityRef = useRef(onSelectActivity);
  const onRequestAddStopRef = useRef(onRequestAddStop);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{
    pointerId: number;
    screenX: number;
    screenY: number;
    mapX: number;
    mapY: number;
  } | null>(null);
  const previousDestinationCountRef = useRef(0);
  const previousSelectedDestinationIdRef = useRef(selectedDestinationId);
  const routeViewportBeforeFocusRef = useRef<MapViewport | null>(null);
  const appliedStopFocusKeyRef = useRef<string | null>(null);
  const [selectedZoomStep, setSelectedZoomStep] = useState(1);
  const [currentMapZoom, setCurrentMapZoom] = useState(1.4);
  const [mapDetailSettings, setMapDetailSettings] = useState(createDefaultMapDetailSettings);
  const [projectedDestinationLabels, setProjectedDestinationLabels] = useState<ProjectedDestinationLabel[]>([]);
  const [projectedActivityLabels, setProjectedActivityLabels] = useState<ProjectedActivityLabel[]>([]);
  const [addStopMenu, setAddStopMenu] = useState<MapAddStopRequest | null>(null);
  const [addStopMenuPosition, setAddStopMenuPosition] = useState<OverlayPoint | null>(null);
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

  const projectDestinationLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return [];

    return positionStopPillPresentations(
      buildStopPillPresentations({
        destinations: latestDestinationsRef.current,
        selectedDestinationId: latestSelectedDestinationIdRef.current,
        project: (coordinates) => map.project(coordinates),
      }),
    );
  }, []);

  const updateDestinationLabelPositions = useCallback(() => {
    setProjectedDestinationLabels(projectDestinationLabels());
  }, [projectDestinationLabels]);

  const updateActivityLabelPositions = useCallback(() => {
    const map = mapRef.current;
    const selectedDestinationId = latestSelectedDestinationIdRef.current;
    if (!map || !selectedDestinationId) {
      setProjectedActivityLabels([]);
      return;
    }

    const reservedDestinationLabelBounds = projectDestinationLabels().map(stopPillCollisionBounds);

    setProjectedActivityLabels(
      visibleActivityLabels(
        latestFocusedActivitiesRef.current.flatMap((activity, index) => {
          if (activity.destinationId !== selectedDestinationId) return [];

          const coordinates = activity.location?.coordinates;
          if (!coordinates) return [];

          const point = map.project([coordinates.lng, coordinates.lat]);
          const label = {
            id: activity.id,
            title: activity.title,
            selected: activity.id === latestSelectedActivityIdRef.current,
            x: point.x,
            y: point.y,
          };

          return [
            {
              order: index,
              selected: label.selected,
              placements: (['below', 'above'] satisfies LabelPosition[]).map((position) => ({
                ...label,
                position,
                order: index,
                bounds: labelCandidateBounds(label, position),
              })),
            },
          ];
        }),
        reservedDestinationLabelBounds,
      ),
    );
  }, [projectDestinationLabels]);

  const updateMapLabelPositions = useCallback(() => {
    updateDestinationLabelPositions();
    updateActivityLabelPositions();
  }, [updateActivityLabelPositions, updateDestinationLabelPositions]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current === null) return;

    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const closeAddStopMenu = useCallback(() => {
    setAddStopMenu(null);
    setAddStopMenuPosition(null);
  }, []);

  const requestAddStop = useCallback((request: MapAddStopRequest) => {
    setAddStopMenu(null);
    setAddStopMenuPosition(null);
    onRequestAddStopRef.current?.(request);
  }, []);

  const openAddStopMenu = useCallback((request: MapAddStopRequest) => {
    const containerRect = mapContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setAddStopMenu(request);
    setAddStopMenuPosition(clampOverlayPosition(
      request.screenPosition,
      addStopMenuApproxSize,
      { width: containerRect.width, height: containerRect.height },
    ));
  }, []);

  const openAddStopMenuAtClientPoint = useCallback(
    (container: HTMLDivElement, clientX: number, clientY: number) => {
      const map = mapRef.current;
      if (!map || !onRequestAddStopRef.current) return false;

      const containerRect = container.getBoundingClientRect();
      const mapX = clientX - containerRect.left;
      const mapY = clientY - containerRect.top;
      const coordinates = map.unproject([mapX, mapY]);

      openAddStopMenu({
        coordinates: { lat: coordinates.lat, lng: coordinates.lng },
        screenPosition: { x: mapX, y: mapY },
        source: 'context-menu',
      });

      return true;
    },
    [openAddStopMenu],
  );

  const handleMapContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!openAddStopMenuAtClientPoint(event.currentTarget, event.clientX, event.clientY)) return;

      event.preventDefault();
    },
    [openAddStopMenuAtClientPoint],
  );

  const handleMapPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || event.button !== 2) return;
      if (!openAddStopMenuAtClientPoint(event.currentTarget, event.clientX, event.clientY)) return;

      event.preventDefault();
    },
    [openAddStopMenuAtClientPoint],
  );

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
      focusedActivitiesSourceId,
      buildFocusedActivityFeatures(
        latestSelectedDestinationIdRef.current,
        latestFocusedActivitiesRef.current,
        latestSelectedActivityIdRef.current,
      ),
    );
    setSourceData(
      map,
      routesSourceId,
      buildRenderableRouteFeatures(latestDestinationsRef.current, latestRouteLegsRef.current),
    );
    if (shouldRenderFallbackMajorCities) {
      setSourceData(map, majorCitiesSourceId, buildMajorCityFeatures());
    }
    updateMapLabelPositions();
  }, [updateMapLabelPositions]);

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

  const fitMapToStopFocus = useCallback((destination: Destination, activities: Activity[]) => {
    const map = mapRef.current;
    if (!map) return;

    const coordinates = focusedCoordinatesForDestination(destination, activities);
    const lngs = coordinates.map((coordinate) => coordinate.lng);
    const lats = coordinates.map((coordinate) => coordinate.lat);

    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: stopFocusPaddingForMap(map),
        maxZoom: stopFocusMaxZoom,
        duration: mapViewportTransitionMs,
      },
    );
  }, []);

  const syncStopFocusViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const selectedDestination = selectedDestinationForFocus(
      latestDestinationsRef.current,
      latestSelectedDestinationIdRef.current,
    );
    const nextStopFocusKey = selectedDestination
      ? stopFocusKeyForDestination(selectedDestination, latestFocusedActivitiesRef.current)
      : null;

    if (selectedDestination && nextStopFocusKey) {
      if (!appliedStopFocusKeyRef.current && !routeViewportBeforeFocusRef.current) {
        if (previousSelectedDestinationIdRef.current === null) {
          routeViewportBeforeFocusRef.current = mapViewport(map);
        }
      }
      if (appliedStopFocusKeyRef.current !== nextStopFocusKey) {
        fitMapToStopFocus(selectedDestination, latestFocusedActivitiesRef.current);
        appliedStopFocusKeyRef.current = nextStopFocusKey;
      }
      return;
    }

    if (appliedStopFocusKeyRef.current) {
      if (routeViewportBeforeFocusRef.current) {
        map.easeTo({
          center: routeViewportBeforeFocusRef.current.center,
          zoom: routeViewportBeforeFocusRef.current.zoom,
          duration: mapViewportTransitionMs,
        });
      } else {
        fitMapToDestinations(latestDestinationsRef.current);
      }
    }

    routeViewportBeforeFocusRef.current = null;
    appliedStopFocusKeyRef.current = null;
  }, [fitMapToDestinations, fitMapToStopFocus]);

  useEffect(() => {
    const previousDestinationCount = previousDestinationCountRef.current;
    latestDestinationsRef.current = destinations;
    latestRouteLegsRef.current = routeLegs;
    latestFocusedActivitiesRef.current = focusedActivities;
    latestSelectedActivityIdRef.current = selectedActivityId;
    latestSelectedDestinationIdRef.current = selectedDestinationId;
    onSelectDestinationRef.current = onSelectDestination;
    onSelectActivityRef.current = onSelectActivity;
    onRequestAddStopRef.current = onRequestAddStop;
    updateMapSources();

    const selectedDestination = selectedDestinationForFocus(destinations, selectedDestinationId);
    if (!selectedDestination && destinations.length > previousDestinationCount) {
      fitMapToDestinations(destinations);
    }
    syncStopFocusViewport();
    if (mapRef.current) {
      previousDestinationCountRef.current = destinations.length;
    }
    previousSelectedDestinationIdRef.current = selectedDestinationId;
  }, [
    destinations,
    routeLegs,
    selectedDestinationId,
    focusedActivities,
    selectedActivityId,
    onSelectDestination,
    onSelectActivity,
    onRequestAddStop,
    fitMapToDestinations,
    syncStopFocusViewport,
    updateMapSources,
  ]);

  const addMapLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const mapColors = readMapLayerColors();

    if (!map.getSource(destinationsSourceId)) {
      map.addSource(destinationsSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<Point, DestinationFeatureProperties>(),
      });
    }

    if (!map.getSource(focusedActivitiesSourceId)) {
      map.addSource(focusedActivitiesSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<Point, ActivityFeatureProperties>(),
      });
    }

    if (!map.getSource(routesSourceId)) {
      map.addSource(routesSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<LineString, RouteFeatureProperties>(),
      });
    }

    if (shouldRenderFallbackMajorCities && !map.getSource(majorCitiesSourceId)) {
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
            ['get', 'kind'],
            'ferry',
            mapColors.shipping,
            'manual',
            mapColors.shipping,
            'failed',
            mapColors.text,
            [
              'match',
              ['get', 'status'],
              'review-required',
              mapColors.text,
              mapColors.accent,
            ],
          ],
          'line-dasharray': [
            'match',
            ['get', 'type'],
            'manual',
            ['literal', [2, 2]],
            'failed',
            ['literal', [1, 2]],
            [
              'match',
              ['get', 'status'],
              'review-required',
              ['literal', [3, 1]],
              ['literal', [1, 0]],
            ],
          ],
          'line-opacity': [
            'match',
            ['get', 'status'],
            'failed',
            0.72,
            'review-required',
            0.86,
            0.92,
          ],
          'line-width': 4,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(selectedDestinationHaloLayerId)) {
      map.addLayer({
        id: selectedDestinationHaloLayerId,
        type: 'circle',
        source: destinationsSourceId,
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-color': mapColors.accentHalo,
          'circle-radius': 16,
          'circle-stroke-color': mapColors.accent,
          'circle-stroke-opacity': 0.34,
          'circle-stroke-width': 1,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(selectedActivityHaloLayerId)) {
      map.addLayer({
        id: selectedActivityHaloLayerId,
        type: 'circle',
        source: focusedActivitiesSourceId,
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-color': mapColors.accentHalo,
          'circle-radius': 16,
          'circle-stroke-color': mapColors.accent,
          'circle-stroke-opacity': 0.34,
          'circle-stroke-width': 1,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(activityPointsLayerId)) {
      map.addLayer({
        id: activityPointsLayerId,
        type: 'circle',
        source: focusedActivitiesSourceId,
        paint: {
          'circle-color': mapColors.accent,
          'circle-radius': ['case', ['get', 'selected'], 8, 7],
          'circle-stroke-color': mapColors.textInverse,
          'circle-stroke-width': 2,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(destinationPointsLayerId)) {
      map.addLayer({
        id: destinationPointsLayerId,
        type: 'circle',
        source: destinationsSourceId,
        paint: {
          'circle-color': mapColors.accent,
          'circle-radius': ['case', ['get', 'selected'], 8, 7],
          'circle-stroke-color': mapColors.textInverse,
          'circle-stroke-width': 2,
        },
      } as maplibregl.LayerSpecification);
    }

    if (shouldRenderFallbackMajorCities && !map.getLayer(cityPointsLayerId)) {
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

    if (shouldRenderFallbackMajorCities && !map.getLayer(cityLabelsLayerId)) {
      map.addLayer({
        id: cityLabelsLayerId,
        type: 'symbol',
        source: majorCitiesSourceId,
        minzoom: majorCityMinZoom,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': mapLabelFontStack,
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
    updateMapLabelPositions();
    if (!selectedDestinationForFocus(latestDestinationsRef.current, latestSelectedDestinationIdRef.current)) {
      fitMapToDestinations(latestDestinationsRef.current);
    }
    syncStopFocusViewport();
    previousDestinationCountRef.current = latestDestinationsRef.current.length;
  }, [fitMapToDestinations, syncStopFocusViewport, updateMapLabelPositions, updateMapSources]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyleUrl,
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
      updateMapLabelPositions();
    };
    const handleMapMove = () => {
      updateMapLabelPositions();
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
    const handleActivityClick = (event: maplibregl.MapLayerMouseEvent) => {
      const activityId = event.features?.[0]?.properties?.id;

      if (typeof activityId === 'string') {
        onSelectActivityRef.current?.(activityId);
      }
    };
    const handleActivityMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const handleActivityMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };
    const handleContextMenu = (event: maplibregl.MapMouseEvent) => {
      if (!onRequestAddStopRef.current) return;

      event.preventDefault();
      openAddStopMenu({
        coordinates: { lat: event.lngLat.lat, lng: event.lngLat.lng },
        screenPosition: { x: event.point.x, y: event.point.y },
        source: 'context-menu',
      });
    };
    const handleStyleImageMissing = (event: maplibregl.MapStyleImageMissingEvent) => {
      if (!missingMapTilerSpriteIds.has(event.id) || map.hasImage(event.id)) return;

      map.addImage(event.id, createTransparentPlaceholderImage());
    };

    map.on('load', handleLoad);
    map.on('move', handleMapMove);
    map.on('zoom', handleMapMove);
    map.on('resize', handleMapMove);
    map.on('zoomend', handleZoomEnd);
    map.on('click', destinationPointsLayerId, handleDestinationClick);
    map.on('mouseenter', destinationPointsLayerId, handleDestinationMouseEnter);
    map.on('mouseleave', destinationPointsLayerId, handleDestinationMouseLeave);
    map.on('click', activityPointsLayerId, handleActivityClick);
    map.on('mouseenter', activityPointsLayerId, handleActivityMouseEnter);
    map.on('mouseleave', activityPointsLayerId, handleActivityMouseLeave);
    map.on('contextmenu', handleContextMenu);
    map.on('styleimagemissing', handleStyleImageMissing);

    mapRef.current = map;

    return () => {
      map.off('load', handleLoad);
      map.off('move', handleMapMove);
      map.off('zoom', handleMapMove);
      map.off('resize', handleMapMove);
      map.off('zoomend', handleZoomEnd);
      map.off('click', destinationPointsLayerId, handleDestinationClick);
      map.off('mouseenter', destinationPointsLayerId, handleDestinationMouseEnter);
      map.off('mouseleave', destinationPointsLayerId, handleDestinationMouseLeave);
      map.off('click', activityPointsLayerId, handleActivityClick);
      map.off('mouseenter', activityPointsLayerId, handleActivityMouseEnter);
      map.off('mouseleave', activityPointsLayerId, handleActivityMouseLeave);
      map.off('contextmenu', handleContextMenu);
      map.off('styleimagemissing', handleStyleImageMissing);
      longPressStartRef.current = null;
      clearLongPressTimer();
      map.remove();
      mapRef.current = null;
    };
  }, [
    addMapLayers,
    applyCurrentMapDetailSettings,
    clearLongPressTimer,
    openAddStopMenu,
    updateMapLabelPositions,
  ]);

  useEffect(() => {
    const container = mapContainerRef.current;
    const map = mapRef.current;
    if (!container || !map || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const selectedZoomSettings = mapDetailSettings[selectedZoomStep];
  const visibleDetailCount = mapDetailCategories.filter(
    (category) => selectedZoomSettings[category.id],
  ).length;
  const hiddenDetailCount = mapDetailCategories.length - visibleDetailCount;
  const shouldShowDestinationLabels = currentMapZoom >= destinationLabelMinZoom;

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

  const handleMapPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onRequestAddStopRef.current || event.pointerType === 'mouse') return;

    clearLongPressTimer();
    const containerRect = event.currentTarget.getBoundingClientRect();
    longPressStartRef.current = {
      pointerId: event.pointerId,
      screenX: event.clientX,
      screenY: event.clientY,
      mapX: event.clientX - containerRect.left,
      mapY: event.clientY - containerRect.top,
    };
    longPressTimerRef.current = window.setTimeout(() => {
      const map = mapRef.current;
      const longPressStart = longPressStartRef.current;
      if (!map || !longPressStart) return;

      const coordinates = map.unproject([longPressStart.mapX, longPressStart.mapY]);
      requestAddStop({
        coordinates: { lat: coordinates.lat, lng: coordinates.lng },
        screenPosition: { x: longPressStart.mapX, y: longPressStart.mapY },
        source: 'long-press',
      });
      longPressStartRef.current = null;
      clearLongPressTimer();
    }, 500);
  };

  const handleMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const longPressStart = longPressStartRef.current;
    if (!longPressStart || longPressStart.pointerId !== event.pointerId) return;

    const deltaX = Math.abs(event.clientX - longPressStart.screenX);
    const deltaY = Math.abs(event.clientY - longPressStart.screenY);
    if (deltaX > 10 || deltaY > 10) {
      longPressStartRef.current = null;
      clearLongPressTimer();
    }
  };

  const handleMapPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const longPressStart = longPressStartRef.current;
    if (!longPressStart || longPressStart.pointerId !== event.pointerId) return;

    longPressStartRef.current = null;
    clearLongPressTimer();
  };

  return (
    <section className="map-canvas" aria-label="Interactive Plotter map">
      <div
        ref={mapContainerRef}
        className="maplibre-container"
        data-testid="map-container"
        onPointerDownCapture={handleMapPointerDownCapture}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerUp={handleMapPointerEnd}
        onPointerCancel={handleMapPointerEnd}
        onContextMenuCapture={handleMapContextMenu}
      />
      {addStopMenu && addStopMenuPosition ? (
        <div
          className="map-add-stop-menu"
          role="menu"
          style={{
            left: `${addStopMenuPosition.x}px`,
            top: `${addStopMenuPosition.y}px`,
          }}
        >
          <button type="button" role="menuitem" onClick={() => requestAddStop(addStopMenu)}>
            Add stop here
          </button>
          <button type="button" role="menuitem" onClick={closeAddStopMenu}>
            Cancel
          </button>
        </div>
      ) : null}
      {shouldShowDestinationLabels ? (
        <div className="map-destination-label-layer">
          {projectedDestinationLabels.map((destinationLabel) => (
            <button
              key={destinationLabel.id}
              type="button"
              className={stopPillClassName(destinationLabel)}
              data-stop-pill-id={destinationLabel.id}
              style={{
                left: `${destinationLabel.x}px`,
                top: `${destinationLabel.y}px`,
              }}
              aria-label={`Open ${destinationLabel.name} stop details`}
              onClick={() => onSelectDestinationRef.current(destinationLabel.id)}
            >
              {destinationLabel.text}
            </button>
          ))}
          {projectedActivityLabels.map((activityLabel) => (
            <button
              key={activityLabel.id}
              type="button"
              className={[
                'map-destination-label',
                'map-activity-label',
                activityLabel.position === 'above' ? 'map-label-position-above' : '',
                activityLabel.selected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: `${activityLabel.x}px`,
                top: `${activityLabel.y}px`,
              }}
              aria-label={`Open ${activityLabel.title} activity details`}
              onClick={() => onSelectActivityRef.current?.(activityLabel.id)}
            >
              {activityLabel.title}
            </button>
          ))}
        </div>
      ) : null}
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
