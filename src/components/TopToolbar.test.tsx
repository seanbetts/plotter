import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlaceSearchResult } from '../adapters/geocoding';
import { TopToolbar } from './TopToolbar';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

const balcombeResult = {
  kind: 'place',
  id: 'place-1',
  label: 'Balcombe, West Sussex, England, United Kingdom',
  coordinates: { lat: 51.0576, lng: -0.1342 },
  location: {
    placeName: 'Balcombe',
    regionName: 'West Sussex',
    countryName: 'United Kingdom',
    countryCode: 'gb',
    sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
    sourceProvider: 'maptiler',
    sourceFeatureId: 'place-1',
  },
} satisfies Extract<PlaceSearchResult, { kind: 'place' }>;

const parisResult = {
  kind: 'place',
  id: 'place-2',
  label: 'Paris, Ile-de-France, France',
  coordinates: { lat: 48.8566, lng: 2.3522 },
  location: {
    placeName: 'Paris',
    regionName: 'Ile-de-France',
    countryName: 'France',
    countryCode: 'fr',
    sourceLabel: 'Paris, Ile-de-France, France',
    sourceProvider: 'maptiler',
    sourceFeatureId: 'place-2',
  },
} satisfies Extract<PlaceSearchResult, { kind: 'place' }>;

describe('TopToolbar', () => {
  it('shows live search results and adds the selected result', async () => {
    const user = userEvent.setup();
    const onAddDestination = vi.fn();
    const searchPlaces = vi.fn().mockResolvedValue([balcombeResult]);
    render(
      <TopToolbar
        onAddDestination={onAddDestination}
        resolveSearchResult={vi.fn(async (result) => result as Extract<PlaceSearchResult, { kind: 'place' }>)}
        searchPlaces={searchPlaces}
      />,
    );

    await user.type(screen.getByLabelText('Search for a destination'), 'Balcombe');

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('Balcombe'));
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Balcombe, West Sussex, England, United Kingdom' }),
      ).toBeInTheDocument(),
    );
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onAddDestination).toHaveBeenCalledWith({
      name: 'Balcombe',
      location: balcombeResult.location,
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    expect(screen.getByLabelText('Search for a destination')).toHaveValue('');
  });

  it('moves through results with arrow keys and selects the highlighted option', async () => {
    const user = userEvent.setup();
    const onAddDestination = vi.fn();
    const searchPlaces = vi.fn().mockResolvedValue([balcombeResult, parisResult]);

    render(
      <TopToolbar
        onAddDestination={onAddDestination}
        resolveSearchResult={vi.fn(async (result) => result as Extract<PlaceSearchResult, { kind: 'place' }>)}
        searchPlaces={searchPlaces}
      />,
    );

    await user.type(screen.getByLabelText('Search for a destination'), 'B');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('B'));

    const firstOption = await screen.findByRole('option', {
      name: 'Balcombe, West Sussex, England, United Kingdom',
    });
    const secondOption = screen.getByRole('option', { name: 'Paris, Ile-de-France, France' });

    expect(firstOption).toHaveAttribute('aria-selected', 'false');
    expect(secondOption).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}');

    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    expect(secondOption).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onAddDestination).toHaveBeenCalledWith({
      name: 'Paris',
      location: parisResult.location,
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
  });

  it('keeps stale search responses from replacing newer results or loading state', async () => {
    const user = userEvent.setup();
    const firstSearch = deferred<PlaceSearchResult[]>();
    const secondSearch = deferred<PlaceSearchResult[]>();
    const searchPlaces = vi.fn().mockReturnValueOnce(firstSearch.promise).mockReturnValueOnce(secondSearch.promise);

    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        resolveSearchResult={vi.fn()}
        searchPlaces={searchPlaces}
      />,
    );

    const input = screen.getByLabelText('Search for a destination');
    await user.type(input, 'Paris');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('Paris'));
    await user.clear(input);
    await user.type(input, 'Seoul');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('Seoul'));

    firstSearch.resolve([
      {
        kind: 'place',
        id: 'place-paris',
        label: 'Paris, France',
        coordinates: { lat: 48.8566, lng: 2.3522 },
        location: {
          placeName: 'Paris',
          regionName: 'Ile-de-France',
          countryName: 'France',
          countryCode: 'fr',
          sourceLabel: 'Paris, France',
          sourceProvider: 'maptiler',
        },
      },
    ]);

    await waitFor(() => expect(screen.getByText('Searching...')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();

    secondSearch.resolve([
      {
        kind: 'place',
        id: 'place-seoul',
        label: 'Seoul, South Korea',
        coordinates: { lat: 37.5665, lng: 126.978 },
        location: {
          placeName: 'Seoul',
          regionName: '',
          countryName: 'South Korea',
          countryCode: 'kr',
          sourceLabel: 'Seoul, South Korea',
          sourceProvider: 'maptiler',
        },
      },
    ]);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Seoul, South Korea' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();
  });

  it('clears existing results when the latest search fails', async () => {
    const user = userEvent.setup();
    const searchPlaces = vi.fn().mockResolvedValueOnce([balcombeResult]).mockRejectedValueOnce(new Error('Search unavailable'));

    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        resolveSearchResult={vi.fn()}
        searchPlaces={searchPlaces}
      />,
    );

    const input = screen.getByLabelText('Search for a destination');
    await user.type(input, 'Balcombe');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('Balcombe'));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Balcombe, West Sussex, England, United Kingdom' })).toBeInTheDocument(),
    );

    await user.clear(input);
    await user.type(input, 'Ankara');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('Ankara'));

    await waitFor(() => expect(screen.getByText('Search unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Balcombe, West Sussex, England, United Kingdom' })).not.toBeInTheDocument();
  });

  it('resolves a selected coordinate result before adding it', async () => {
    const user = userEvent.setup();
    const onAddDestination = vi.fn();
    const coordinateResult = {
      kind: 'coordinates',
      id: 'coordinates:51.0576,-0.1342',
      label: 'Use coordinates 51.0576, -0.1342',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    } satisfies Extract<PlaceSearchResult, { kind: 'coordinates' }>;
    const searchPlaces = vi.fn().mockResolvedValue([coordinateResult]);

    render(
      <TopToolbar
        onAddDestination={onAddDestination}
        searchPlaces={searchPlaces}
        resolveSearchResult={vi.fn(async () => balcombeResult)}
      />,
    );

    await user.type(screen.getByLabelText('Search for a destination'), '51.0576, -0.1342');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith('51.0576, -0.1342'));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Use coordinates 51.0576, -0.1342' })).toBeInTheDocument(),
    );
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onAddDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Balcombe',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
    );
  });

  it('does not render temporary import and export controls', () => {
    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        resolveSearchResult={vi.fn()}
        searchPlaces={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import trip data' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trip data import file')).not.toBeInTheDocument();
  });
});
