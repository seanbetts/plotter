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

describe('TopToolbar', () => {
  it('searches places and adds the selected result', async () => {
    const onAddDestination = vi.fn();
    render(
      <TopToolbar
        onAddDestination={onAddDestination}
        onExport={vi.fn()}
        onImportText={vi.fn()}
        searchPlaces={vi.fn().mockResolvedValue([
          {
            id: 'place-1',
            label: 'Istanbul, Turkey',
            countryRegion: 'Turkey',
            coordinates: { lat: 41.0082, lng: 28.9784 },
          },
        ])}
      />,
    );

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Istanbul');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Istanbul, Turkey' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add Istanbul, Turkey' }));

    expect(onAddDestination).toHaveBeenCalledWith({
      name: 'Istanbul',
      countryRegion: 'Turkey',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    expect(screen.getByLabelText('Search for a destination')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Add Istanbul, Turkey' })).not.toBeInTheDocument();
  });

  it('keeps stale search responses from replacing newer results or loading state', async () => {
    const user = userEvent.setup();
    const firstSearch = deferred<PlaceSearchResult[]>();
    const secondSearch = deferred<PlaceSearchResult[]>();
    const searchPlaces = vi.fn().mockReturnValueOnce(firstSearch.promise).mockReturnValueOnce(secondSearch.promise);

    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        onExport={vi.fn()}
        onImportText={vi.fn()}
        searchPlaces={searchPlaces}
      />,
    );

    const input = screen.getByLabelText('Search for a destination');
    await user.type(input, 'Paris');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.clear(input);
    await user.type(input, 'Seoul');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    firstSearch.resolve([
      {
        id: 'place-1',
        label: 'Paris, France',
        countryRegion: 'France',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      },
    ]);

    await waitFor(() => expect(screen.getByText('Searching...')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add Paris, France' })).not.toBeInTheDocument();

    secondSearch.resolve([
      {
        id: 'place-2',
        label: 'Seoul, South Korea',
        countryRegion: 'South Korea',
        coordinates: { lat: 37.5665, lng: 126.978 },
      },
    ]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Seoul, South Korea' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add Paris, France' })).not.toBeInTheDocument();
  });

  it('clears existing results when the latest search fails', async () => {
    const user = userEvent.setup();
    const searchPlaces = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'place-1',
          label: 'Istanbul, Turkey',
          countryRegion: 'Turkey',
          coordinates: { lat: 41.0082, lng: 28.9784 },
        },
      ])
      .mockRejectedValueOnce(new Error('Search unavailable'));

    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        onExport={vi.fn()}
        onImportText={vi.fn()}
        searchPlaces={searchPlaces}
      />,
    );

    const input = screen.getByLabelText('Search for a destination');
    await user.type(input, 'Istanbul');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Istanbul, Turkey' })).toBeInTheDocument());

    await user.clear(input);
    await user.type(input, 'Ankara');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Search unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add Istanbul, Turkey' })).not.toBeInTheDocument();
  });

  it('clears a failed import selection so the same file can be retried', async () => {
    const user = userEvent.setup();
    const onImportText = vi.fn().mockRejectedValue(new Error('Invalid trip data'));
    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        onExport={vi.fn()}
        onImportText={onImportText}
        searchPlaces={vi.fn()}
      />,
    );
    const file = new File(['not json'], 'trip.json', { type: 'application/json' });
    const input = screen.getByLabelText('Trip data import file');

    await user.upload(input, file);
    await waitFor(() => expect(onImportText).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input).toHaveValue(''));

    await user.upload(input, file);

    await waitFor(() => expect(onImportText).toHaveBeenCalledTimes(2));
  });

  it('opens the import file picker from a keyboard-operable button', async () => {
    const user = userEvent.setup();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        onExport={vi.fn()}
        onImportText={vi.fn()}
        searchPlaces={vi.fn()}
      />,
    );

    const importButton = screen.getByRole('button', { name: 'Import trip data' });
    importButton.focus();
    await user.keyboard('{Enter}');

    expect(inputClick).toHaveBeenCalled();
    inputClick.mockRestore();
  });
});
