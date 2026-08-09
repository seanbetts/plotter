export type OverlayPoint = { x: number; y: number };
export type OverlaySize = { width: number; height: number };
export type OverlayViewport = { width: number; height: number };

const defaultPadding = 16;

export function clampOverlayPosition(
  position: OverlayPoint,
  size: OverlaySize,
  viewport: OverlayViewport,
  padding = defaultPadding,
): OverlayPoint {
  return {
    x: Math.min(
      Math.max(padding, position.x),
      Math.max(padding, viewport.width - size.width - padding),
    ),
    y: Math.min(
      Math.max(padding, position.y),
      Math.max(padding, viewport.height - size.height - padding),
    ),
  };
}

export function getAvailableOverlayHeight(
  position: OverlayPoint,
  viewport: OverlayViewport,
  padding = defaultPadding,
): number {
  return Math.max(padding, viewport.height - position.y - padding);
}
