import { describe, expect, it } from 'vitest';
import { normalizePublicBasePath } from './publicBasePath';

describe('normalizePublicBasePath', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['/plotter', '/plotter/'],
    ['/plotter/', '/plotter/'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePublicBasePath(input)).toBe(expected);
  });

  it.each(['plotter', '//plotter', '/../plotter', '/plotter?bad=1', '/plotter#bad'])(
    'rejects unsafe base %s',
    (input) => {
      expect(() => normalizePublicBasePath(input)).toThrow('Invalid public base path');
    },
  );
});
