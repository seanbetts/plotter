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
  '--map-colour-accent': '#d9467a',
  '--map-colour-accent-rgb': '217 70 122',
  '--map-colour-selected': '#f7f0d0',
  '--map-colour-shipping': '#7ec8e3',
  '--map-colour-text': '#17201c',
  '--map-colour-text-rgb': '23 32 28',
  '--map-colour-text-inverse': '#111814',
  '--map-colour-text-inverse-rgb': '17 24 20',
} as const;

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
    accent: readCssToken('--map-colour-accent'),
    accentHalo: readCssRgbToken('--map-colour-accent-rgb', 0.22),
    selected: readCssToken('--map-colour-selected'),
    shipping: readCssToken('--map-colour-shipping'),
    text: readCssToken('--map-colour-text'),
    textInverse: readCssToken('--map-colour-text-inverse'),
    cityText: readCssRgbToken('--map-colour-text-inverse-rgb', 0.82),
    cityHalo: readCssRgbToken('--map-colour-text-rgb', 0.82),
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
