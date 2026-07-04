import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { beforeEach, vi } from 'vitest';

vi.stubEnv('VITE_ENABLE_MAP_DETAIL_DEV_TOOLS', 'true');

beforeEach(() => {
  class AutoLoadingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = true;
    decoding = 'auto';
    #src = '';

    get src() {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      this.onload?.();
    }
  }

  vi.stubGlobal('Image', AutoLoadingImage);
});
