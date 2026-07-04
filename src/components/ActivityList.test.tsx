import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlaceSearchResult } from '../adapters/geocoding';
import { createActivity } from '../domain/activities';
import { ActivityList } from './ActivityList';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

const louvreSearchResult = {
  kind: 'place',
  id: 'poi.123',
  label: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
  coordinates: { lat: 48.8606, lng: 2.3364 },
  location: {
    placeName: 'Louvre Museum',
    regionName: 'Ile-de-France',
    countryName: 'France',
    countryCode: 'fr',
    sourceLabel: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
    sourceProvider: 'maptiler',
    sourceFeatureId: 'poi.123',
  },
  placeTypes: ['poi'],
  placeTypeNames: ['Museum'],
  address: 'Rue de Rivoli',
  context: [
    { id: 'place.1', text: 'Paris' },
    { id: 'country.1', text: 'France', shortCode: 'fr' },
  ],
  distanceFromProximityKm: 1.3,
} satisfies Extract<PlaceSearchResult, { kind: 'place' }>;

describe('ActivityList', () => {
  it('renders an empty state and manually adds an activity', async () => {
    const user = userEvent.setup();
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        searchActivities={vi.fn().mockResolvedValue([])}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    expect(screen.getByText('No activities yet')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search for an activity'), 'Bakery crawl');
    await user.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(onCreateActivity).toHaveBeenCalledWith({ title: 'Bakery crawl' });
    await waitFor(() => expect(screen.getByLabelText('Search for an activity')).toHaveValue(''));
  });

  it('submits a manually typed activity with Enter when no result is highlighted', async () => {
    const user = userEvent.setup();
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        searchActivities={vi.fn().mockResolvedValue([])}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Search for an activity'), 'Bakery crawl{Enter}');

    expect(onCreateActivity).toHaveBeenCalledWith({ title: 'Bakery crawl' });
    await waitFor(() => expect(screen.getByLabelText('Search for an activity')).toHaveValue(''));
  });

  it('clears stale search results and searching status after manual creation', async () => {
    const user = userEvent.setup();
    const pendingSearch = deferred<PlaceSearchResult[]>();
    const onCreateActivity = vi.fn();
    const searchActivities = vi
      .fn()
      .mockResolvedValueOnce([louvreSearchResult])
      .mockReturnValueOnce(pendingSearch.promise);

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        searchActivities={searchActivities}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Search for an activity');
    await user.type(input, 'Louvre');
    await screen.findByRole('option', {
      name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
    });

    await user.type(input, 'x');
    await waitFor(() => expect(searchActivities).toHaveBeenCalledWith('Louvrex'));
    await screen.findByText('Searching...');
    await user.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(onCreateActivity).toHaveBeenCalledWith({ title: 'Louvrex' });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.queryByRole('option', {
      name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
    })).not.toBeInTheDocument();
    expect(screen.queryByText('Searching...')).not.toBeInTheDocument();
  });

  it('renders activity search result detail and creates a located activity from selection', async () => {
    const user = userEvent.setup();
    const onCreateActivity = vi.fn();
    const searchActivities = vi.fn().mockResolvedValue([louvreSearchResult]);

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        searchActivities={searchActivities}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Search for an activity'), 'Louvre');

    await waitFor(() => expect(searchActivities).toHaveBeenCalledWith('Louvre'));
    const result = await screen.findByRole('option', {
      name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
    });
    expect(result).toHaveTextContent('Museum');
    expect(result).toHaveTextContent('Rue de Rivoli');
    expect(result).toHaveTextContent('1.3 km');

    await user.click(result);

    expect(onCreateActivity).toHaveBeenCalledWith({
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });
  });

  it('selects, reorders, and deletes activities without inline title editing', () => {
    const louvre = createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0 });
    const bakery = createActivity({ destinationId: 'destination-1', title: 'Bakery crawl', order: 1 });
    const onSelectActivity = vi.fn();
    const onDeleteActivity = vi.fn();
    const onReorderActivities = vi.fn();

    render(
      <ActivityList
        activities={[louvre, bakery]}
        selectedActivityId={bakery.id}
        onSelectActivity={onSelectActivity}
        onCreateActivity={vi.fn()}
        searchActivities={vi.fn().mockResolvedValue([])}
        onDeleteActivity={onDeleteActivity}
        onReorderActivities={onReorderActivities}
      />,
    );

    expect(screen.getByRole('button', { name: 'Move Louvre up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Bakery crawl down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select activity Bakery crawl' })).toHaveClass(
      'is-selected',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select activity Louvre' }));
    expect(onSelectActivity).toHaveBeenCalledWith(louvre.id);
    expect(screen.getByRole('button', { name: 'Select activity Louvre' })).toHaveTextContent('Louvre');
    expect(screen.queryByDisplayValue('Louvre')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move Bakery crawl up' }));
    expect(onReorderActivities).toHaveBeenCalledWith([bakery.id, louvre.id]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Bakery crawl' }));
    expect(onDeleteActivity).toHaveBeenCalledWith(bakery.id);
  });

  it('renders the activity search before the existing activity list', () => {
    const louvre = createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0 });

    render(
      <ActivityList
        activities={[louvre]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={vi.fn()}
        searchActivities={vi.fn().mockResolvedValue([])}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    const searchInput = screen.getByLabelText('Search for an activity');
    const activityRow = screen.getByRole('button', { name: 'Select activity Louvre' });
    expect(searchInput.compareDocumentPosition(activityRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('only marks the selected activity select control as selected', () => {
    const louvre = createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0 });

    render(
      <ActivityList
        activities={[louvre]}
        selectedActivityId={louvre.id}
        onSelectActivity={vi.fn()}
        onCreateActivity={vi.fn()}
        searchActivities={vi.fn().mockResolvedValue([])}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select activity Louvre' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: 'Select activity Louvre' }).closest('li')).not.toHaveClass(
      'is-selected',
    );
  });
});
