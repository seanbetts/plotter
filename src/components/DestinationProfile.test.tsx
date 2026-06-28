import { render, screen, waitFor } from '@testing-library/react';
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

  it('edits destination summary, timing, and tags', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Why it matters'), 'Silk Road architecture.');
    await user.clear(screen.getByLabelText('Expected stay days'));
    await user.type(screen.getByLabelText('Expected stay days'), '5');
    await user.type(screen.getByLabelText('Tags'), 'silk-road, city');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        timing: expect.objectContaining({ expectedStayDays: 5 }),
        why: expect.objectContaining({ summary: 'Silk Road architecture.' }),
        tags: ['silk-road', 'city'],
      }),
    );
  });

  it('syncs fields when the destination changes and parses comma-separated lists', async () => {
    const user = userEvent.setup();
    const firstDestination: Destination = {
      ...createDestination({
        name: 'Kyoto',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      }),
      why: {
        summary: 'Temples and food.',
        highlights: '',
        personalRationale: '',
      },
    };
    const secondDestination: Destination = {
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
        highlights: '',
        personalRationale: '',
      },
      activities: {
        items: [{ id: 'activity-1', label: 'murals', category: 'street-art', notes: 'existing' }],
      },
      tags: ['street-art'],
    };
    const onUpdate = vi.fn();

    const { rerender } = render(
      <DestinationProfile destination={firstDestination} onUpdate={onUpdate} onClose={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText('Why it matters'));
    await user.type(screen.getByLabelText('Why it matters'), 'Unsaved draft');

    rerender(<DestinationProfile destination={secondDestination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Why it matters')).toHaveValue('Street art hills.'));
    expect(screen.getByLabelText('Ideal months')).toHaveValue('March');
    expect(screen.getByLabelText('Activities')).toHaveValue('murals');
    expect(screen.getByLabelText('Tags')).toHaveValue('street-art');

    await user.clear(screen.getByLabelText('Ideal months'));
    await user.type(screen.getByLabelText('Ideal months'), 'April,  May,, June ');
    await user.clear(screen.getByLabelText('Activities'));
    await user.type(screen.getByLabelText('Activities'), 'murals, seafood,, funiculars ');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenCalledWith(
      secondDestination.id,
      expect.objectContaining({
        timing: expect.objectContaining({ idealMonths: ['April', 'May', 'June'] }),
        activities: {
          items: [
            expect.objectContaining({ id: 'activity-1', label: 'murals', category: 'street-art', notes: 'existing' }),
            expect.objectContaining({ label: 'seafood', category: 'other', notes: '' }),
            expect.objectContaining({ label: 'funiculars', category: 'other', notes: '' }),
          ],
        },
      }),
    );
  });

  it('syncs same-id destination updates without wiping edits on same-version rerenders', async () => {
    const user = userEvent.setup();
    const destination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      why: {
        summary: 'Initial summary.',
        highlights: '',
        personalRationale: '',
      },
      updatedAt: '2026-06-28T09:00:00.000Z',
    };
    const onUpdate = vi.fn();

    const { rerender } = render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText('Why it matters'));
    await user.type(screen.getByLabelText('Why it matters'), 'Local draft');

    rerender(
      <DestinationProfile
        destination={{
          ...destination,
          why: {
            ...destination.why,
            highlights: 'Parent rerender with unchanged version.',
          },
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Why it matters')).toHaveValue('Local draft');

    rerender(
      <DestinationProfile
        destination={{
          ...destination,
          why: {
            ...destination.why,
            summary: 'Saved server summary.',
          },
          updatedAt: '2026-06-28T10:00:00.000Z',
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Why it matters')).toHaveValue('Saved server summary.');
  });

  it('preserves existing matching activities when saving unrelated profile fields', async () => {
    const user = userEvent.setup();
    const existingActivity = {
      id: 'activity-1',
      label: 'murals',
      category: 'street-art' as const,
      notes: 'Bring camera.',
    };
    const destination: Destination = {
      ...createDestination({
        name: 'Valparaiso',
        countryRegion: 'Chile',
        coordinates: { lat: -33.0472, lng: -71.6127 },
      }),
      activities: {
        items: [existingActivity],
      },
      tags: ['street-art'],
    };
    const onUpdate = vi.fn();

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Why it matters'), 'Painted hills.');
    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'street-art, port-city');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        activities: {
          items: [existingActivity],
        },
        tags: ['street-art', 'port-city'],
      }),
    );
  });

  it('does not resurrect an unsaved draft when switching away and back to the same destination version', async () => {
    const user = userEvent.setup();
    const firstDestination: Destination = {
      ...createDestination({
        name: 'Kyoto',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      }),
      why: {
        summary: 'Original Kyoto summary.',
        highlights: '',
        personalRationale: '',
      },
      updatedAt: '2026-06-28T09:00:00.000Z',
    };
    const secondDestination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      why: {
        summary: 'Samarkand summary.',
        highlights: '',
        personalRationale: '',
      },
      updatedAt: '2026-06-28T09:05:00.000Z',
    };

    const { rerender } = render(
      <DestinationProfile destination={firstDestination} onUpdate={vi.fn()} onClose={vi.fn()} />,
    );

    await user.clear(screen.getByLabelText('Why it matters'));
    await user.type(screen.getByLabelText('Why it matters'), 'Unsaved Kyoto draft');

    rerender(<DestinationProfile destination={secondDestination} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Why it matters')).toHaveValue('Samarkand summary.');

    rerender(<DestinationProfile destination={firstDestination} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Why it matters')).toHaveValue('Original Kyoto summary.');
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

    await user.type(screen.getByLabelText('Why it matters'), 'Silk Road architecture.');
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

    await user.type(screen.getByLabelText('Why it matters'), 'Silk Road architecture.');
    await user.click(screen.getByRole('button', { name: 'Save destination' }));

    await waitFor(() => expect(screen.getByText('Destination saved')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
  });
});
