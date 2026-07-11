import maplibregl from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';
import { calmBasemapStyle, mapLabelFontStack, mapStyleUrl, readMapLayerColors } from './mapPresentation';
import {
  buildRenderableRouteFeatures,
  tripMapBounds,
  unwrapLongitudeForBounds,
} from './tripRouteFeatures';
import type { RouteFeatureProperties, TripMapBounds } from './tripRouteFeatures';

export type TripMapExportInput = {
  tripName: string;
  destinations: Destination[];
  routeLegs: RouteLeg[];
};

type ExportStopProperties = {
  id: string;
  name: string;
  number: number;
  label: string;
};

const exportWidth = 1600;
const exportHeight = 1000;
const exportPadding = 120;
const exportMaxZoom = 6;
const exportTimeoutMs = 15_000;

const routesSourceId = 'trip-map-export-routes';
const stopsSourceId = 'trip-map-export-stops';
const routeLayerId = 'trip-map-export-routes';
const stopPointsLayerId = 'trip-map-export-stop-points';
const stopNumbersLayerId = 'trip-map-export-stop-numbers';
const stopNamesLayerId = 'trip-map-export-stop-names';

export function tripMapFilename(name: string) {
  let stem = name
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex -- Portable filenames exclude ASCII control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  stem = Array.from(stem).slice(0, 100).join('').replace(/-+$/g, '');
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `trip-${stem}`;
  return `${stem || 'world-tour'}.png`;
}

export function buildExportStopFeatures(
  destinations: Destination[],
  bounds?: TripMapBounds,
): FeatureCollection<Point, ExportStopProperties> {
  return {
    type: 'FeatureCollection' as const,
    features: destinations.map((destination, index) => ({
      type: 'Feature' as const,
      id: destination.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [
          bounds ? unwrapLongitudeForBounds(destination.coordinates.lng, bounds) : destination.coordinates.lng,
          destination.coordinates.lat,
        ],
      },
      properties: {
        id: destination.id,
        name: destination.name,
        number: index + 1,
        label: `${index + 1} - ${destination.name}`,
      },
    })),
  };
}

function createExportContainer() {
  const container = document.createElement('div');
  container.dataset.tripMapExport = '';
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${exportWidth}px`,
    height: `${exportHeight}px`,
  });
  document.body.append(container);
  return container;
}

function createExportMap(container: HTMLDivElement) {
  return new maplibregl.Map({
    container,
    style: mapStyleUrl,
    center: [18, 24],
    zoom: 1.4,
    pixelRatio: 1,
    attributionControl: false,
    interactive: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
}

type MapErrorMonitor = ReturnType<typeof observeMapErrors>;

function observeMapErrors(map: maplibregl.Map) {
  let resourceError: Error | null = null;
  const subscribers = new Set<(error: Error) => void>();
  const handleError = (event: maplibregl.ErrorEvent) => {
    resourceError = event.error instanceof Error ? event.error : new Error(event.error.message);
    for (const subscriber of subscribers) subscriber(resourceError);
  };

  map.on('error', handleError);

  return {
    subscribe(subscriber: (error: Error) => void) {
      if (resourceError) {
        subscriber(resourceError);
        return () => undefined;
      }
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    rejectIfFailed() {
      if (resourceError) throw resourceError;
    },
    remove() {
      subscribers.clear();
      map.off('error', handleError);
    },
  };
}

function waitForMapEvent(
  map: maplibregl.Map,
  event: 'load' | 'idle',
  timeoutMs: number,
  errorMonitor: MapErrorMonitor,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    let unsubscribeFromErrors: () => void = () => undefined;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribeFromErrors();
      callback();
    };
    timeout = window.setTimeout(() => {
      settle(() => reject(new Error(`Timed out waiting for map ${event}.`)));
    }, timeoutMs);
    unsubscribeFromErrors = errorMonitor.subscribe((error) => {
      settle(() => reject(error));
    });

    map.once(event, () => {
      settle(resolve);
    });
  });
}

function rejectOnMapError<T>(promise: Promise<T>, errorMonitor: MapErrorMonitor) {
  return new Promise<T>((resolve, reject) => {
    const unsubscribeFromErrors = errorMonitor.subscribe(reject);
    promise.then(
      (value) => {
        unsubscribeFromErrors();
        resolve(value);
      },
      (error: unknown) => {
        unsubscribeFromErrors();
        reject(error);
      },
    );
  });
}

function unwrapRouteFeatures(
  features: FeatureCollection<LineString, RouteFeatureProperties>,
  bounds: TripMapBounds,
): FeatureCollection<LineString, RouteFeatureProperties> {
  return {
    ...features,
    features: features.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: feature.geometry.coordinates.map(([longitude, latitude]) => [
          unwrapLongitudeForBounds(longitude, bounds),
          latitude,
        ]),
      },
    })),
  };
}

function addExportSourcesAndLayers(
  map: maplibregl.Map,
  destinations: Destination[],
  routeLegs: RouteLeg[],
  bounds: TripMapBounds,
) {
  const mapColors = readMapLayerColors();

  calmBasemapStyle(map);
  map.addSource(routesSourceId, {
    type: 'geojson',
    data: unwrapRouteFeatures(buildRenderableRouteFeatures(destinations, routeLegs), bounds),
  });
  map.addSource(stopsSourceId, {
    type: 'geojson',
    data: buildExportStopFeatures(destinations, bounds),
  });

  map.addLayer({
    id: routeLayerId,
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
        'manual',
        mapColors.shipping,
        'failed',
        mapColors.text,
        mapColors.accent,
      ],
      'line-dasharray': [
        'match',
        ['get', 'type'],
        'manual',
        ['literal', [2, 2]],
        'failed',
        ['literal', [1, 2]],
        ['literal', [1, 0]],
      ],
      'line-opacity': ['case', ['==', ['get', 'type'], 'failed'], 0.72, 0.92],
      'line-width': 4,
    },
  } as maplibregl.LayerSpecification);

  map.addLayer({
    id: stopPointsLayerId,
    type: 'circle',
    source: stopsSourceId,
    paint: {
      'circle-color': mapColors.accent,
      'circle-radius': 10,
      'circle-stroke-color': mapColors.textInverse,
      'circle-stroke-width': 2,
    },
  });

  map.addLayer({
    id: stopNumbersLayerId,
    type: 'symbol',
    source: stopsSourceId,
    layout: {
      'text-field': ['to-string', ['get', 'number']],
      'text-font': mapLabelFontStack,
      'text-size': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': mapColors.textInverse,
    },
  });

  map.addLayer({
    id: stopNamesLayerId,
    type: 'symbol',
    source: stopsSourceId,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': mapLabelFontStack,
      'text-size': 14,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 1.4,
      'text-justify': 'auto',
    },
    paint: {
      'text-color': mapColors.textInverse,
      'text-halo-color': mapColors.text,
      'text-halo-width': 2,
    },
  });
}

function frameExportMap(map: maplibregl.Map, bounds: TripMapBounds) {
  if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
    map.jumpTo({ center: bounds[0], zoom: exportMaxZoom });
    return;
  }

  map.fitBounds(bounds, {
    padding: exportPadding,
    maxZoom: exportMaxZoom,
    duration: 0,
  });
}

function attributionText(map: maplibregl.Map) {
  const sources = Object.values(map.getStyle().sources ?? {}) as Array<{ attribution?: string }>;
  const attributions = sources.flatMap((source) => {
    if (!source.attribution?.trim()) return [];
    const detached = document.createElement('div');
    detached.innerHTML = source.attribution;
    const text = detached.textContent?.trim();
    return text ? [text] : [];
  });
  return [...new Set(attributions)].join(' · ');
}

function exportBlob(map: maplibregl.Map) {
  return new Promise<Blob>((resolve, reject) => {
    const output = document.createElement('canvas');
    output.width = exportWidth;
    output.height = exportHeight;
    const context = output.getContext('2d');
    if (!context) {
      reject(new Error('Unable to create trip map PNG.'));
      return;
    }

    context.drawImage(map.getCanvas(), 0, 0, exportWidth, exportHeight);
    const attribution = attributionText(map);
    if (attribution) {
      context.font = '12px sans-serif';
      context.textAlign = 'right';
      context.textBaseline = 'bottom';
      const padding = 8;
      const textWidth = context.measureText(attribution).width;
      context.fillStyle = 'rgba(245, 239, 227, 0.82)';
      context.fillRect(
        exportWidth - textWidth - padding * 2,
        exportHeight - 12 - padding * 2,
        textWidth + padding * 2,
        12 + padding * 2,
      );
      context.fillStyle = '#111814';
      context.fillText(attribution, exportWidth - padding, exportHeight - padding);
    }

    output.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Unable to create trip map PNG.'));
      }
    }, 'image/png');
  });
}

export async function downloadTripMap(input: TripMapExportInput): Promise<void> {
  if (input.destinations.length === 0) {
    throw new Error('Trip map export requires at least one stop.');
  }

  const container = createExportContainer();
  const bounds = tripMapBounds(input.destinations, input.routeLegs)!;
  let map: maplibregl.Map | null = null;
  let objectUrl: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  let errorMonitor: MapErrorMonitor | null = null;

  try {
    map = createExportMap(container);
    errorMonitor = observeMapErrors(map);
    await waitForMapEvent(map, 'load', exportTimeoutMs, errorMonitor);
    addExportSourcesAndLayers(map, input.destinations, input.routeLegs, bounds);
    frameExportMap(map, bounds);
    errorMonitor.rejectIfFailed();
    await waitForMapEvent(map, 'idle', exportTimeoutMs, errorMonitor);
    const blob = await rejectOnMapError(exportBlob(map), errorMonitor);
    errorMonitor.rejectIfFailed();
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = tripMapFilename(input.tripName);
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    errorMonitor?.remove();
    map?.remove();
    container.remove();
  }
}
