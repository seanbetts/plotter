import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { resolveVehiclePreset, standardRoutingVehicle } from '../domain/vehiclePresets';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import { TripSelector } from './TripSelector';

const trips: TripSummary[] = [
  {
    id: 'trip-one',
    name: 'World tour',
    description: '',
    routingVehicle: standardRoutingVehicle,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'trip-two',
    name: 'Japan winter',
    description: '',
    routingVehicle: standardRoutingVehicle,
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
  },
];

function renderSelector(overrides: Partial<Parameters<typeof TripSelector>[0]> = {}) {
  const props = {
    trips,
    activeTrip: trips[0],
    actionError: null,
    onSelectTrip: vi.fn(),
    onCreateTrip: vi.fn(),
    onUpdateTrip: vi.fn(),
    onDeleteTrip: vi.fn(),
    ...overrides,
  };
  render(<TripSelector {...props} />);
  return props;
}

describe('TripSelector', () => {
  it('selects another trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Japan winter' }));

    expect(props.onSelectTrip).toHaveBeenCalledWith('trip-two');
  });

  it('creates a named trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));
    await userEvent.type(screen.getByLabelText('Trip name'), 'South America');
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }));

    expect(props.onCreateTrip).toHaveBeenCalledWith('South America');
  });

  it('uses inline icon buttons in the new trip dialog', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));

    const dialog = screen.getByRole('dialog', { name: 'New trip' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const createButton = screen.getByRole('button', { name: 'Create trip' });

    expect(dialog.querySelector('.trip-selector__dialog-entry')).toContainElement(screen.getByLabelText('Trip name'));
    expect(cancelButton).toHaveTextContent('');
    expect(createButton).toHaveTextContent('');
  });

  it('focuses the name field when creating a new trip', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));

    expect(screen.getByLabelText('Trip name')).toHaveFocus();
  });

  it('dismisses the new trip dialog with Escape', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'New trip' })).not.toBeInTheDocument();
  });

  it('prevents browser Escape handling while dismissing the new trip dialog', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));

    const wasNotCanceled = fireEvent.keyDown(window, { key: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'New trip' })).not.toBeInTheDocument();
  });

  it('dismisses the new trip dialog after clicking outside', async () => {
    const props = {
      trips,
      activeTrip: trips[0],
      actionError: null,
      onSelectTrip: vi.fn(),
      onCreateTrip: vi.fn(),
      onUpdateTrip: vi.fn(),
      onDeleteTrip: vi.fn(),
    };
    render(
      <>
        <button type="button">Outside</button>
        <TripSelector {...props} />
      </>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));
    await userEvent.click(screen.getByRole('button', { name: 'Outside' }));

    expect(screen.queryByRole('dialog', { name: 'New trip' })).not.toBeInTheDocument();
  });

  it('creates a named trip with Enter from the name field', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));
    await userEvent.type(screen.getByLabelText('Trip name'), 'North Coast 500{Enter}');

    expect(props.onCreateTrip).toHaveBeenCalledWith('North Coast 500');
  });

  it('edits name and vehicle in the existing pencil dialog', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit Japan winter' }));
    await userEvent.clear(screen.getByLabelText('Trip name'));
    await userEvent.type(screen.getByLabelText('Trip name'), 'Renamed tour');
    await userEvent.click(screen.getByRole('button', { name: 'Expedition truck' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save trip' }));

    expect(props.onUpdateTrip).toHaveBeenCalledWith('trip-two', {
      name: 'Renamed tour',
      vehiclePreset: 'expedition-truck',
    });
  });

  it('provides accessible, stable vehicle choices with selected state', async () => {
    const camperTrip = {
      ...trips[0],
      routingVehicle: resolveVehiclePreset('large-camper'),
    };
    renderSelector({ trips: [camperTrip, trips[1]], activeTrip: camperTrip });

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit World tour' }));

    const vehicleGroup = screen.getByRole('group', { name: 'Vehicle for this trip' });
    const options = [
      screen.getByRole('button', { name: 'Standard vehicle' }),
      screen.getByRole('button', { name: 'Large camper' }),
      screen.getByRole('button', { name: 'Expedition truck' }),
    ];

    expect(vehicleGroup).toContainElement(options[0]);
    expect(options.map((option) => option.getAttribute('title'))).toEqual([
      'Standard vehicle',
      'Large camper',
      'Expedition truck',
    ]);
    expect(options.every((option) => option.classList.contains('trip-selector__vehicle-option'))).toBe(true);
    expect(options.map((option) => option.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);

    await userEvent.click(options[2]);
    expect(options.map((option) => option.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('renders delete as one compact confirmation row without a trip-name field', async () => {
    renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete trip' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const deleteButton = screen.getByRole('button', { name: 'Delete Japan winter' });

    expect(dialog.querySelector('.trip-selector__delete-confirmation')).toHaveTextContent('Delete Japan winter?');
    expect(dialog.querySelector('input')).not.toBeInTheDocument();
    expect(dialog).toHaveFocus();
    expect(cancelButton).toHaveTextContent('');
    expect(deleteButton).toHaveTextContent('');
    expect(deleteButton).toHaveClass('trip-selector__dialog-icon-button--danger');
  });

  it('cancels delete from the compact icon button', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onDeleteTrip).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Delete trip' })).not.toBeInTheDocument();
  });

  it('keeps Enter scoped to the focused delete action', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
    await userEvent.keyboard('{Tab}{Enter}');

    expect(props.onDeleteTrip).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Delete trip' })).not.toBeInTheDocument();
  });

  it('confirms delete with Enter from the focused dialog', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
    await userEvent.keyboard('{Enter}');

    expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-two');
  });

  it('confirms delete from the compact Trash button', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete Japan winter' }));

    expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-two');
  });

  it('keeps the dialog open when an action reports failure', async () => {
    const props = renderSelector({
      actionError: 'Unable to delete trip',
      onDeleteTrip: vi.fn(async () => false),
    });

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete World tour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete World tour' }));

    expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-one');
    expect(screen.getByRole('dialog', { name: 'Delete trip' })).toBeInTheDocument();
    expect(screen.getByText('Unable to delete trip')).toBeInTheDocument();
  });
});
