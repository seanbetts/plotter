import Dexie from 'dexie';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { searchNominatimPlaces } from './adapters/geocoding';

const tripDbMock = vi.hoisted(() => ({
  name: `world-tour-app-test-${crypto.randomUUID()}`,
  db: null as import('./storage/tripDb').TripDb | null,
}));

const maplibreMock = vi.hoisted(() => {
  const project = vi.fn(([lng, lat]: [number, number]) => ({
    x: lng * 10 + 1000,
    y: lat * -10 + 500,
  }));
  const Map = vi.fn(function () {
    return {
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      project,
    };
  });
  const NavigationControl = vi.fn(function () {
    return {};
  });

  return { Map, NavigationControl, project };
});

vi.mock('./storage/tripDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage/tripDb')>();
  const db = actual.createTripDb(tripDbMock.name);
  tripDbMock.db = db;

  return {
    ...actual,
    tripDb: db,
  };
});

vi.mock('./adapters/geocoding', () => ({
  searchNominatimPlaces: vi.fn(),
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.Map,
    NavigationControl: maplibreMock.NavigationControl,
  },
}));

describe('App', () => {
  beforeEach(async () => {
    await tripDbMock.db?.destinations.clear();
    await tripDbMock.db?.routeLegs.clear();
    vi.mocked(searchNominatimPlaces).mockReset();
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.project.mockClear();
  });

  afterAll(async () => {
    tripDbMock.db?.close();
    await Dexie.delete(tripDbMock.name);
  });

  it('adds a searched destination and opens its profile', async () => {
    vi.mocked(searchNominatimPlaces).mockResolvedValue([
      {
        id: 'place-kyoto',
        label: 'Kyoto, Japan',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Kyoto');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Kyoto, Japan' }));

    expect(searchNominatimPlaces).toHaveBeenCalledWith('Kyoto');
    expect(await screen.findByRole('complementary', { name: 'Kyoto profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kyoto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Kyoto' })).toHaveClass('is-selected');
  });
});
