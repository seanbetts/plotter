import maplibregl from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';
import { calmBasemapStyle, mapLabelFontStack, mapStyleUrl, readMapLayerColors } from './mapPresentation';
import { buildRenderableRouteFeatures, tripMapBounds } from './tripRouteFeatures';

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
  const stem = name
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex -- Portable filenames exclude ASCII control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'world-tour'}.png`;
}

export function buildExportStopFeatures(
  destinations: Destination[],
): FeatureCollection<Point, ExportStopProperties> {
  return {
    type: 'FeatureCollection' as const,
    features: destinations.map((destination, index) => ({
      type: 'Feature' as const,
      id: destination.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [destination.coordinates.lng, destination.coordinates.lat],
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

function waitForMapEvent(map: maplibregl.Map, event: 'load' | 'idle', timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`Timed out waiting for map ${event}.`));
    }, timeoutMs);

    map.once(event, () => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
}

function addExportSourcesAndLayers(map: maplibregl.Map, destinations: Destination[], routeLegs: RouteLeg[]) {
  const mapColors = readMapLayerColors();

  calmBasemapStyle(map);
  map.addSource(routesSourceId, {
    type: 'geojson',
    data: buildRenderableRouteFeatures(destinations, routeLegs),
  });
  map.addSource(stopsSourceId, {
    type: 'geojson',
    data: buildExportStopFeatures(destinations),
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

function frameExportMap(map: maplibregl.Map, destinations: Destination[], routeLegs: RouteLeg[]) {
  const bounds = tripMapBounds(destinations, routeLegs);
  if (!bounds) return;

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
  const map = createExportMap(container);
  let objectUrl: string | null = null;
  let anchor: HTMLAnchorElement | null = null;

  try {
    await waitForMapEvent(map, 'load', exportTimeoutMs);
    addExportSourcesAndLayers(map, input.destinations, input.routeLegs);
    frameExportMap(map, input.destinations, input.routeLegs);
    await waitForMapEvent(map, 'idle', exportTimeoutMs);
    const blob = await exportBlob(map);
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = tripMapFilename(input.tripName);
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    map.remove();
    container.remove();
  }
}
