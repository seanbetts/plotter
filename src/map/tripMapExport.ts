import maplibregl from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';
import { calmBasemapStyle, mapStyleUrl, readMapLayerColors } from './mapPresentation';
import {
  buildStopPillPresentations,
  createStopPillElement,
  positionStopPillPresentations,
} from './stopPillPresentation';
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
  const stopPills = buildStopPillPresentations({
    destinations,
    selectedDestinationId: null,
    project: ([longitude, latitude]) => ({ x: longitude, y: latitude }),
  });
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
        label: stopPills[index].text,
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
}

function createStopPillOverlay(
  container: HTMLDivElement,
  map: maplibregl.Map,
  destinations: Destination[],
  bounds: TripMapBounds,
) {
  const overlay = document.createElement('div');
  overlay.dataset.tripMapExportLabels = '';
  overlay.className = 'map-destination-label-layer';
  overlay.style.width = `${exportWidth}px`;
  overlay.style.height = `${exportHeight}px`;

  const pills = buildStopPillPresentations({
    destinations,
    selectedDestinationId: null,
    project: ([longitude, latitude]) => map.project([
      unwrapLongitudeForBounds(longitude, bounds),
      latitude,
    ]),
  });
  for (const pill of positionStopPillPresentations(pills)) {
    overlay.append(createStopPillElement(pill));
  }

  container.append(overlay);
  return overlay;
}

function inlineComputedStyles(source: Element, target: Element) {
  const style = getComputedStyle(source);
  const targetElement = target as HTMLElement;
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    targetElement.style.setProperty(
      property,
      style.getPropertyValue(property),
      style.getPropertyPriority(property),
    );
  }

  Array.from(source.children).forEach((child, index) => {
    const targetChild = target.children[index];
    if (targetChild) inlineComputedStyles(child, targetChild);
  });
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Trip map export cancelled.', 'AbortError');
}

function waitForFonts(signal: AbortSignal) {
  if (!document.fonts) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => settle(() => reject(abortReason(signal)));

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener('abort', handleAbort, { once: true });
    timeout = window.setTimeout(() => {
      settle(() => reject(new Error('Timed out waiting for trip map fonts.')));
    }, exportTimeoutMs);
    document.fonts.ready.then(
      () => settle(resolve),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

function loadImage(url: string, signal: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let timeout = 0;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    const handleAbort = () => settle(() => reject(abortReason(signal)));

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener('abort', handleAbort, { once: true });
    timeout = window.setTimeout(() => {
      settle(() => reject(new Error('Timed out rendering trip map stop labels.')));
    }, exportTimeoutMs);
    image.onload = () => settle(() => resolve(image));
    image.onerror = () => settle(() => reject(new Error('Unable to render trip map stop labels.')));
    image.src = url;
  });
}

async function rasterizeStopPillOverlay(overlay: HTMLDivElement, signal: AbortSignal) {
  await waitForFonts(signal);
  const clone = overlay.cloneNode(true) as HTMLDivElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  inlineComputedStyles(overlay, clone);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return loadImage(url, signal);
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

function drawAttribution(context: CanvasRenderingContext2D, map: maplibregl.Map) {
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
}

function exportBlob(map: maplibregl.Map, stopPillImage: HTMLImageElement, signal: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    const output = document.createElement('canvas');
    output.width = exportWidth;
    output.height = exportHeight;
    const context = output.getContext('2d');
    if (!context) {
      reject(new Error('Unable to create trip map PNG.'));
      return;
    }

    let settled = false;
    let timeout = 0;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => settle(() => reject(abortReason(signal)));

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener('abort', handleAbort, { once: true });
    timeout = window.setTimeout(() => {
      settle(() => reject(new Error('Timed out creating trip map PNG.')));
    }, exportTimeoutMs);

    context.drawImage(map.getCanvas(), 0, 0, exportWidth, exportHeight);
    context.drawImage(stopPillImage, 0, 0, exportWidth, exportHeight);
    drawAttribution(context, map);

    try {
      output.toBlob((blob) => {
        if (blob) {
          settle(() => resolve(blob));
        } else {
          settle(() => reject(new Error('Unable to create trip map PNG.')));
        }
      }, 'image/png');
    } catch (error) {
      settle(() => reject(error));
    }
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
  let overlay: HTMLDivElement | null = null;
  const postIdleController = new AbortController();
  let unsubscribeFromPostIdleErrors: () => void = () => undefined;

  try {
    map = createExportMap(container);
    errorMonitor = observeMapErrors(map);
    await waitForMapEvent(map, 'load', exportTimeoutMs, errorMonitor);
    addExportSourcesAndLayers(map, input.destinations, input.routeLegs, bounds);
    frameExportMap(map, bounds);
    errorMonitor.rejectIfFailed();
    await waitForMapEvent(map, 'idle', exportTimeoutMs, errorMonitor);
    unsubscribeFromPostIdleErrors = errorMonitor.subscribe((error) => {
      postIdleController.abort(error);
    });
    overlay = createStopPillOverlay(container, map, input.destinations, bounds);
    const stopPillImage = await rasterizeStopPillOverlay(overlay, postIdleController.signal);
    const blob = await exportBlob(map, stopPillImage, postIdleController.signal);
    errorMonitor.rejectIfFailed();
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = tripMapFilename(input.tripName);
    document.body.append(anchor);
    anchor.click();
  } finally {
    postIdleController.abort();
    unsubscribeFromPostIdleErrors();
    anchor?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    errorMonitor?.remove();
    map?.remove();
    overlay?.remove();
    container.remove();
  }
}
