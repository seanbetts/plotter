import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import { TripSelector } from './TripSelector';

const trips: TripSummary[] = [
  {
    id: 'trip-one',
    name: 'World tour',
    description: '',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'trip-two',
    name: 'Japan winter',
    description: '',
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
    onRenameActiveTrip: vi.fn(),
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

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New trip' }));
    await userEvent.type(screen.getByLabelText('Trip name'), 'South America');
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }));

    expect(props.onCreateTrip).toHaveBeenCalledWith('South America');
  });

  it('renames the active trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename trip' }));
    await userEvent.clear(screen.getByLabelText('Trip name'));
    await userEvent.type(screen.getByLabelText('Trip name'), 'Renamed tour');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(props.onRenameActiveTrip).toHaveBeenCalledWith('Renamed tour');
  });

  it('requires delete confirmation that names the trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete trip' }));

    expect(screen.getByRole('dialog', { name: 'Delete trip' })).toHaveTextContent('World tour');
    await userEvent.click(screen.getByRole('button', { name: 'Delete World tour' }));

    expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-one');
  });

  it('keeps the dialog open when an action reports failure', async () => {
    const props = renderSelector({
      actionError: 'Unable to delete trip',
      onDeleteTrip: vi.fn(async () => false),
    });

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete trip' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete World tour' }));

    expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-one');
    expect(screen.getByRole('dialog', { name: 'Delete trip' })).toBeInTheDocument();
    expect(screen.getByText('Unable to delete trip')).toBeInTheDocument();
  });
});
