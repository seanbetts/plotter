import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import type { MediaItem } from '../domain/types';
import { ActivityPanel } from './ActivityPanel';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
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
    stopName: 'Paris',
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
  it('renders the parent stop name and saves title drafts on blur', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    expect(screen.getByText('Paris')).toHaveClass('profile-stop-number');
    expect(screen.getByRole('region', { name: 'Activity images' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));
    expect(props.onUpdateActivity).toHaveBeenCalledWith(props.activity.id, { title: 'Morning Louvre' });
  });

  it('saves description and notes with labels based on the activity title', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    expect(screen.queryByLabelText('Activity status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Activity priority')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Louvre description'), {
      target: { value: 'Spend the morning in the galleries.' },
    });
    fireEvent.blur(screen.getByLabelText('Louvre description'));
    fireEvent.change(screen.getByLabelText('Louvre notes'), {
      target: { value: 'Check Friday late opening.' },
    });
    fireEvent.blur(screen.getByLabelText('Louvre notes'));

    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(1, props.activity.id, {
      description: 'Spend the morning in the galleries.',
    });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(2, props.activity.id, {
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
    fireEvent.change(screen.getByLabelText('Morning Louvre notes'), {
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
    expect(screen.getByLabelText('Morning Louvre notes')).toHaveValue('Check Friday late opening.');
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

  it('does not show an error when an older title save rejects after a newer save succeeds', async () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    });
    const firstTitleSave = deferred<void>();
    const secondTitleSave = deferred<void>();
    const onUpdateActivity = vi
      .fn()
      .mockReturnValueOnce(firstTitleSave.promise)
      .mockReturnValueOnce(secondTitleSave.promise);

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Morning Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));
    fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Evening Louvre' } });
    fireEvent.blur(screen.getByLabelText('Activity title'));

    await act(async () => {
      secondTitleSave.resolve(undefined);
      await secondTitleSave.promise;
    });

    await act(async () => {
      firstTitleSave.reject(new Error('Older save failed'));
      await firstTitleSave.promise.catch(() => undefined);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Activity title')).toHaveValue('Evening Louvre');
  });
});
