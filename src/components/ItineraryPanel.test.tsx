import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
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
    destination.timing.expectedStayDays = 3;
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
    const summary = screen.getByLabelText('Itinerary summary');
    expect(within(summary).getByText('1 stop')).toBeInTheDocument();
    expect(within(summary).getByText('3 days')).toBeInTheDocument();
    expect(within(summary).getByText('0 hrs travel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brest, France' })).not.toBeInTheDocument();

    const expandButton = screen.getByRole('button', { name: 'Expand itinerary panel' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(expandButton);

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('uses the compact stop address in itinerary rows', () => {
    const destination = createDestination({
      name: 'Brest',
      coordinates: { lat: 48.3904, lng: -4.4861 },
      location: {
        placeName: 'Brest',
        regionName: 'Finistere',
        countryName: 'France',
        countryCode: 'fr',
        sourceLabel: 'Brest, Finistere, France',
        sourceProvider: 'maptiler',
      },
    });

    render(
      <ItineraryPanel
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    const stopButton = screen.getByRole('button', { name: 'Brest, Finistere, France' });
    expect(within(stopButton).getByText('Finistere, France')).toBeInTheDocument();
    expect(within(stopButton).queryByText('Brest, Finistere, France')).not.toBeInTheDocument();
  });

  it('converts the total travel summary into days and hours', () => {
    const origin = createDestination({
      name: 'Brest',
      countryRegion: 'France',
      coordinates: { lat: 48.3904, lng: -4.4861 },
    });
    const middle = createDestination({
      name: 'Bordeaux',
      countryRegion: 'France',
      coordinates: { lat: 44.8378, lng: -0.5792 },
    });
    const target = createDestination({
      name: 'Santander',
      countryRegion: 'Spain',
      coordinates: { lat: 43.4623, lng: -3.8099 },
    });

    render(
      <ItineraryPanel
        destinations={[origin, middle, target]}
        routeLegs={[
          createRouteLeg({
            originDestinationId: origin.id,
            targetDestinationId: middle.id,
            type: 'driving-auto',
            status: 'ready',
            travelTimeHours: 24,
          }),
          createRouteLeg({
            originDestinationId: middle.id,
            targetDestinationId: target.id,
            type: 'driving-auto',
            status: 'ready',
            travelTimeHours: 25.4,
          }),
        ]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    const summary = screen.getByLabelText('Itinerary summary');
    expect(within(summary).getByText('2 days 1 hr travel')).toBeInTheDocument();
  });

  it('shows exceptional route indicators only when present and excludes review-required metrics from totals', () => {
    const origin = createDestination({ name: 'Dover', coordinates: { lat: 51.1279, lng: 1.3134 }, order: 0 });
    const middle = createDestination({ name: 'Calais', coordinates: { lat: 50.9513, lng: 1.8587 }, order: 1 });
    const target = createDestination({ name: 'Paris', coordinates: { lat: 48.8566, lng: 2.3522 }, order: 2 });
    const waypoint = {
      id: 'waypoint-folkestone',
      order: 0,
      name: 'Folkestone terminal',
      coordinates: { lat: 51.095, lng: 1.121 },
      location: origin.location,
      notes: '',
      links: [],
    };
    const reviewRequiredLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: middle.id,
      type: 'driving-auto',
      status: 'review-required',
      distanceKm: 135,
      travelTimeHours: 10,
      waypoints: [waypoint],
      sections: [{ kind: 'ferry', startGeometryIndex: 2, endGeometryIndex: 8, distanceKm: 42 }],
      warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'Route is much longer than expected.' }],
    });
    const ordinaryLeg = createRouteLeg({
      originDestinationId: middle.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 290,
      travelTimeHours: 3,
    });

    render(
      <ItineraryPanel
        destinations={[origin, middle, target]}
        routeLegs={[reviewRequiredLeg, ordinaryLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Route includes a ferry')).toHaveAttribute('title', 'Route includes a ferry');
    expect(screen.getByLabelText('1 route waypoint')).toHaveAttribute('title', '1 route waypoint');
    expect(screen.getByLabelText(/Route requires review/)).toHaveAttribute(
      'title',
      'Route requires review: Route is much longer than expected.',
    );
    expect(within(screen.getByLabelText('Itinerary summary')).getByText('3 hrs travel')).toBeInTheDocument();

    const ordinaryRoute = screen.getByText('180 mi').closest('.inline-route-leg');
    expect(ordinaryRoute).not.toBeNull();
    expect(within(ordinaryRoute as HTMLElement).queryByLabelText('Route includes a ferry')).not.toBeInTheDocument();
    expect(within(ordinaryRoute as HTMLElement).queryByLabelText(/route waypoint/)).not.toBeInTheDocument();
    expect(within(ordinaryRoute as HTMLElement).queryByLabelText(/Route requires review/)).not.toBeInTheDocument();
  });

  it('excludes failed route metrics from totals and labels the failure warning', () => {
    const origin = createDestination({ name: 'Dover', coordinates: { lat: 51.1279, lng: 1.3134 }, order: 0 });
    const target = createDestination({ name: 'Calais', coordinates: { lat: 50.9513, lng: 1.8587 }, order: 1 });
    const failedLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'failed',
      distanceKm: 500,
      travelTimeHours: 10,
      error: 'Required ferry section was not returned.',
      warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Required ferry section was not returned.' }],
    });

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[failedLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    expect(within(screen.getByLabelText('Itinerary summary')).getByText('0 hrs travel')).toBeInTheDocument();
    expect(screen.getByLabelText('Route failed: Required ferry section was not returned.')).toHaveAttribute(
      'title',
      'Route failed: Required ferry section was not returned.',
    );
  });

  it('pluralises inline route hours at two displayed hours and above', () => {
    const origin = createDestination({
      name: 'Brest',
      countryRegion: 'France',
      coordinates: { lat: 48.3904, lng: -4.4861 },
    });
    const middle = createDestination({
      name: 'Bordeaux',
      countryRegion: 'France',
      coordinates: { lat: 44.8378, lng: -0.5792 },
    });
    const target = createDestination({
      name: 'Santander',
      countryRegion: 'Spain',
      coordinates: { lat: 43.4623, lng: -3.8099 },
    });

    render(
      <ItineraryPanel
        destinations={[origin, middle, target]}
        routeLegs={[
          createRouteLeg({
            originDestinationId: origin.id,
            targetDestinationId: middle.id,
            type: 'driving-auto',
            status: 'ready',
            travelTimeHours: 1.9,
          }),
          createRouteLeg({
            originDestinationId: middle.id,
            targetDestinationId: target.id,
            type: 'driving-auto',
            status: 'ready',
            travelTimeHours: 2,
          }),
        ]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    expect(screen.getByText('1.9 hr')).toBeInTheDocument();
    expect(screen.getByText('2.0 hrs')).toBeInTheDocument();
  });

  it('shows an icon-only edit route button for driving route rows', async () => {
    const user = userEvent.setup();
    const origin = createDestination({
      name: 'Bilbao',
      countryRegion: 'Spain',
      coordinates: { lat: 43.263, lng: -2.935 },
    });
    const target = createDestination({
      name: 'Porto',
      countryRegion: 'Portugal',
      coordinates: { lat: 41.1579, lng: -8.6291 },
    });
    const routeLeg = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 715,
        travelTimeHours: 7.6,
      }),
      id: 'route-bilbao-porto',
    };
    const onEditRouteLeg = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
        onEditRouteLeg={onEditRouteLeg}
      />,
    );

    const editButton = screen.getByRole('button', { name: 'Edit route from Bilbao to Porto' });

    expect(editButton).toHaveAttribute('title', 'Edit route');
    expect(editButton).not.toHaveTextContent('Edit');

    await user.click(editButton);

    expect(onEditRouteLeg).toHaveBeenCalledWith('route-bilbao-porto');
  });

  it('does not show the edit route button for shipping/manual route rows', () => {
    const origin = createDestination({
      name: 'Panama City',
      countryRegion: 'Panama',
      coordinates: { lat: 8.9824, lng: -79.5199 },
    });
    const target = createDestination({
      name: 'Cartagena',
      countryRegion: 'Colombia',
      coordinates: { lat: 10.391, lng: -75.4794 },
    });
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'shipping-manual',
      status: 'manual',
    });

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
        onEditRouteLeg={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit route from Panama City to Cartagena' }),
    ).not.toBeInTheDocument();
  });

  it('does not show the edit route button without an edit handler', () => {
    const origin = createDestination({
      name: 'Bilbao',
      countryRegion: 'Spain',
      coordinates: { lat: 43.263, lng: -2.935 },
    });
    const target = createDestination({
      name: 'Porto',
      countryRegion: 'Portugal',
      coordinates: { lat: 41.1579, lng: -8.6291 },
    });
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
    });

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit route from Bilbao to Porto' }),
    ).not.toBeInTheDocument();
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
