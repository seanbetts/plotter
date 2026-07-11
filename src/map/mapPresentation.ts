import type maplibregl from 'maplibre-gl';

const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';

export const mapStyleUrl = mapTilerApiKey
  ? `https://api.maptiler.com/maps/streets-v4/style.json?key=${mapTilerApiKey}`
  : 'https://demotiles.maplibre.org/style.json';

export const mapLabelFontStack = mapTilerApiKey
  ? ['Roboto Regular', 'Noto Sans Regular']
  : ['Open Sans Semibold'];

export type MapLayerColors = {
  accent: string;
  accentHalo: string;
  selected: string;
  shipping: string;
  text: string;
  textInverse: string;
  cityText: string;
  cityHalo: string;
};

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

const mapColorTokenFallbacks = {
  '--color-accent': '#d9467a',
  '--color-accent-rgb': '217 70 122',
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

function layerMatchesPattern(layerId: string, patterns: string[]) {
  const normalizedLayerId = layerId.toLowerCase();

  return patterns.some((pattern) => normalizedLayerId.includes(pattern));
}

export function readMapLayerColors(): MapLayerColors {
  return {
    accent: readCssToken('--color-accent'),
    accentHalo: readCssRgbToken('--color-accent-rgb', 0.22),
    selected: readCssToken('--color-map-selected'),
    shipping: readCssToken('--color-route-shipping'),
    text: readCssToken('--color-text'),
    textInverse: readCssToken('--color-text-inverse'),
    cityText: readCssRgbToken('--color-text-inverse-rgb', 0.82),
    cityHalo: readCssRgbToken('--color-text-rgb', 0.82),
  };
}

export function calmBasemapStyle(
  map: Pick<maplibregl.Map, 'getStyle' | 'setLayoutProperty' | 'setPaintProperty'>,
): void {
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
