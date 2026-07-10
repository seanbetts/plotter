import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import type { Destination } from '../domain/types';
import { buildExportStopFeatures, downloadTripMap, tripMapFilename } from './tripMapExport';

const maplibreMock = vi.hoisted(() => ({
  constructorOptions: [] as Array<Record<string, unknown>>,
  constructorError: null as Error | null,
  remove: vi.fn(),
  instances: [] as Array<{
    callbacks: Map<string, () => void>;
    sources: Array<[string, unknown]>;
    layers: Array<Record<string, unknown>>;
    fitBounds: ReturnType<typeof vi.fn>;
    jumpTo: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('maplibre-gl', () => {
  class MapMock {
    callbacks = new Map<string, () => void>();
    sources: Array<[string, unknown]> = [];
    layers: Array<Record<string, unknown>> = [];
    fitBounds = vi.fn();
    jumpTo = vi.fn();
    remove = maplibreMock.remove;
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
      return document.createElement('canvas');
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

function input(destinations: Destination[] = [first(), second()]) {
  return { tripName: 'Wild Atlantic Way', destinations, routeLegs: [] };
}

function latestMap() {
  return maplibreMock.instances.at(-1)!;
}

async function advanceExportToIdle(destinations?: Destination[]) {
  const promise = downloadTripMap(input(destinations));
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
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-trip-map-export], a[download]').forEach((element) => element.remove());
});

describe('tripMapFilename', () => {
  it.each([
    ['Wild Atlantic Way', 'Wild-Atlantic-Way.png'],
    ['  Japan / Korea: 2027  ', 'Japan-Korea-2027.png'],
    ['***', 'world-tour.png'],
  ])('turns %j into %j', (inputName, expected) => {
    expect(tripMapFilename(inputName)).toBe(expected);
  });
});

it('numbers stop labels in canonical array order', () => {
  const origin = first();
  const target = second();
  expect(buildExportStopFeatures([origin, target]).features.map(({ properties }) => properties)).toEqual([
    { id: origin.id, name: 'Balcombe', number: 1, label: '1 - Balcombe' },
    { id: target.id, name: 'Paris', number: 2, label: '2 - Paris' },
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

it('adds route, stop point, stop number, and stop name layers after load', async () => {
  const { promise, map } = await advanceExportToIdle();
  const layerIds = map.layers.map(({ id }) => id);

  expect(layerIds).toEqual([
    'trip-map-export-routes',
    'trip-map-export-stop-points',
    'trip-map-export-stop-numbers',
    'trip-map-export-stop-names',
  ]);
  expect(map.sources.map(([id]) => id)).toEqual(['trip-map-export-routes', 'trip-map-export-stops']);
  map.callbacks.get('idle')?.();
  await promise;
});

it('keeps all stop numbers visible and gives stop names variable anchors', async () => {
  const { promise, map } = await advanceExportToIdle();
  const numbers = map.layers.find(({ id }) => id === 'trip-map-export-stop-numbers')!;
  const names = map.layers.find(({ id }) => id === 'trip-map-export-stop-names')!;

  expect(numbers.layout).toMatchObject({
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  });
  expect(names.layout).toMatchObject({
    'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
  });
  map.callbacks.get('idle')?.();
  await promise;
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

it('draws source attribution before converting the output canvas', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  expect(context.fillText).toHaveBeenCalledWith('Example Maps', expect.any(Number), expect.any(Number));
  expect((context.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
    (HTMLCanvasElement.prototype.toBlob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );
});

it('downloads with the sanitized trip name and cleans up all temporary resources', async () => {
  const { promise, map } = await advanceExportToIdle();
  const container = document.querySelector('[data-trip-map-export]');
  map.callbacks.get('idle')?.();
  await promise;

  expect(anchorClick).toHaveBeenCalledOnce();
  expect(anchorClick.mock.instances[0].download).toBe('Wild-Atlantic-Way.png');
  expect(map.remove).toHaveBeenCalledOnce();
  expect(container).not.toBeInTheDocument();
  expect(document.querySelector('a[download]')).not.toBeInTheDocument();
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
