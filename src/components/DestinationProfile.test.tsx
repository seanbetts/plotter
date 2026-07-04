import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import { createDestination } from '../domain/destinations';
import type { Destination, MediaItem, MediaRollupItem } from '../domain/types';
import { DestinationProfile } from './DestinationProfile';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

const autosaveDelayMs = 700;
const savedStatusVisibleMs = 2400;
const defaultMediaProps = {
  activities: [],
  selectedActivityId: null,
  onSelectActivity: vi.fn(),
  onCreateActivity: vi.fn(),
  onDeleteActivity: vi.fn(),
  onReorderActivities: vi.fn(),
  mediaItems: [],
  isMediaLoading: false,
  isMediaUploading: false,
  mediaError: null,
  onUploadMedia: vi.fn(),
  onReorderMedia: vi.fn(),
  onOpenMediaPreview: vi.fn(),
};

function createMediaItem(input: Partial<MediaItem> & Pick<MediaItem, 'id' | 'url'>): MediaItem {
  return {
    caption: '',
    credit: '',
    sortOrder: 0,
    ...input,
  };
}

async function advanceAutosave(ms = autosaveDelayMs) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function flushAutosave() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setupAutosaveTimers() {
  vi.useFakeTimers();
}

function addTag(tag: string) {
  const input = screen.getByLabelText('Add tag');

  fireEvent.change(input, { target: { value: tag } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DestinationProfile', () => {
  it('shows the stop name with the location below it', () => {
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    expect(within(header).getByRole('button', { name: 'Edit stop name Balcombe' })).toBeInTheDocument();
    expect(within(header).getByText('Balcombe, West Sussex, United Kingdom')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stop name')).not.toBeInTheDocument();
  });

  it('shows latitude and longitude as separate pills with a one-click copy button', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    const latitudeLabel = within(header).getByText('Latitude');
    const longitudeLabel = within(header).getByText('Longitude');
    expect(latitudeLabel).toBeInTheDocument();
    expect(longitudeLabel).toBeInTheDocument();
    expect(within(header).getByText('51.0576')).toBeInTheDocument();
    expect(within(header).getByText('-0.1342')).toBeInTheDocument();
    expect(latitudeLabel.closest('button')).toBeNull();
    expect(longitudeLabel.closest('button')).toBeNull();
    const coordinateControls = within(within(header).getByLabelText('Coordinates')).getAllByRole('button');
    expect(coordinateControls.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Edit coordinates',
      'Copy coordinates 51.0576, -0.1342',
    ]);

    await user.click(within(header).getByRole('button', { name: 'Copy coordinates 51.0576, -0.1342' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenLastCalledWith('51.0576, -0.1342');
  });

  it('limits displayed and copied coordinates to five decimal places', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576123, lng: -0.1342987 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    expect(within(header).getByText('51.05761')).toBeInTheDocument();
    expect(within(header).getByText('-0.1343')).toBeInTheDocument();

    await user.click(within(header).getByRole('button', { name: 'Copy coordinates 51.05761, -0.1343' }));

    expect(writeText).toHaveBeenLastCalledWith('51.05761, -0.1343');
  });

  it('shows temporary icon-only feedback after coordinates are copied', async () => {
    setupAutosaveTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    const copyButton = within(header).getByRole('button', { name: 'Copy coordinates 51.0576, -0.1342' });
    fireEvent.click(copyButton);

    await act(async () => {
      await Promise.resolve();
    });

    expect(copyButton).toHaveClass('is-copied');
    expect(within(header).queryByText('Copied')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(copyButton).not.toHaveClass('is-copied');
  });

  it('edits coordinates and saves them with Enter', async () => {
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });
    const onUpdate = vi.fn();

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    fireEvent.click(within(header).getByRole('button', { name: 'Edit coordinates' }));
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '51.0581123' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-0.1339876' } });
    fireEvent.keyDown(screen.getByLabelText('Longitude'), { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith(destination.id, {
      coordinates: { lat: 51.05811, lng: -0.13399 },
    });
  });

  it('uses the same coordinate field sizing in view and edit modes', () => {
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner', { name: 'Stop detail header' });
    expect(within(header).getByText('Latitude').closest('.profile-coordinate-pill')).toHaveClass(
      'profile-coordinate-field',
    );
    expect(within(header).getByText('Longitude').closest('.profile-coordinate-pill')).toHaveClass(
      'profile-coordinate-field',
    );

    fireEvent.click(within(header).getByRole('button', { name: 'Edit coordinates' }));

    expect(screen.getByLabelText('Latitude').closest('.profile-coordinate-input-pill')).toHaveClass(
      'profile-coordinate-field',
    );
    expect(screen.getByLabelText('Longitude').closest('.profile-coordinate-input-pill')).toHaveClass(
      'profile-coordinate-field',
    );
  });

  it('shows the stop number when one is provided', () => {
    const destination = createDestination({
      name: 'Trondheim',
      countryRegion: 'Norway',
      coordinates: { lat: 63.4305, lng: 10.3951 },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        stopNumber={3}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Stop 03')).toBeInTheDocument();
  });

  it('renders stop images directly after the stop profile header', () => {
    const destination = createDestination({
      name: 'Liseleje',
      countryRegion: 'Denmark',
      coordinates: { lat: 56.0128, lng: 11.9646 },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        mediaItems={[
          createMediaItem({
            id: 'media-1',
            url: '/liseleje.jpg',
            caption: 'Liseleje beach',
          }),
        ]}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const profile = screen.getByRole('complementary', { name: 'Liseleje profile' });
    const header = within(profile).getByRole('banner', { name: 'Stop detail header' });
    const imageStrip = within(profile).getByRole('region', { name: 'Stop images' });

    expect(imageStrip).toBeInTheDocument();
    expect(header.nextElementSibling).toBe(imageStrip);
  });

  it('renders activities inside the stop profile', () => {
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const activity = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        activities={[activity]}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Activities' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select activity Louvre' })).toHaveTextContent('Louvre');
    expect(screen.queryByDisplayValue('Louvre')).not.toBeInTheDocument();
  });

  it('surfaces activity creation failures from the profile adapters', async () => {
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        onCreateActivity={vi.fn().mockRejectedValue(new Error('Network unavailable'))}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('New activity title'), {
      target: { value: 'Louvre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update activities.');
    expect(screen.getByLabelText('New activity title')).toHaveValue('Louvre');
  });

  it('requests the workspace full image preview from the pane preview image', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    const onOpenMediaPreview = vi.fn();

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        mediaItems={[
          createMediaItem({
            id: 'media-1',
            url: '/balcombe.jpg',
            caption: 'Home lane',
          }),
        ]}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        onOpenMediaPreview={onOpenMediaPreview}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open full image: Home lane' }));
    expect(onOpenMediaPreview).toHaveBeenCalledWith('media-1');
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
  });

  it('omits activity attribution from the stop images carousel', () => {
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const rollupItems: MediaRollupItem[] = [
      {
        mediaItem: createMediaItem({
          id: 'stop-media-1',
          url: '/paris.jpg',
          caption: 'Paris street',
          sortOrder: 0,
        }),
        ownerType: 'destination',
        destinationId: destination.id,
        canReorderInStopCarousel: true,
      },
      {
        mediaItem: createMediaItem({
          id: 'activity-media-1',
          url: '/louvre.jpg',
          caption: 'Museum wing',
          sortOrder: 0,
        }),
        ownerType: 'activity',
        destinationId: destination.id,
        activityId: 'activity-1',
        activityTitle: 'Louvre',
        canReorderInStopCarousel: false,
      },
    ];

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        mediaItems={[rollupItems[0].mediaItem]}
        mediaRollupItems={rollupItems}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show image 2: Museum wing' }));

    expect(within(screen.getByRole('group', { name: 'Image preview' })).queryByText('Louvre')).not.toBeInTheDocument();
  });

  it('labels the first stop as the start', () => {
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'England',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });

    render(<DestinationProfile {...defaultMediaProps} destination={destination} stopNumber={1} onUpdate={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('shows the compact editable stop fields until the stop name is clicked', () => {
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Expected stay days')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByLabelText('Add tag')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activities' })).toBeInTheDocument();
    expect(screen.getByLabelText('New activity title')).toBeInTheDocument();
    expect(screen.queryByLabelText('Why it matters')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Highlights')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Personal rationale')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ideal months')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Research notes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Route notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save destination' })).not.toBeInTheDocument();
  });

  it('autosaves an edited stop name after a debounce without changing location fields', async () => {
    setupAutosaveTimers();
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit stop name Balcombe' }));
    const input = screen.getByLabelText('Stop name');
    fireEvent.change(input, { target: { value: 'Home' } });

    expect(onUpdate).not.toHaveBeenCalled();

    await advanceAutosave(autosaveDelayMs - 1);
    expect(onUpdate).not.toHaveBeenCalled();

    await advanceAutosave(1);

    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        name: 'Home',
        location: destination.location,
      }),
    );
  });

  it('uses the same title control box when switching the stop name into edit mode', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={vi.fn()} onClose={vi.fn()} />);

    const titleButton = screen.getByRole('button', { name: 'Edit stop name Balcombe' });
    expect(titleButton).toHaveClass('profile-title-control');
    expect(titleButton).toHaveStyle('--profile-title-inline-padding: 0px');
    expect(titleButton).toHaveStyle('--profile-title-block-padding: 0px');

    await user.click(titleButton);

    const nameInput = screen.getByLabelText('Stop name');
    expect(nameInput).toHaveClass('profile-title-input');
    const titleEditor = nameInput.closest('.profile-title-editor');
    expect(titleEditor).toHaveClass('profile-title-control');
    expect(titleEditor).toHaveStyle('--profile-title-inline-padding: 0px');
    expect(titleEditor).toHaveStyle('--profile-title-block-padding: 0px');
  });

  it('edits timing and tags without overwriting hidden detail fields', async () => {
    setupAutosaveTimers();
    const destination: Destination = {
      ...createDestination({
        name: 'Valparaiso',
        countryRegion: 'Chile',
        coordinates: { lat: -33.0472, lng: -71.6127 },
      }),
      timing: {
        idealMonths: ['March'],
        expectedStayDays: 4,
        provisionalStartDate: '',
        provisionalEndDate: '',
      },
      why: {
        summary: 'Street art hills.',
        highlights: 'Murals',
        personalRationale: 'Architecture',
      },
      research: {
        notes: 'Keep this note.',
        links: [],
        bookReferences: [],
      },
      activities: {
        items: [{ id: 'activity-1', label: 'murals', category: 'street-art', notes: 'existing' }],
      },
      routeContext: {
        previousNextNotes: '',
        drivingNotes: '',
        borderShippingNotes: '',
        notes: 'Keep route note.',
      },
      tags: ['street-art'],
    };
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Expected stay days'), { target: { value: '5' } });
    addTag('port-city');

    expect(onUpdate).not.toHaveBeenCalled();
    await advanceAutosave();

    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        timing: {
          ...destination.timing,
          expectedStayDays: 5,
        },
        tags: ['street-art', 'port-city'],
      }),
    );
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('why');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('research');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('activities');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('routeContext');
  });

  it('debounces rapid typing into one save with the final value', async () => {
    setupAutosaveTimers();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    const tagsInput = screen.getByLabelText('Add tag');
    fireEvent.change(tagsInput, { target: { value: 'silk' } });
    fireEvent.change(tagsInput, { target: { value: 'silk-road' } });
    fireEvent.keyDown(tagsInput, { key: 'Enter' });
    fireEvent.change(tagsInput, { target: { value: 'tiles' } });
    fireEvent.keyDown(tagsInput, { key: 'Enter' });

    expect(onUpdate).not.toHaveBeenCalled();

    await advanceAutosave();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        tags: ['silk-road', 'tiles'],
      }),
    );
  });

  it('renders tags as removable pills and deduplicates new tags', async () => {
    setupAutosaveTimers();
    const destination = {
      ...createDestination({
        name: 'Valparaiso',
        countryRegion: 'Chile',
        coordinates: { lat: -33.0472, lng: -71.6127 },
      }),
      tags: ['street-art'],
    };
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Remove tag street-art' })).toBeInTheDocument();

    addTag('Street-Art');
    addTag('port-city');
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag street-art' }));

    await advanceAutosave();

    expect(screen.queryByRole('button', { name: 'Remove tag street-art' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag port-city' })).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        tags: ['port-city'],
      }),
    );
  });

  it('removes the last tag with backspace when the tag input is empty', async () => {
    setupAutosaveTimers();
    const destination = {
      ...createDestination({
        name: 'Kyoto',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      }),
      tags: ['temples', 'food'],
    };
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    fireEvent.keyDown(screen.getByLabelText('Add tag'), { key: 'Backspace' });
    await advanceAutosave();

    expect(screen.getByRole('button', { name: 'Remove tag temples' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag food' })).not.toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        tags: ['temples'],
      }),
    );
  });

  it('preserves active draft edits across same-id persisted rerenders', async () => {
    const user = userEvent.setup();
    const destination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      tags: ['silk-road'],
      updatedAt: '2026-06-28T09:00:00.000Z',
    };
    const onUpdate = vi.fn();

    const { rerender } = render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Remove tag silk-road' }));
    await user.type(screen.getByLabelText('Add tag'), 'local-draft{Enter}');

    rerender(
      <DestinationProfile {...defaultMediaProps}
        destination={{
          ...destination,
          timing: {
            ...destination.timing,
            expectedStayDays: 6,
          },
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remove tag local-draft' })).toBeInTheDocument();

    rerender(
      <DestinationProfile {...defaultMediaProps}
        destination={{
          ...destination,
          tags: ['saved-tag'],
          updatedAt: '2026-06-28T10:00:00.000Z',
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remove tag local-draft' })).toBeInTheDocument();
  });

  it('syncs persisted rerenders when there are no active draft edits', () => {
    const destination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      tags: ['silk-road'],
      updatedAt: '2026-06-28T09:00:00.000Z',
    };

    const { rerender } = render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={vi.fn()} onClose={vi.fn()} />);

    rerender(
      <DestinationProfile {...defaultMediaProps}
        destination={{
          ...destination,
          tags: ['saved-tag'],
          updatedAt: '2026-06-28T10:00:00.000Z',
        }}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remove tag saved-tag' })).toBeInTheDocument();
  });

  it('does not resurrect an unsaved draft when switching away and back to the same destination version', async () => {
    const user = userEvent.setup();
    const firstDestination: Destination = {
      ...createDestination({
        name: 'Kyoto',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      }),
      tags: ['temples'],
      updatedAt: '2026-06-28T09:00:00.000Z',
    };
    const secondDestination: Destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      tags: ['silk-road'],
      updatedAt: '2026-06-28T09:05:00.000Z',
    };

    const { rerender } = render(
      <DestinationProfile {...defaultMediaProps} destination={firstDestination} onUpdate={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove tag temples' }));
    await user.type(screen.getByLabelText('Add tag'), 'unsaved-draft{Enter}');

    rerender(<DestinationProfile {...defaultMediaProps} destination={secondDestination} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove tag silk-road' })).toBeInTheDocument();

    rerender(<DestinationProfile {...defaultMediaProps} destination={firstDestination} onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove tag temples' })).toBeInTheDocument();
  });

  it('normalizes expected stay days to a positive whole number', async () => {
    setupAutosaveTimers();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Expected stay days'), { target: { value: '-2' } });
    await advanceAutosave();

    expect(onUpdate).toHaveBeenLastCalledWith(
      destination.id,
      expect.objectContaining({
        timing: expect.objectContaining({ expectedStayDays: 1 }),
      }),
    );

    fireEvent.change(screen.getByLabelText('Expected stay days'), { target: { value: '4.8' } });
    await advanceAutosave();

    expect(onUpdate).toHaveBeenLastCalledWith(
      destination.id,
      expect.objectContaining({
        timing: expect.objectContaining({ expectedStayDays: 4 }),
      }),
    );
  });

  it('shows saving and saved feedback after autosaving destination changes', async () => {
    setupAutosaveTimers();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const save = deferred<void>();
    const onUpdate = vi.fn(() => save.promise);

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    addTag('silk-road');
    await advanceAutosave();

    expect(screen.getByRole('status', { name: 'Saving...' })).toHaveClass(
      'profile-save-status',
      'is-saving',
    );

    save.resolve();

    await flushAutosave();
    expect(screen.getByRole('status', { name: 'Saved' })).toHaveClass(
      'profile-save-status',
      'is-saved',
    );

    await advanceAutosave(savedStatusVisibleMs);
    expect(screen.queryByRole('status', { name: 'Saved' })).not.toBeInTheDocument();
  });

  it('shows unable to save feedback when autosave fails', async () => {
    setupAutosaveTimers();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const onUpdate = vi.fn().mockRejectedValue(new Error('network unavailable'));

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    addTag('silk-road');
    await advanceAutosave();

    await flushAutosave();
    expect(screen.getByRole('status', { name: 'Unable to save' })).toHaveClass(
      'profile-save-status',
      'is-error',
    );
  });

  it('ignores stale autosave responses after newer edits have started', async () => {
    setupAutosaveTimers();
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const onUpdate = vi.fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    addTag('first');
    await advanceAutosave();
    expect(screen.getByRole('status', { name: 'Saving...' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag first' }));
    addTag('second');
    firstSave.resolve();

    await act(async () => {
      await firstSave.promise;
    });

    expect(screen.queryByRole('status', { name: 'Saved' })).not.toBeInTheDocument();

    await advanceAutosave();
    expect(onUpdate).toHaveBeenCalledTimes(2);

    secondSave.resolve();
    await flushAutosave();
    expect(screen.getByRole('status', { name: 'Saved' })).toBeInTheDocument();
    expect(onUpdate.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        tags: ['second'],
      }),
    );
  });

  it('keeps saved feedback visible when the saved destination version updates', async () => {
    setupAutosaveTimers();
    const destination = {
      ...createDestination({
        name: 'Samarkand',
        countryRegion: 'Uzbekistan',
        coordinates: { lat: 39.6542, lng: 66.9597 },
      }),
      updatedAt: '2026-06-28T09:00:00.000Z',
    };

    function ProfileHarness() {
      const [currentDestination, setCurrentDestination] = useState(destination);

      return (
        <DestinationProfile {...defaultMediaProps}
          destination={currentDestination}
          onUpdate={(_, patch) => {
            setCurrentDestination({
              ...currentDestination,
              ...patch,
              updatedAt: '2026-06-28T10:00:00.000Z',
            });
          }}
          onClose={vi.fn()}
        />
      );
    }

    render(<ProfileHarness />);

    addTag('silk-road');
    await advanceAutosave();

    await flushAutosave();
    expect(screen.getByRole('status', { name: 'Saved' })).toBeInTheDocument();
  });
});
