import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TopToolbar } from './TopToolbar';

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
  });
});
