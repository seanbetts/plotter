import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import type { MediaItem } from '../domain/types';
import { ActivityPanel } from './ActivityPanel';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'activity-media-1',
    url: 'https://example.com/activity-1.jpg',
    caption: 'Gallery wing',
    credit: 'Example photographer',
    sortOrder: 0,
    ...overrides,
  };
}

function createProps(overrides: Partial<React.ComponentProps<typeof ActivityPanel>> = {}) {
  const activity = {
    ...createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    }),
    description: 'Visit the Denon wing.',
    notes: 'Book early slot.',
  };

  return {
    activity,
    mediaItems: [createMediaItem()],
    mediaError: null,
    isMediaLoading: false,
    isMediaUploading: false,
    onClose: vi.fn(),
    onUpdateActivity: vi.fn(),
    onUploadMedia: vi.fn(),
    onReorderMedia: vi.fn(),
    onOpenMediaPreview: vi.fn(),
    ...overrides,
  };
}

describe('ActivityPanel', () => {
  it('renders rich activity fields and saves title drafts on blur', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Activity images' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));
    expect(props.onUpdateActivity).toHaveBeenCalledWith(props.activity.id, { title: 'Morning Louvre' });
  });

  it('saves status, priority, description, and notes changes on blur', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    fireEvent.change(screen.getByLabelText('Activity status'), { target: { value: 'planned' } });
    fireEvent.blur(screen.getByLabelText('Activity status'));
    fireEvent.change(screen.getByLabelText('Activity priority'), { target: { value: 'must-do' } });
    fireEvent.blur(screen.getByLabelText('Activity priority'));
    fireEvent.change(screen.getByLabelText('Activity description'), {
      target: { value: 'Spend the morning in the galleries.' },
    });
    fireEvent.blur(screen.getByLabelText('Activity description'));
    fireEvent.change(screen.getByLabelText('Activity notes'), {
      target: { value: 'Check Friday late opening.' },
    });
    fireEvent.blur(screen.getByLabelText('Activity notes'));

    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(1, props.activity.id, { status: 'planned' });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(2, props.activity.id, { priority: 'must-do' });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(3, props.activity.id, {
      description: 'Spend the morning in the galleries.',
    });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(4, props.activity.id, {
      notes: 'Check Friday late opening.',
    });
  });

  it('shows an accessible alert and restores the persisted value when a save fails', async () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    });
    const onUpdateActivity = vi.fn().mockRejectedValue(new Error('Network unavailable'));

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update activity.');
    expect(screen.getByLabelText('Activity title')).toHaveValue('Louvre');
  });

  it('preserves an unsaved notes draft when a title save rerender arrives', async () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    });
    const titleSave = deferred<void>();
    const onUpdateActivity = vi.fn(() => titleSave.promise);

    const { rerender } = render(
      <ActivityPanel {...createProps({ activity, onUpdateActivity })} />,
    );

    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));
    fireEvent.change(screen.getByLabelText('Activity notes'), {
      target: { value: 'Check Friday late opening.' },
    });

    await act(async () => {
      titleSave.resolve(undefined);
      await titleSave.promise;
    });

    rerender(
      <ActivityPanel
        {...createProps({
          activity: {
            ...activity,
            title: 'Morning Louvre',
            updatedAt: '2026-07-04T12:00:00.000Z',
          },
          onUpdateActivity,
        })}
      />,
    );

    expect(screen.getByLabelText('Activity title')).toHaveValue('Morning Louvre');
    expect(screen.getByLabelText('Activity notes')).toHaveValue('Check Friday late opening.');
  });

  it('preserves a newer title draft when an earlier title save rerender arrives', async () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    });
    const titleSave = deferred<void>();
    const onUpdateActivity = vi.fn(() => titleSave.promise);

    const { rerender } = render(
      <ActivityPanel {...createProps({ activity, onUpdateActivity })} />,
    );

    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));
    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Evening Louvre' } });

    await act(async () => {
      titleSave.resolve(undefined);
      await titleSave.promise;
    });

    rerender(
      <ActivityPanel
        {...createProps({
          activity: {
            ...activity,
            title: 'Morning Louvre',
            updatedAt: '2026-07-04T12:00:00.000Z',
          },
          onUpdateActivity,
        })}
      />,
    );

    expect(screen.getByLabelText('Activity title')).toHaveValue('Evening Louvre');
  });
});
