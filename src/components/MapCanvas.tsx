import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
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

const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';
const styleUrl = mapTilerApiKey
  ? `https://api.maptiler.com/maps/streets-v4/style.json?key=${mapTilerApiKey}`
  : 'https://demotiles.maplibre.org/style.json';
const majorCityMinZoom = 5;
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

function calmBasemapStyle(map: maplibregl.Map) {
  const layers = map.getStyle().layers ?? [];

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
            '#7ec8e3',
            'failed',
            '#f5efe3',
            '#e9b44c',
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
          'circle-color': ['case', ['get', 'selected'], '#f7f0d0', '#e9b44c'],
          'circle-radius': ['case', ['get', 'selected'], 9, 7],
          'circle-stroke-color': '#111814',
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
          'text-color': '#111814',
          'text-halo-color': '#f5efe3',
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
          'circle-color': '#f7f0d0',
          'circle-radius': 3,
          'circle-stroke-color': '#111814',
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
          'text-color': 'rgba(17, 24, 20, 0.82)',
          'text-halo-color': 'rgba(245, 239, 227, 0.82)',
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
      calmBasemapStyle(map);
      addMapLayers();
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
    map.on('click', destinationPointsLayerId, handleDestinationClick);
    map.on('mouseenter', destinationPointsLayerId, handleDestinationMouseEnter);
    map.on('mouseleave', destinationPointsLayerId, handleDestinationMouseLeave);

    mapRef.current = map;

    return () => {
      map.off('load', handleLoad);
      map.off('click', destinationPointsLayerId, handleDestinationClick);
      map.off('mouseenter', destinationPointsLayerId, handleDestinationMouseEnter);
      map.off('mouseleave', destinationPointsLayerId, handleDestinationMouseLeave);
      map.remove();
      mapRef.current = null;
    };
  }, [addMapLayers]);

  const routeCount = useMemo(() => routeLegs.length, [routeLegs.length]);

  return (
    <section className="map-canvas" aria-label="Interactive world tour map">
      <div ref={mapContainerRef} className="maplibre-container" data-testid="map-container" />
      {destinations.length === 0 ? <div className="map-empty-label">Blank planning map</div> : null}
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
      <div className="map-route-count" aria-live="polite">
        {routeCount} route {routeCount === 1 ? 'leg' : 'legs'}
      </div>
    </section>
  );
}
