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

  it('reads stable map colours without consulting interface aliases', () => {
    const tokens: Record<string, string> = {
      '--map-colour-accent': '#a10001',
      '--map-colour-accent-rgb': '161 0 1',
      '--map-colour-selected': '#a20002',
      '--map-colour-shipping': '#a30003',
      '--map-colour-text': '#a40004',
      '--map-colour-text-rgb': '164 0 4',
      '--map-colour-text-inverse': '#a50005',
      '--map-colour-text-inverse-rgb': '165 0 5',
      '--color-accent': '#interface-accent',
      '--color-map-selected': '#interface-selected',
      '--color-route-shipping': '#interface-shipping',
      '--color-text': '#interface-text',
      '--color-text-inverse': '#interface-text-inverse',
    };
    const getPropertyValue = vi.fn((tokenName: string) => tokens[tokenName] ?? '');
    const getComputedStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue } as unknown as CSSStyleDeclaration);

    try {
      expect(readMapLayerColors()).toEqual({
        accent: '#a10001',
        accentHalo: 'rgba(161, 0, 1, 0.22)',
        selected: '#a20002',
        shipping: '#a30003',
        text: '#a40004',
        textInverse: '#a50005',
        cityText: 'rgba(165, 0, 5, 0.82)',
        cityHalo: 'rgba(164, 0, 4, 0.82)',
      });
      expect(getPropertyValue.mock.calls.flat()).not.toContainEqual(expect.stringMatching(/^--color-/));
    } finally {
      getComputedStyle.mockRestore();
    }
  });
});
