import { describe, expect, it, vi } from 'vitest';
import { calmBasemapStyle, mapLabelFontStack, mapStyleUrl, readMapLayerColors } from './mapPresentation';

describe('mapPresentation', () => {
  it('provides a usable style and label font stack', () => {
    expect(mapStyleUrl).toMatch(/^https:\/\//);
    expect(mapLabelFontStack.length).toBeGreaterThan(0);
  });

  it('hides noisy basemap layers', () => {
    const setLayoutProperty = vi.fn();
    const setPaintProperty = vi.fn();
    const map = {
      getStyle: () => ({
        layers: [
          { id: 'poi-label', type: 'symbol' },
          { id: 'road_minor', type: 'line' },
          { id: 'country-label', type: 'symbol' },
        ],
      }),
      setLayoutProperty,
      setPaintProperty,
    };

    calmBasemapStyle(map as never);

    expect(setLayoutProperty).toHaveBeenCalledWith('poi-label', 'visibility', 'none');
    expect(setPaintProperty).toHaveBeenCalledWith('road_minor', 'line-opacity', 0.32);
    expect(setLayoutProperty).not.toHaveBeenCalledWith('country-label', 'visibility', 'none');
  });

  it('returns complete layer colors', () => {
    expect(readMapLayerColors()).toMatchObject({
      accent: expect.any(String),
      shipping: expect.any(String),
      text: expect.any(String),
      textInverse: expect.any(String),
    });
  });
});
