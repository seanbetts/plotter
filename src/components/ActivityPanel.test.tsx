import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import type { ActivityLocation, MediaItem, ResearchLink } from '../domain/types';
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
    tagSuggestions: [],
    linkPreviewClient: createLinkPreviewClient(),
    onClose: vi.fn(),
    onUpdateActivity: vi.fn(),
    onUploadMedia: vi.fn(),
    onReorderMedia: vi.fn(),
    onOpenMediaPreview: vi.fn(),
    ...overrides,
  };
}

async function addTag(tag: string) {
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  await user.type(screen.getByRole('textbox', { name: 'Add tag' }), `${tag}{Enter}`);
}

describe('ActivityPanel', () => {
  it('renders activity address and copyable coordinates when a location is present', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    const location: ActivityLocation = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    };
    const activity = {
      ...createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0, location }),
      location,
    };

    render(<ActivityPanel {...createProps({ activity })} />);

    expect(screen.getByText('Rue de Rivoli, 75001 Paris, France')).toHaveClass(
      'profile-location-address',
      'activity-location-address',
    );
    expect(screen.getByLabelText('Coordinates')).toBeInTheDocument();
    expect(screen.getByText('48.8606')).toBeInTheDocument();
    expect(screen.getByText('2.3364')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy coordinates 48.8606, 2.3364' }));

    expect(writeText).toHaveBeenCalledWith('48.8606, 2.3364');
  });

  it('removes a repeated activity name from the displayed address', () => {
    const location: ActivityLocation = {
      name: 'Louvre Museum',
      address: 'Louvre Museum, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    };
    const activity = {
      ...createActivity({ destinationId: 'destination-1', title: 'Louvre Museum', order: 0, location }),
      location,
    };

    render(<ActivityPanel {...createProps({ activity })} />);

    expect(screen.getByText('75001 Paris, France')).toBeInTheDocument();
    expect(screen.queryByText('Louvre Museum, 75001 Paris, France')).not.toBeInTheDocument();
  });

  it('keeps the place name in the address when the activity has been renamed', () => {
    const location: ActivityLocation = {
      name: 'Louvre Museum',
      address: 'Louvre Museum, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    };
    const activity = {
      ...createActivity({ destinationId: 'destination-1', title: 'Morning visit', order: 0, location }),
      location,
    };

    render(<ActivityPanel {...createProps({ activity })} />);

    expect(screen.getByText('Louvre Museum, 75001 Paris, France')).toBeInTheDocument();
  });

  it('edits activity location coordinates while preserving address details', () => {
    const onUpdateActivity = vi.fn();
    const location: ActivityLocation = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    };
    const activity = {
      ...createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0, location }),
      location,
    };

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit coordinates' }));
    expect(screen.getByLabelText('Latitude')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '48.861' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '2.337' } });
    fireEvent.keyDown(screen.getByLabelText('Longitude'), { key: 'Enter' });

    expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, {
      location: {
        ...location,
        coordinates: { lat: 48.861, lng: 2.337 },
      },
    });
  });

  it('fills both activity coordinate fields from a pasted coordinate pair', () => {
    const onUpdateActivity = vi.fn();
    const location: ActivityLocation = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    };
    const activity = {
      ...createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0, location }),
      location,
    };

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit coordinates' }));
    fireEvent.paste(screen.getByLabelText('Latitude'), {
      clipboardData: {
        getData: () => '48.8566, 2.3522',
      },
    });
    expect(screen.getByLabelText('Latitude')).toHaveValue('48.8566');
    expect(screen.getByLabelText('Longitude')).toHaveValue('2.3522');

    fireEvent.keyDown(screen.getByLabelText('Latitude'), { key: 'Enter' });

    expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, {
      location: {
        ...location,
        coordinates: { lat: 48.8566, lng: 2.3522 },
      },
    });
  });

  it('shows TBC location fields for a manual activity and saves new coordinates', () => {
    const onUpdateActivity = vi.fn();
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Bakery crawl',
      order: 0,
    });

    render(<ActivityPanel {...createProps({ activity, onUpdateActivity })} />);

    const panel = screen.getByRole('complementary', { name: 'Bakery crawl activity' });
    expect(panel.querySelector('.activity-location-address')).toHaveTextContent('TBC');
    expect(within(panel).getByLabelText('Coordinates')).toHaveTextContent('LatitudeTBC');
    expect(within(panel).getByLabelText('Coordinates')).toHaveTextContent('LongitudeTBC');

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit coordinates' }));
    expect(within(panel).getByLabelText('Latitude')).toHaveValue('');
    expect(within(panel).getByLabelText('Longitude')).toHaveValue('');

    fireEvent.change(within(panel).getByLabelText('Latitude'), { target: { value: '48.8566' } });
    fireEvent.change(within(panel).getByLabelText('Longitude'), { target: { value: '2.3522' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save coordinates' }));

    expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, {
      location: {
        name: 'Bakery crawl',
        address: 'TBC',
        coordinates: { lat: 48.8566, lng: 2.3522 },
        sourceProvider: 'manual',
      },
    });
  });

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

  it('labels the tags group with the activity title', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    const tagsGroup = screen.getByRole('group', { name: 'Louvre Tags' });

    expect(screen.getByText('Louvre Tags')).toBeInTheDocument();
    expect(tagsGroup).toContainElement(screen.getByLabelText('Add tag'));
  });

  it('keeps the tags group at the bottom after notes', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    const notes = screen.getByLabelText('Louvre Notes');
    const tagsGroup = screen.getByRole('group', { name: 'Louvre Tags' });

    expect(notes.compareDocumentPosition(tagsGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows shared tag suggestions from an empty activity tag section', async () => {
    const user = userEvent.setup();
    const props = createProps({
      activity: {
        ...createActivity({
          destinationId: 'destination-1',
          title: 'Louvre',
          order: 0,
        }),
        tags: [],
      },
      tagSuggestions: [
        { tag: 'museum', count: 3 },
        { tag: 'food', count: 2 },
      ],
    });

    render(<ActivityPanel {...props} />);

    expect(screen.getByText('No tags yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('button', { name: 'Add tag suggestion museum' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag suggestion food' })).toBeInTheDocument();
  });

  it('places contextual activity links before the details section and tags', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    const panel = screen.getByRole('complementary', { name: 'Louvre activity' });
    const imageRegion = within(panel).getByRole('region', { name: 'Activity images' });
    const linksSection = within(panel).getByRole('region', { name: 'Louvre Links' });
    const detailsSection = within(panel).getByRole('region', { name: 'Louvre Details' });
    const description = within(detailsSection).getByLabelText('Louvre Description');
    const notes = within(detailsSection).getByLabelText('Louvre Notes');
    const tagsGroup = within(panel).getByRole('group', { name: 'Louvre Tags' });

    expect(within(linksSection).getByText('Louvre Links')).toBeInTheDocument();
    expect(within(detailsSection).getByText('Louvre Details')).toBeInTheDocument();
    expect(imageRegion.compareDocumentPosition(linksSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(linksSection.compareDocumentPosition(detailsSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detailsSection.compareDocumentPosition(tagsGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('saves description and notes with labels based on the activity title', () => {
    const props = createProps();

    render(<ActivityPanel {...props} />);

    expect(screen.queryByLabelText('Activity status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Activity priority')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Louvre Description'), {
      target: { value: 'Spend the morning in the galleries.' },
    });
    fireEvent.blur(screen.getByLabelText('Louvre Description'));
    fireEvent.change(screen.getByLabelText('Louvre Notes'), {
      target: { value: 'Check Friday late opening.' },
    });
    fireEvent.blur(screen.getByLabelText('Louvre Notes'));

    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(1, props.activity.id, {
      description: 'Spend the morning in the galleries.',
    });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(2, props.activity.id, {
      notes: 'Check Friday late opening.',
    });
  });

  it('renders tags as removable pills and deduplicates new tags', async () => {
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

    await addTag('Museum');
    await addTag('art, morning');
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag museum' }));

    expect(screen.queryByRole('button', { name: 'Remove tag museum' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag art' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag morning' })).toBeInTheDocument();
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(1, activity.id, {
      tags: ['museum', 'art'],
    });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(2, activity.id, {
      tags: ['museum', 'art', 'morning'],
    });
    expect(props.onUpdateActivity).toHaveBeenNthCalledWith(3, activity.id, {
      tags: ['art', 'morning'],
    });
  });

  it('removes activity tags through removable pills', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag morning' }));

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
    expect(screen.getByRole('button', { name: 'Add link' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Add link' })).not.toBeDisabled();
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
    fireEvent.change(screen.getByLabelText('Morning Louvre Notes'), {
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
    expect(screen.getByLabelText('Morning Louvre Notes')).toHaveValue('Check Friday late opening.');
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
