import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import type { Destination, RouteLeg } from '../domain/types';
import { buildExportStopFeatures, downloadTripMap, tripMapFilename } from './tripMapExport';

const maplibreMock = vi.hoisted(() => ({
  constructorOptions: [] as Array<Record<string, unknown>>,
  constructorError: null as Error | null,
  remove: vi.fn(),
  instances: [] as Array<{
    callbacks: Map<string, () => void>;
    errorListeners: Set<(event: { error: Error }) => void>;
    sources: Array<[string, unknown]>;
    layers: Array<Record<string, unknown>>;
    fitBounds: ReturnType<typeof vi.fn>;
    jumpTo: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    canvas: HTMLCanvasElement;
    project: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('maplibre-gl', () => {
  class MapMock {
    callbacks = new Map<string, () => void>();
    errorListeners = new Set<(event: { error: Error }) => void>();
    sources: Array<[string, unknown]> = [];
    layers: Array<Record<string, unknown>> = [];
    fitBounds = vi.fn();
    jumpTo = vi.fn();
    remove = maplibreMock.remove;
    canvas = document.createElement('canvas');
    project = vi.fn(([longitude, latitude]: [number, number]) => ({
      x: 800 + longitude * 10,
      y: 500 - latitude * 5,
    }));
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();

    constructor(options: Record<string, unknown>) {
      maplibreMock.constructorOptions.push(options);
      if (maplibreMock.constructorError) throw maplibreMock.constructorError;
      maplibreMock.instances.push(this);
    }

    once(event: string, callback: () => void) {
      this.callbacks.set(event, callback);
      return this;
    }

    on(event: string, callback: (event: { error: Error }) => void) {
      if (event === 'error') this.errorListeners.add(callback);
      return this;
    }

    off = vi.fn((event: string, callback: (event: { error: Error }) => void) => {
      if (event === 'error') this.errorListeners.delete(callback);
      return this;
    });

    addSource(id: string, source: unknown) {
      this.sources.push([id, source]);
      return this;
    }

    addLayer(layer: Record<string, unknown>) {
      this.layers.push(layer);
      return this;
    }

    getStyle() {
      return {
        layers: [],
        sources: {
          base: { attribution: '<a href="https://example.com">Example Maps</a>' },
          duplicate: { attribution: 'Example Maps' },
        },
      };
    }

    getCanvas() {
      return this.canvas;
    }
  }

  return { default: { Map: MapMock } };
});

const first = () =>
  createDestination({ name: 'Balcombe', countryRegion: 'UK', coordinates: { lat: 51, lng: 0 } });
const second = () =>
  createDestination({ name: 'Paris', countryRegion: 'France', coordinates: { lat: 49, lng: 2 } });

let context: CanvasRenderingContext2D;
let toBlobResult: Blob | null;
let anchorClick: ReturnType<typeof vi.spyOn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let exportOverlaySnapshot: Array<{ className: string; text: string; selected: boolean }>;
let imageLoadShouldFail: boolean;
let imageLoadShouldHang: boolean;
let imageSources: string[];
let imageInstances: Array<{
  onload: null | (() => void);
  onerror: null | (() => void);
}>;
let overlayRemove: ReturnType<typeof vi.spyOn> | null;

function input(destinations: Destination[] = [first(), second()], routeLegs: RouteLeg[] = []) {
  return { tripName: 'Wild Atlantic Way', destinations, routeLegs };
}

function latestMap() {
  return maplibreMock.instances.at(-1)!;
}

async function advanceExportToIdle(destinations?: Destination[], routeLegs?: RouteLeg[]) {
  const promise = downloadTripMap(input(destinations, routeLegs));
  latestMap().callbacks.get('load')?.();
  await Promise.resolve();
  return { promise, map: latestMap() };
}

beforeEach(() => {
  maplibreMock.constructorOptions.length = 0;
  maplibreMock.constructorError = null;
  maplibreMock.remove.mockReset();
  maplibreMock.instances.length = 0;
  toBlobResult = new Blob(['png'], { type: 'image/png' });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 120 })),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(toBlobResult));
  createObjectURL = vi.fn(() => 'blob:trip-map');
  revokeObjectURL = vi.fn();
  exportOverlaySnapshot = [];
  imageLoadShouldFail = false;
  imageLoadShouldHang = false;
  imageSources = [];
  imageInstances = [];
  overlayRemove = null;
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  vi.stubGlobal('Image', class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    constructor() {
      imageInstances.push(this);
    }

    set src(value: string) {
      imageSources.push(value);
      const overlay = document.querySelector<HTMLDivElement>('[data-trip-map-export-labels]');
      if (overlay) overlayRemove = vi.spyOn(overlay, 'remove');
      exportOverlaySnapshot = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-trip-map-export-labels] .map-destination-label',
        ),
        (element) => ({
          className: element.className,
          text: element.textContent ?? '',
          selected: element.classList.contains('is-selected'),
        }),
      );
      if (imageLoadShouldHang) return;
      queueMicrotask(() => imageLoadShouldFail ? this.onerror?.() : this.onload?.());
    }
  });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
  document
    .querySelectorAll('[data-trip-map-export], [data-trip-map-export-labels], a[download]')
    .forEach((element) => element.remove());
});

describe('tripMapFilename', () => {
  it.each([
    ['Wild Atlantic Way', 'Wild-Atlantic-Way.png'],
    ['  Japan / Korea: 2027  ', 'Japan-Korea-2027.png'],
    ['***', 'plotter.png'],
  ])('turns %j into %j', (inputName, expected) => {
    expect(tripMapFilename(inputName)).toBe(expected);
  });

  it.each(['CON', 'prn', 'AUX', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9'])(
    'prefixes the Windows reserved device stem %j',
    (reservedName) => {
      expect(tripMapFilename(reservedName)).toBe(`trip-${reservedName}.png`);
    },
  );

  it('does not treat non-device stems as reserved', () => {
    expect(tripMapFilename('COM10')).toBe('COM10.png');
  });

  it('caps the sanitized stem at 100 characters before the extension', () => {
    expect(tripMapFilename('a'.repeat(180))).toBe(`${'a'.repeat(100)}.png`);
  });
});

it('numbers stop labels in canonical array order', () => {
  const origin = first();
  const target = second();
  expect(buildExportStopFeatures([origin, target]).features.map(({ properties }) => properties)).toEqual([
    { id: origin.id, name: 'Balcombe', number: 1, label: 'ST - Balcombe' },
    { id: target.id, name: 'Paris', number: 2, label: '02 - Paris' },
  ]);
});

it('constructs a deterministic non-interactive export map in a 1600 x 1000 container', async () => {
  const promise = downloadTripMap(input());
  const options = maplibreMock.constructorOptions[0];
  const container = options.container as HTMLDivElement;

  expect(options).toMatchObject({
    pixelRatio: 1,
    attributionControl: false,
    interactive: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  expect(container.dataset.tripMapExport).toBe('');
  expect(container.style.width).toBe('1600px');
  expect(container.style.height).toBe('1000px');

  latestMap().callbacks.get('load')?.();
  await Promise.resolve();
  latestMap().callbacks.get('idle')?.();
  await promise;
});

it('uses MapLibre only for routes and stop points', async () => {
  const { promise, map } = await advanceExportToIdle();
  expect(map.layers.map(({ id }) => id)).toEqual([
    'trip-map-export-routes',
    'trip-map-export-stop-points',
  ]);
  map.callbacks.get('idle')?.();
  await promise;
});

it('renders normal unselected app pills in an export overlay', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  expect(exportOverlaySnapshot).toEqual([
    { className: 'map-destination-label map-label-position-above', text: 'ST - Balcombe', selected: false },
    { className: 'map-destination-label', text: '02 - Paris', selected: false },
  ]);
});

it('places an earlier overlapping export pill above and the later pill below', async () => {
  const origin = first();
  const returnStop = createDestination({
    name: 'Balcombe return',
    countryRegion: 'UK',
    coordinates: origin.coordinates,
  });
  const { promise, map } = await advanceExportToIdle([origin, returnStop]);
  map.callbacks.get('idle')?.();
  await promise;

  expect(exportOverlaySnapshot).toEqual([
    { className: 'map-destination-label map-label-position-above', text: 'ST - Balcombe', selected: false },
    { className: 'map-destination-label', text: '02 - Balcombe return', selected: false },
  ]);
});

it('loads the rasterized SVG from a canvas-safe data URL', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  expect(imageSources[0]).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  expect(decodeURIComponent(imageSources[0].split(',', 2)[1])).toContain('<foreignObject');
});

it('fits multi-point bounds with deterministic padding and zoom', async () => {
  const destinations = [first(), second()];
  const { promise, map } = await advanceExportToIdle(destinations);

  expect(map.fitBounds).toHaveBeenCalledWith(
    [[0, 49], [2, 51]],
    { padding: 120, maxZoom: 6, duration: 0 },
  );
  map.callbacks.get('idle')?.();
  await promise;
});

it('unwraps dateline route, stop source, and overlay coordinates into the fitted interval', async () => {
  const alaska = createDestination({
    name: 'Alaska',
    countryRegion: 'USA',
    coordinates: { lat: 52, lng: 179 },
  });
  const russia = createDestination({
    name: 'Russia',
    countryRegion: 'Russia',
    coordinates: { lat: 54, lng: -179 },
  });
  const leg = {
    ...createRouteLeg({
      originDestinationId: alaska.id,
      targetDestinationId: russia.id,
      movement: 'drive', calculation: 'automatic',
    }),
    status: 'ready' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: [[179, 52], [-180, 53], [-179, 54]],
    },
  };
  const { promise, map } = await advanceExportToIdle([alaska, russia], [leg]);
  const routeSource = map.sources.find(([id]) => id === 'trip-map-export-routes')?.[1] as {
    data: { features: Array<{ geometry: { coordinates: number[][] } }> };
  };
  const stopSource = map.sources.find(([id]) => id === 'trip-map-export-stops')?.[1] as {
    data: { features: Array<{ geometry: { coordinates: number[] } }> };
  };

  expect(map.fitBounds).toHaveBeenCalledWith(
    [[179, 52], [181, 54]],
    { padding: 120, maxZoom: 6, duration: 0 },
  );
  expect(routeSource.data.features[0].geometry.coordinates).toEqual([[179, 52], [180, 53], [181, 54]]);
  expect(stopSource.data.features.map(({ geometry }) => geometry.coordinates)).toEqual([[179, 52], [181, 54]]);

  map.callbacks.get('idle')?.();
  await promise;
  expect(map.project.mock.calls).toEqual([
    [[179, 52]],
    [[181, 54]],
  ]);
});

it('keeps ordinary European route and stop source coordinates unchanged', async () => {
  const balcombe = first();
  const paris = second();
  const leg = {
    ...createRouteLeg({
      originDestinationId: balcombe.id,
      targetDestinationId: paris.id,
      movement: 'drive', calculation: 'automatic',
    }),
    status: 'ready' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: [[0, 51], [1, 50], [2, 49]],
    },
  };
  const { promise, map } = await advanceExportToIdle([balcombe, paris], [leg]);
  const routeSource = map.sources.find(([id]) => id === 'trip-map-export-routes')?.[1] as {
    data: { features: Array<{ geometry: { coordinates: number[][] } }> };
  };
  const stopSource = map.sources.find(([id]) => id === 'trip-map-export-stops')?.[1] as {
    data: { features: Array<{ geometry: { coordinates: number[] } }> };
  };

  expect(routeSource.data.features[0].geometry.coordinates).toEqual([[0, 51], [1, 50], [2, 49]]);
  expect(stopSource.data.features.map(({ geometry }) => geometry.coordinates)).toEqual([[0, 51], [2, 49]]);

  map.callbacks.get('idle')?.();
  await promise;
});

it('centers a one-stop trip at zoom 6', async () => {
  const destination = first();
  const { promise, map } = await advanceExportToIdle([destination]);

  expect(map.jumpTo).toHaveBeenCalledWith({ center: [0, 51], zoom: 6 });
  map.callbacks.get('idle')?.();
  await promise;
});

it('waits for idle before converting to PNG', async () => {
  const { promise, map } = await advanceExportToIdle();

  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  map.callbacks.get('idle')?.();
  await promise;
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
});

it('rejects a map resource error before capture and removes the lifecycle listener', async () => {
  const { promise, map } = await advanceExportToIdle();
  const container = document.querySelector('[data-trip-map-export]');

  for (const listener of map.errorListeners) {
    listener({ error: new Error('Tile request failed.') });
  }
  map.callbacks.get('idle')?.();

  await expect(promise).rejects.toThrow('Tile request failed.');
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(anchorClick).not.toHaveBeenCalled();
  expect(map.off).toHaveBeenCalledWith('error', expect.any(Function));
  expect(map.errorListeners).toHaveLength(0);
  expect(map.remove).toHaveBeenCalledOnce();
  expect(container).not.toBeInTheDocument();
});

it('rejects a map resource error while waiting for load', async () => {
  const promise = downloadTripMap(input());
  const map = latestMap();
  const rejection = expect(promise).rejects.toThrow('Style request failed.');

  for (const listener of map.errorListeners) {
    listener({ error: new Error('Style request failed.') });
  }
  map.callbacks.get('load')?.();
  await Promise.resolve();
  map.callbacks.get('idle')?.();

  await rejection;
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(anchorClick).not.toHaveBeenCalled();
  expect(map.off).toHaveBeenCalledWith('error', expect.any(Function));
  expect(map.errorListeners).toHaveLength(0);
});

it('draws source attribution before converting the output canvas', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  expect(context.fillText).toHaveBeenCalledWith('Example Maps', expect.any(Number), expect.any(Number));
  expect((context.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
    (HTMLCanvasElement.prototype.toBlob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );
});

it('composites stop pills after the map canvas and before attribution and PNG conversion', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  const drawCalls = (context.drawImage as ReturnType<typeof vi.fn>).mock.calls;
  expect(drawCalls).toHaveLength(2);
  expect(drawCalls[0][0]).toBe(map.canvas);
  expect(drawCalls[1][0]).toBe(imageInstances[0]);
  expect((context.drawImage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1]).toBeLessThan(
    (context.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );
  expect((context.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
    (HTMLCanvasElement.prototype.toBlob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );
});

it('rejects label rasterization failure and removes the overlay', async () => {
  imageLoadShouldFail = true;
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();

  await expect(promise).rejects.toThrow('Unable to render trip map stop labels.');
  expect(imageInstances[0].onload).toBeNull();
  expect(imageInstances[0].onerror).toBeNull();
  expect(anchorClick).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(overlayRemove).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-trip-map-export-labels]')).not.toBeInTheDocument();
  expect(document.querySelector('[data-trip-map-export]')).not.toBeInTheDocument();
  expect(map.remove).toHaveBeenCalledOnce();
});

it('times out the font readiness wait after 15,000 ms', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: new Promise(() => undefined) },
  });
  let settledError: Error | undefined;
  const { promise, map } = await advanceExportToIdle();
  void promise.catch((error: Error) => { settledError = error; });
  map.callbacks.get('idle')?.();

  await vi.advanceTimersByTimeAsync(15_000);

  expect(settledError?.message).toBe('Timed out waiting for trip map fonts.');
  expect(anchorClick).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('times out image loading and clears its handlers after 15,000 ms', async () => {
  vi.useFakeTimers();
  imageLoadShouldHang = true;
  let settledError: Error | undefined;
  const { promise, map } = await advanceExportToIdle();
  void promise.catch((error: Error) => { settledError = error; });
  map.callbacks.get('idle')?.();
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(15_000);

  expect(settledError?.message).toBe('Timed out rendering trip map stop labels.');
  expect(imageInstances[0].onload).toBeNull();
  expect(imageInstances[0].onerror).toBeNull();
  expect(anchorClick).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('times out PNG conversion after 15,000 ms', async () => {
  vi.useFakeTimers();
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => undefined);
  let settledError: Error | undefined;
  const { promise, map } = await advanceExportToIdle();
  void promise.catch((error: Error) => { settledError = error; });
  map.callbacks.get('idle')?.();
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(15_000);

  expect(settledError?.message).toBe('Timed out creating trip map PNG.');
  expect(anchorClick).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels image loading and clears handlers when the map fails', async () => {
  vi.useFakeTimers();
  imageLoadShouldHang = true;
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await vi.advanceTimersByTimeAsync(0);

  for (const listener of map.errorListeners) {
    listener({ error: new Error('Tile request failed during label rendering.') });
  }

  await expect(promise).rejects.toThrow('Tile request failed during label rendering.');
  expect(imageInstances[0].onload).toBeNull();
  expect(imageInstances[0].onerror).toBeNull();
  expect(anchorClick).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('downloads with the sanitized trip name and cleans up all temporary resources', async () => {
  const { promise, map } = await advanceExportToIdle();
  const container = document.querySelector('[data-trip-map-export]');
  map.callbacks.get('idle')?.();
  await promise;

  expect(imageInstances[0].onload).toBeNull();
  expect(imageInstances[0].onerror).toBeNull();
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(anchorClick.mock.instances[0].download).toBe('Wild-Atlantic-Way.png');
  expect(map.remove).toHaveBeenCalledOnce();
  expect(container).not.toBeInTheDocument();
  expect(document.querySelector('a[download]')).not.toBeInTheDocument();
  expect(overlayRemove).toHaveBeenCalledOnce();
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:trip-map');
});

it.each(['load', 'idle'] as const)('rejects after a 15,000 ms %s timeout and cleans up', async (event) => {
  vi.useFakeTimers();
  const promise = downloadTripMap(input());
  const map = latestMap();
  const container = document.querySelector('[data-trip-map-export]');
  if (event === 'idle') {
    map.callbacks.get('load')?.();
    await Promise.resolve();
  }

  const rejection = expect(promise).rejects.toThrow(`Timed out waiting for map ${event}.`);
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;
  expect(map.remove).toHaveBeenCalledOnce();
  expect(container).not.toBeInTheDocument();
});

it('rejects a null PNG blob and cleans up', async () => {
  toBlobResult = null;
  const { promise, map } = await advanceExportToIdle();
  const container = document.querySelector('[data-trip-map-export]');
  map.callbacks.get('idle')?.();

  await expect(promise).rejects.toThrow('Unable to create trip map PNG.');
  expect(map.remove).toHaveBeenCalledOnce();
  expect(container).not.toBeInTheDocument();
});

it('rejects empty destinations before constructing MapLibre', async () => {
  await expect(downloadTripMap(input([]))).rejects.toThrow('Trip map export requires at least one stop.');
  expect(maplibreMock.constructorOptions).toHaveLength(0);
});

it('removes the export container when MapLibre construction fails', async () => {
  maplibreMock.constructorError = new Error('WebGL initialization failed.');

  await expect(downloadTripMap(input())).rejects.toThrow('WebGL initialization failed.');
  expect(document.querySelector('[data-trip-map-export]')).not.toBeInTheDocument();
  expect(maplibreMock.remove).not.toHaveBeenCalled();
});
