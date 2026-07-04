import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import { ActivityList } from './ActivityList';

describe('ActivityList', () => {
  it('renders an empty state and adds an activity', async () => {
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    expect(screen.getByText('No activities yet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New activity title'), {
      target: { value: '  Louvre  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(onCreateActivity).toHaveBeenCalledWith('Louvre');
    await waitFor(() => expect(screen.getByLabelText('New activity title')).toHaveValue(''));
  });

  it('selects, reorders, and deletes activities without inline title editing', () => {
    const louvre = createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0 });
    const bakery = createActivity({ destinationId: 'destination-1', title: 'Bakery crawl', order: 1 });
    const onSelectActivity = vi.fn();
    const onDeleteActivity = vi.fn();
    const onReorderActivities = vi.fn();

    render(
      <ActivityList
        activities={[louvre, bakery]}
        selectedActivityId={bakery.id}
        onSelectActivity={onSelectActivity}
        onCreateActivity={vi.fn()}
        onDeleteActivity={onDeleteActivity}
        onReorderActivities={onReorderActivities}
      />,
    );

    expect(screen.getByRole('button', { name: 'Move Louvre up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Bakery crawl down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select activity Bakery crawl' }).closest('li')).toHaveClass(
      'is-selected',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select activity Louvre' }));
    expect(onSelectActivity).toHaveBeenCalledWith(louvre.id);
    expect(screen.getByRole('button', { name: 'Select activity Louvre' })).toHaveTextContent('Louvre');
    expect(screen.queryByDisplayValue('Louvre')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move Bakery crawl up' }));
    expect(onReorderActivities).toHaveBeenCalledWith([bakery.id, louvre.id]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Bakery crawl' }));
    expect(onDeleteActivity).toHaveBeenCalledWith(bakery.id);
  });
});
