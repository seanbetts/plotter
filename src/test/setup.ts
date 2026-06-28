import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

vi.stubEnv('VITE_ENABLE_MAP_DETAIL_DEV_TOOLS', 'true');
