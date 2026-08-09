import { clampOverlayPosition, getAvailableOverlayHeight } from './overlayGeometry';

describe('map overlay geometry', () => {
  it('clamps to the map stage rather than browser height', () => {
    expect(clampOverlayPosition(
      { x: 990, y: 690 },
      { width: 320, height: 260 },
      { width: 1000, height: 700 },
    )).toEqual({ x: 664, y: 424 });
  });

  it('reports space below the clamped stage-relative top edge', () => {
    expect(getAvailableOverlayHeight(
      { x: 664, y: 424 },
      { width: 1000, height: 700 },
    )).toBe(260);
  });

  it('keeps the minimum padding when the overlay exceeds the stage', () => {
    expect(clampOverlayPosition(
      { x: 40, y: 40 },
      { width: 500, height: 500 },
      { width: 320, height: 240 },
    )).toEqual({ x: 16, y: 16 });
  });
});
