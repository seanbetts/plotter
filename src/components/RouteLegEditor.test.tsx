import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { ItineraryPanel } from './ItineraryPanel';
import { RouteLegEditor } from './RouteLegEditor';

describe('RouteLegEditor', () => {
  it('creates a ferry/shipping route leg between two destinations', async () => {
    const user = userEvent.setup();
    const origin = createDestination({ name: 'Panama City', coordinates: { lat: 8.9824, lng: -79.5199 } });
    const target = createDestination({ name: 'Cartagena', coordinates: { lat: 10.391, lng: -75.4794 } });
    const onCreateRouteLeg = vi.fn();

    render(<RouteLegEditor destinations={[origin, target]} onCreateRouteLeg={onCreateRouteLeg} />);

    await user.selectOptions(screen.getByLabelText('Origin'), origin.id);
    await user.selectOptions(screen.getByLabelText('Target'), target.id);
    await user.selectOptions(screen.getByLabelText('Leg type'), 'ferry-shipping');
    await user.type(screen.getByLabelText('Route notes'), 'Darien Gap shipping leg.');
    await user.click(screen.getByRole('button', { name: 'Add route leg' }));

    expect(onCreateRouteLeg).toHaveBeenCalledWith({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'ferry-shipping',
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
});

describe('ItineraryPanel', () => {
  it('renders selectable stops, route summary, and the nested route editor', async () => {
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
      type: 'driving',
    });
    const onSelectDestination = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={target.id}
        onSelectDestination={onSelectDestination}
        onCreateRouteLeg={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Itinerary')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '01 Istanbul Turkey' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '02 Tbilisi Georgia' })).toHaveClass('is-selected');
    expect(screen.getByText('1 route leg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add route leg' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '01 Istanbul Turkey' }));

    expect(onSelectDestination).toHaveBeenCalledWith(origin.id);
  });

  it('shows an empty stops message', () => {
    render(
      <ItineraryPanel
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onCreateRouteLeg={vi.fn()}
      />,
    );

    expect(screen.getByText('Add your first destination from the map search.')).toBeInTheDocument();
    expect(screen.getByText('0 route legs')).toBeInTheDocument();
  });
});
