import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import type { Destination } from '../domain/types';
import { DestinationProfile } from './DestinationProfile';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe('DestinationProfile', () => {
  it('shows the stop name with the location below it', () => {
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    render(<DestinationProfile destination={destination} onUpdate={vi.fn()} onClose={vi.fn()} />);

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    expect(within(header).getByRole('button', { name: 'Edit stop name Balcombe' })).toBeInTheDocument();
    expect(within(header).getByText('Balcombe, West Sussex, United Kingdom')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stop name')).not.toBeInTheDocument();
  });

  it('only shows editable fields for stay days and tags until the stop name is clicked', () => {
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });

    render(<DestinationProfile destination={destination} onUpdate={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Expected stay days')).toBeInTheDocument();
    expect(screen.getByLabelText('Tags')).toBeInTheDocument();
    expect(screen.queryByLabelText('Why it matters')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Highlights')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Personal rationale')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ideal months')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Research notes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Activities')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Route notes')).not.toBeInTheDocument();
  });

  it('saves an edited stop name without changing location fields', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit stop name Balcombe' }));
    const input = screen.getByLabelText('Stop name');
    await user.clear(input);
    await user.type(input, 'Home');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        name: 'Home',
        location: destination.location,
      }),
    );
  });

  it('edits timing and tags without overwriting hidden detail fields', async () => {
    const user = userEvent.setup();
    const destination: Destination = {
      ...createDestination({
        name: 'Valparaiso',
        countryRegion: 'Chile',
        coordinates: { lat: -33.0472, lng: -71.6127 },
      }),
      timing: {
        idealMonths: ['March'],
        expectedStayDays: 4,
        provisionalStartDate: '',
        provisionalEndDate: '',
      },
      why: {
        summary: 'Street art hills.',
        highlights: 'Murals',
        personalRationale: 'Architecture',
      },
      research: {
        notes: 'Keep this note.',
        links: [],
        bookReferences: [],
      },
      activities: {
        items: [{ id: 'activity-1', label: 'murals', category: 'street-art', notes: 'existing' }],
      },
      routeContext: {
        previousNextNotes: '',
        drivingNotes: '',
        borderShippingNotes: '',
        notes: 'Keep route note.',
      },
      tags: ['street-art'],
    };
    const onUpdate = vi.fn();

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Expected stay days'));
    await user.type(screen.getByLabelText('Expected stay days'), '5');
    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'street-art, port-city');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        timing: {
          ...destination.timing,
          expectedStayDays: 5,
        },
        tags: ['street-art', 'port-city'],
      }),
    );
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('why');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('research');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('activities');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('routeContext');
  });

  it('syncs same-id destination updates without wiping edits on same-version rerenders', async () => {
    const user = userEvent.setup();
    const destination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      tags: ['silk-road'],
      updatedAt: '2026-06-28T09:00:00.000Z',
    };
    const onUpdate = vi.fn();

    const { rerender } = render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'local-draft');

    rerender(
      <DestinationProfile
        destination={{
          ...destination,
          timing: {
            ...destination.timing,
            expectedStayDays: 6,
          },
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Tags')).toHaveValue('local-draft');

    rerender(
      <DestinationProfile
        destination={{
          ...destination,
          tags: ['saved-tag'],
          updatedAt: '2026-06-28T10:00:00.000Z',
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Tags')).toHaveValue('saved-tag');
  });

  it('does not resurrect an unsaved draft when switching away and back to the same destination version', async () => {
    const user = userEvent.setup();
    const firstDestination: Destination = {
      ...createDestination({
        name: 'Kyoto',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      }),
      tags: ['temples'],
      updatedAt: '2026-06-28T09:00:00.000Z',
    };
    const secondDestination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      tags: ['silk-road'],
      updatedAt: '2026-06-28T09:05:00.000Z',
    };

    const { rerender } = render(
      <DestinationProfile destination={firstDestination} onUpdate={vi.fn()} onClose={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'unsaved-draft');

    rerender(<DestinationProfile destination={secondDestination} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Tags')).toHaveValue('silk-road');

    rerender(<DestinationProfile destination={firstDestination} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Tags')).toHaveValue('temples');
  });

  it('normalizes expected stay days to a positive whole number', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Expected stay days'));
    await user.type(screen.getByLabelText('Expected stay days'), '-2');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenLastCalledWith(
      destination.id,
      expect.objectContaining({
        timing: expect.objectContaining({ expectedStayDays: 1 }),
      }),
    );

    await user.clear(screen.getByLabelText('Expected stay days'));
    await user.type(screen.getByLabelText('Expected stay days'), '4.8');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenLastCalledWith(
      destination.id,
      expect.objectContaining({
        timing: expect.objectContaining({ expectedStayDays: 4 }),
      }),
    );
  });

  it('shows saving and saved feedback after saving destination changes', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const save = deferred<void>();
    const onUpdate = vi.fn(() => save.promise);

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'silk-road');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    save.resolve();

    await waitFor(() => expect(screen.getByText('Destination saved')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
  });

  it('keeps saved feedback visible when the saved destination version updates', async () => {
    const user = userEvent.setup();
    const destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      updatedAt: '2026-06-28T09:00:00.000Z',
    };

    function ProfileHarness() {
      const [currentDestination, setCurrentDestination] = useState(destination);

      return (
        <DestinationProfile
          destination={currentDestination}
          onUpdate={(_, patch) => {
            setCurrentDestination({
              ...currentDestination,
              ...patch,
              updatedAt: '2026-06-28T10:00:00.000Z',
            });
          }}
          onClose={vi.fn()}
        />
      );
    }

    render(<ProfileHarness />);

    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'silk-road');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    await waitFor(() => expect(screen.getByText('Destination saved')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
  });
});
