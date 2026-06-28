import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { ItineraryPanel } from './ItineraryPanel';
import { RouteLegEditor } from './RouteLegEditor';

describe('RouteLegEditor', () => {
  it('creates a ferry/shipping route leg between two destinations', async () => {
    const user = userEvent.setup();
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
    const onCreateRouteLeg = vi.fn();

    render(<RouteLegEditor destinations={[origin, target]} onCreateRouteLeg={onCreateRouteLeg} />);

    expect(screen.getAllByRole('option', { name: 'Panama City - Panama' })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: 'Cartagena - Colombia' })).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('Origin'), origin.id);
    await user.selectOptions(screen.getByLabelText('Target'), target.id);
    await user.selectOptions(screen.getByLabelText('Leg type'), 'shipping-manual');
    await user.type(screen.getByLabelText('Route notes'), 'Darien Gap shipping leg.');
    await user.click(screen.getByRole('button', { name: 'Add route leg' }));

    expect(onCreateRouteLeg).toHaveBeenCalledWith({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'shipping-manual',
      notes: 'Darien Gap shipping leg.',
    });
    expect(screen.getByLabelText('Route notes')).toHaveValue('');
  });

  it('does not create a route leg without two different destinations', async () => {
    const user = userEvent.setup();
    const destination = createDestination({ name: 'Lisbon', coordinates: { lat: 38.7223, lng: -9.1393 } });
    const onCreateRouteLeg = vi.fn();

    render(<RouteLegEditor destinations={[destination]} onCreateRouteLeg={onCreateRouteLeg} />);

    await user.click(screen.getByRole('button', { name: 'Add route leg' }));
    expect(onCreateRouteLeg).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Origin'), destination.id);
    await user.selectOptions(screen.getByLabelText('Target'), destination.id);
    await user.click(screen.getByRole('button', { name: 'Add route leg' }));

    expect(onCreateRouteLeg).not.toHaveBeenCalled();
  });

  it('does not create a route leg when a selected destination is removed', async () => {
    const user = userEvent.setup();
    const origin = createDestination({ name: 'Lagos', coordinates: { lat: 6.5244, lng: 3.3792 } });
    const target = createDestination({ name: 'Accra', coordinates: { lat: 5.6037, lng: -0.187 } });
    const replacement = createDestination({ name: 'Dakar', coordinates: { lat: 14.7167, lng: -17.4677 } });
    const onCreateRouteLeg = vi.fn();

    const { rerender } = render(
      <RouteLegEditor destinations={[origin, target]} onCreateRouteLeg={onCreateRouteLeg} />,
    );

    await user.selectOptions(screen.getByLabelText('Origin'), origin.id);
    await user.selectOptions(screen.getByLabelText('Target'), target.id);

    rerender(<RouteLegEditor destinations={[origin, replacement]} onCreateRouteLeg={onCreateRouteLeg} />);
    await user.click(screen.getByRole('button', { name: 'Add route leg' }));

    expect(onCreateRouteLeg).not.toHaveBeenCalled();
  });

  it('labels destinations without a region as unassigned in route selects', () => {
    const destination = createDestination({ name: 'Springfield', coordinates: { lat: 39.7817, lng: -89.6501 } });

    render(<RouteLegEditor destinations={[destination]} onCreateRouteLeg={vi.fn()} />);

    expect(screen.getAllByRole('option', { name: 'Springfield - Unassigned region' })).toHaveLength(2);
  });
});

describe('ItineraryPanel', () => {
  it('renders stops with inline route leg summaries in miles', async () => {
    const user = userEvent.setup();
    const origin = createDestination({
      name: 'Istanbul',
      countryRegion: 'Turkey',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    const target = createDestination({
      name: 'Tbilisi',
      countryRegion: 'Georgia',
      coordinates: { lat: 41.7151, lng: 44.8271 },
    });
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 160,
      travelTimeHours: 2.25,
    });
    const onSelectDestination = vi.fn();
    const onDeleteDestination = vi.fn();
    const onReorderDestinations = vi.fn();
    const onUpdateRouteLeg = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={target.id}
        onSelectDestination={onSelectDestination}
        onDeleteDestination={onDeleteDestination}
        onReorderDestinations={onReorderDestinations}
        onUpdateRouteLeg={onUpdateRouteLeg}
      />,
    );

    expect(screen.getByLabelText('Itinerary')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stops' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Routes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Istanbul Turkey' })).toBeInTheDocument();
    expect(screen.queryByText('01')).not.toBeInTheDocument();
    const selectedStop = screen.getByRole('button', { name: 'Tbilisi Georgia' });
    expect(selectedStop).toHaveAttribute('aria-current', 'location');
    expect(selectedStop.closest('.stop-item')).toHaveClass('is-selected');
    expect(screen.queryByText('1 route leg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add route leg' })).not.toBeInTheDocument();
    expect(screen.getByText('99 mi')).toBeInTheDocument();
    expect(screen.getByText('2.3 hr')).toBeInTheDocument();
    expect(screen.getByText('99 mi').parentElement).toHaveClass('inline-route-metrics');

    await user.click(screen.getByRole('button', { name: 'Istanbul Turkey' }));

    expect(onSelectDestination).toHaveBeenCalledWith(origin.id);

    await user.click(screen.getByRole('button', { name: 'Delete Istanbul' }));

    expect(onDeleteDestination).toHaveBeenCalledWith(origin.id);
    expect(onSelectDestination).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Set Istanbul to Tbilisi to shipping/manual' }));

    expect(onUpdateRouteLeg).toHaveBeenCalledWith(routeLeg.id, {
      type: 'shipping-manual',
    });
  });

  it('cycles inline route leg travel type back to driving', async () => {
    const user = userEvent.setup();
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
    const onUpdateRouteLeg = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={onUpdateRouteLeg}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Set Panama City to Cartagena to driving' }));

    expect(onUpdateRouteLeg).toHaveBeenCalledWith(routeLeg.id, {
      type: 'driving-auto',
    });
  });

  it('reorders stops by drag handle', () => {
    const origin = createDestination({
      name: 'Istanbul',
      countryRegion: 'Turkey',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    const target = createDestination({
      name: 'Tbilisi',
      countryRegion: 'Georgia',
      coordinates: { lat: 41.7151, lng: 44.8271 },
    });
    const onReorderDestinations = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={onReorderDestinations}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Tbilisi' }));
    fireEvent.dragOver(screen.getByTestId(`stop-drop-target-${origin.id}`));
    fireEvent.drop(screen.getByTestId(`stop-drop-target-${origin.id}`));

    expect(onReorderDestinations).toHaveBeenCalledWith([target.id, origin.id]);
  });

  it('shows an empty stops message', () => {
    render(
      <ItineraryPanel
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
      />,
    );

    expect(screen.getByText('Add your first destination from the map search.')).toBeInTheDocument();
    expect(screen.queryByText('0 route legs')).not.toBeInTheDocument();
  });
});
