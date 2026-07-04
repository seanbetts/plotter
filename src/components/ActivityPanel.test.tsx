import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import type { MediaItem, ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
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

function createLinkPreviewClient(overrides: Partial<LinkPreviewClient> = {}): LinkPreviewClient {
  return {
    fetchPreview: vi.fn().mockResolvedValue({
      title: 'Dinner menu',
      url: 'https://restaurant.example/menu',
      domain: 'restaurant.example',
    }),
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
    linkPreviewClient: createLinkPreviewClient(),
    onClose: vi.fn(),
    onUpdateActivity: vi.fn(),
    onUploadMedia: vi.fn(),
    onReorderMedia: vi.fn(),
    onOpenMediaPreview: vi.fn(),
    ...overrides,
  };
}

function addTag(tag: string) {
  const input = screen.getByLabelText('Add tag');

  fireEvent.change(input, { target: { value: tag } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ActivityPanel', () => {
  it('renders the parent stop name and edits the title like a stop name', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    expect(screen.getByText('Paris')).toHaveClass('profile-stop-number');
    expect(screen.getByRole('region', { name: 'Activity images' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Activity title')).not.toBeInTheDocument();

    const titleButton = screen.getByRole('button', { name: 'Edit activity title Louvre' });
    expect(titleButton).toHaveClass('profile-title-button', 'profile-title-control');
    expect(titleButton).toHaveStyle({
      '--profile-title-block-padding': '0px',
      '--profile-title-inline-padding': '0px',
    });

    fireEvent.click(titleButton);

    const titleInput = screen.getByLabelText('Activity title');
    expect(titleInput).toHaveClass('profile-title-input');
    expect(titleInput.closest('.profile-title-editor')).toHaveClass('profile-title-control');
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

  it('renders tags as removable pills and deduplicates new tags', () => {
    const activity = {
      ...createActivity({
        destinationId: 'destination-1',
        title: 'Louvre',
        order: 0,
      }),
      tags: ['museum'],
    };
    const props = createProps({ activity });

    render(<ActivityPanel {...props} />);

    expect(screen.getByRole('button', { name: 'Remove tag museum' })).toBeInTheDocument();

    addTag('Museum');
    addTag('art, morning');
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag museum' }));

    expect(screen.queryByRole('button', { name: 'Remove tag museum' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag art' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag morning' })).toBeInTheDocument();
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(1, activity.id, {
      tags: ['museum', 'art', 'morning'],
    });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(2, activity.id, {
      tags: ['art', 'morning'],
    });
  });

  it('removes the last activity tag with backspace when the tag input is empty', () => {
    const activity = {
      ...createActivity({
        destinationId: 'destination-1',
        title: 'Louvre',
        order: 0,
      }),
      tags: ['museum', 'morning'],
    };
    const props = createProps({ activity });

    render(<ActivityPanel {...props} />);

    fireEvent.keyDown(screen.getByLabelText('Add tag'), { key: 'Backspace' });

    expect(screen.getByRole('button', { name: 'Remove tag museum' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag morning' })).not.toBeInTheDocument();
    expect(props.onUpdateActivity).toHaveBeenCalledWith(activity.id, {
      tags: ['museum'],
    });
  });

  it('renders activity links and saves added fetched links', async () => {
    const existingLink: ResearchLink = {
      id: 'louvre-link',
      title: 'Museum tickets',
      url: 'https://louvre.example/tickets',
      domain: 'louvre.example',
      imageUrl: 'https://louvre.example/og.jpg',
      sortOrder: 0,
    };
    const activity = {
      ...createActivity({
        destinationId: 'destination-1',
        title: 'Louvre',
        order: 0,
      }),
      links: [existingLink],
    };
    const linkPreviewClient = createLinkPreviewClient();
    const onUpdateActivity = vi.fn();

    render(<ActivityPanel {...createProps({ activity, linkPreviewClient, onUpdateActivity })} />);

    expect(screen.getByRole('link', { name: /Museum tickets/ })).toHaveAttribute(
      'href',
      'https://louvre.example/tickets',
    );

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'restaurant.example/menu' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() =>
      expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, {
        links: [
          existingLink,
          expect.objectContaining({
            title: 'Dinner menu',
            url: 'https://restaurant.example/menu',
            domain: 'restaurant.example',
            sortOrder: 1,
          }),
        ],
      }),
    );
  });

  it('keeps activity link controls locked while added links are saving', async () => {
    const existingLink: ResearchLink = {
      id: 'louvre-link',
      title: 'Museum tickets',
      url: 'https://louvre.example/tickets',
      domain: 'louvre.example',
      imageUrl: 'https://louvre.example/og.jpg',
      sortOrder: 0,
    };
    const activity = {
      ...createActivity({
        destinationId: 'destination-1',
        title: 'Louvre',
        order: 0,
      }),
      links: [existingLink],
    };
    const linkSave = deferred<void>();
    const onUpdateActivity = vi.fn(() => linkSave.promise);

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'restaurant.example/menu' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() => expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, expect.any(Object)));
    expect(screen.getByLabelText('Add link URL')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Museum tickets' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Dinner menu up' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Museum tickets/ }).closest('article')).toHaveAttribute(
      'draggable',
      'false',
    );

    await act(async () => {
      linkSave.resolve(undefined);
      await linkSave.promise;
    });

    await waitFor(() => expect(screen.getByLabelText('Add link URL')).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Museum tickets' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Dinner menu up' })).not.toBeDisabled();
    expect(screen.getByRole('link', { name: /Museum tickets/ }).closest('article')).toHaveAttribute(
      'draggable',
      'true',
    );
  });

  it('shows an accessible alert and restores the persisted value when a save fails', async () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    });
    const onUpdateActivity = vi.fn().mockRejectedValue(new Error('Network unavailable'));

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit activity title Louvre' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit activity title Louvre' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit activity title Louvre' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit activity title Louvre' }));
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
