import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import type { Destination } from '../domain/types';
import { DestinationProfile } from './DestinationProfile';

describe('DestinationProfile', () => {
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
            expect.objectContaining({ label: 'murals', category: 'other', notes: '' }),
            expect.objectContaining({ label: 'seafood', category: 'other', notes: '' }),
            expect.objectContaining({ label: 'funiculars', category: 'other', notes: '' }),
          ],
        },
      }),
    );
  });
});
