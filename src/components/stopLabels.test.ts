import { describe, expect, it } from 'vitest';
import {
  formatStopAccessibleLabel,
  formatStopHeaderLabel,
  formatStopMarker,
} from './stopLabels';

describe('stopLabels', () => {
  it('labels the first and last stops while preserving middle numbering', () => {
    expect(formatStopMarker(1, 3)).toBe('ST');
    expect(formatStopMarker(2, 3)).toBe('02');
    expect(formatStopMarker(3, 3)).toBe('ED');
  });

  it('keeps a single stop labelled as the start', () => {
    expect(formatStopMarker(1, 1)).toBe('ST');
    expect(formatStopAccessibleLabel(1, 1)).toBe('Start');
    expect(formatStopHeaderLabel(1, 1)).toBe('Start');
  });

  it('uses End for the final stop accessible and header labels', () => {
    expect(formatStopAccessibleLabel(3, 3)).toBe('End');
    expect(formatStopHeaderLabel(3, 3)).toBe('End');
  });

  it('preserves numeric labels when a total is not supplied', () => {
    expect(formatStopMarker(3)).toBe('03');
    expect(formatStopAccessibleLabel(3)).toBe('Stop 3');
    expect(formatStopHeaderLabel(3)).toBe('Stop 03');
  });
});
