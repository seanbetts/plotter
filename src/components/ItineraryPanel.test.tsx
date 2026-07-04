import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import type { RouteLeg } from '../domain/types';
import { ItineraryPanel } from './ItineraryPanel';

describe('ItineraryPanel', () => {
  it('can render as a collapsed same-panel summary', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Brest',
      countryRegion: 'France',
      coordinates: { lat: 48.3904, lng: -4.4861 },
    });
    const onToggleCollapsed = vi.fn();

    render(
      <ItineraryPanel
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        isCollapsed
        onToggleCollapsed={onToggleCollapsed}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Itinerary')).toHaveClass('is-collapsed');
    expect(screen.getByText('1 stop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brest, France' })).not.toBeInTheDocument();

    const expandButton = screen.getByRole('button', { name: 'Expand itinerary panel' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(expandButton);

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

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
