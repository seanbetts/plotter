import { describe, expect, it, vi } from 'vitest';

import {
  readMigratedStorageValue,
  removeStorageValue,
  writeStorageValue,
} from './localPreferences';

describe('local preference storage', () => {
  it('prefers the current key without touching the legacy value', () => {
    const values = new Map([
      ['plotter:key', 'current'],
      ['world-tour:key', 'legacy'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };

    expect(readMigratedStorageValue(storage, 'plotter:key', 'world-tour:key')).toBe('current');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('copies a legacy value forward while retaining the legacy key', () => {
    const values = new Map([['world-tour:key', 'legacy']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    expect(readMigratedStorageValue(storage, 'plotter:key', 'world-tour:key')).toBe('legacy');
    expect(values.get('plotter:key')).toBe('legacy');
    expect(values.get('world-tour:key')).toBe('legacy');
  });

  it('treats unavailable or restricted storage as best effort', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readMigratedStorageValue(storage, 'plotter:key', 'world-tour:key')).toBeNull();
    expect(() => writeStorageValue(storage, 'plotter:key', 'value')).not.toThrow();
    expect(() => removeStorageValue(storage, 'plotter:key')).not.toThrow();
  });
});
