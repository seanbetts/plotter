import { describe, expect, it } from 'vitest';
import { buildManualRouteGeometry } from './manualRouting';

describe('manual routing adapter', () => {
  it('returns straight-line geometry between coordinates', () => {
    const geometry = buildManualRouteGeometry(
      { lat: 51.5072, lng: -0.1276 },
      { lat: 48.8566, lng: 2.3522 },
    );

    expect(geometry.coordinates).toEqual([
      [-0.1276, 51.5072],
      [2.3522, 48.8566],
    ]);
  });
});
