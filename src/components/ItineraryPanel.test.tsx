import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import type { RouteLeg } from '../domain/types';
import { ItineraryPanel } from './ItineraryPanel';

describe('ItineraryPanel', () => {
  it('shows a retry button for a failed driving route leg', async () => {
    const user = userEvent.setup();
    const origin = createDestination({
      name: 'Durmitor',
      countryRegion: 'Montenegro',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      countryRegion: 'Montenegro',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const failedRouteLeg: RouteLeg = {
      id: 'route-durmitor-kotor',
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'failed',
      error: 'OpenRouteService route calculation failed',
      notes: '',
      createdAt: '2026-07-03T12:00:00.000Z',
      updatedAt: '2026-07-03T12:00:00.000Z',
    };
    const onUpdateRouteLeg = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[failedRouteLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={onUpdateRouteLeg}
      />,
    );

    const retryButton = screen.getByRole('button', {
      name: 'Retry Durmitor to Kotor route calculation',
    });

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(retryButton).toHaveAttribute('title', 'Retry route calculation');

    await user.click(retryButton);

    expect(onUpdateRouteLeg).toHaveBeenCalledWith('route-durmitor-kotor', {
      type: 'driving-auto',
    });
  });
});
