import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem, MediaRollupItem } from '../domain/types';
import type { WebImageSearchClient, WebImageSearchStopContext } from '../services/webImageSearchClient';
import { DestinationImageStrip } from './DestinationImageStrip';

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'media-1',
    url: 'https://example.com/media-1.jpg',
    caption: 'Sunset over the harbour',
    credit: 'Example photographer',
    sortOrder: 0,
    ...overrides,
  };
}

function createProps(overrides: Partial<React.ComponentProps<typeof DestinationImageStrip>> = {}) {
  return {
    destinationName: 'Bergen',
    mediaItems: [
      createMediaItem(),
      createMediaItem({
        id: 'media-2',
        url: 'https://example.com/media-2.jpg',
        caption: 'Mountain trail',
        sortOrder: 1,
      }),
    ],
    isLoading: false,
    isUploading: false,
    error: null,
    onUploadFiles: vi.fn(),
    onReorder: vi.fn(),
    onOpenPreview: vi.fn(),
    ...overrides,
  };
}

function createMediaRollupItem(overrides: Partial<MediaRollupItem> = {}): MediaRollupItem {
  return {
    mediaItem: createMediaItem(),
    ownerType: 'destination',
    destinationId: 'destination-1',
    canReorderInStopCarousel: true,
    ...overrides,
  };
}

const webImageSearchClient: WebImageSearchClient = {
  searchImages: vi.fn(async () => []),
};
const webImageSearchContext: WebImageSearchStopContext = {
  stopName: 'Bergen',
  regionName: 'Vestland',
  countryName: 'Norway',
  countryCode: 'NO',
};

describe('DestinationImageStrip', () => {
  it('renders the stop image labels through the shared media strip', () => {
    render(<DestinationImageStrip {...createProps({ mediaItems: [] })} />);

    const region = screen.getByRole('region', { name: 'Stop images' });
    expect(region).toHaveTextContent('No images yet');
    expect(region).toHaveTextContent('Drop images here or click to add.');
    expect(screen.getByRole('button', { name: 'Choose stop images' })).toBeInTheDocument();
    expect(screen.queryByText('Bergen')).not.toBeInTheDocument();
  });

  it('passes stop images as reorderable media items', () => {
    const onReorder = vi.fn();
    render(<DestinationImageStrip {...createProps({ onReorder })} />);

    const secondThumbnail = screen.getByRole('button', { name: 'Show image 2: Mountain trail' });
    vi.spyOn(secondThumbnail, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      width: 80,
      height: 60,
      top: 0,
      right: 180,
      bottom: 60,
      left: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' }));

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, 'clientX', { value: 170 });
    fireEvent(secondThumbnail, dragOverEvent);

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'clientX', { value: 170 });
    fireEvent(secondThumbnail, dropEvent);

    expect(onReorder).toHaveBeenCalledWith(['media-2', 'media-1']);
  });

  it('opens the selected stop image preview from the shared strip', () => {
    const onOpenPreview = vi.fn();
    render(<DestinationImageStrip {...createProps({ onOpenPreview })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 2: Mountain trail' }));

    const preview = screen.getByRole('button', { name: 'Open full image: Mountain trail' });
    expect(within(preview).getByRole('img', { name: 'Mountain trail' })).toHaveAttribute(
      'src',
      'https://example.com/media-2.jpg',
    );

    fireEvent.click(preview);

    expect(onOpenPreview).toHaveBeenCalledWith('media-2');
  });

  it('renders web image search inside the stop images before the preview when all web image props are supplied', () => {
    render(
      <DestinationImageStrip
        {...createProps({
          webImageSearchClient,
          webImageSearchContext,
          onImportWebImage: vi.fn(),
        })}
      />,
    );

    const searchInput = screen.getByLabelText('Search web images');
    const imageRegion = screen.getByRole('region', { name: 'Stop images' });
    const previewButton = within(imageRegion).getByRole('button', { name: 'Open full image: Sunset over the harbour' });

    expect(searchInput).toBeInTheDocument();
    expect(imageRegion).toContainElement(searchInput);
    expect(searchInput.compareDocumentPosition(previewButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits web image search unless every web image prop is supplied', () => {
    render(
      <DestinationImageStrip
        {...createProps({
          webImageSearchClient,
          webImageSearchContext,
        })}
      />,
    );

    expect(screen.queryByLabelText('Search web images')).not.toBeInTheDocument();
  });

  it('shows activity attribution on the selected rollup preview but not rollup thumbnails', () => {
    render(
      <DestinationImageStrip
        {...createProps({
          mediaRollupItems: [
            createMediaRollupItem(),
            createMediaRollupItem({
              mediaItem: createMediaItem({
                id: 'media-2',
                url: 'https://example.com/activity-1.jpg',
                caption: 'Market lane',
                sortOrder: 1,
              }),
              ownerType: 'activity',
              activityId: 'activity-1',
              activityTitle: 'Night market',
              canReorderInStopCarousel: false,
            }),
          ],
        })}
      />,
    );

    const activityThumbnail = screen.getByRole('button', { name: 'Show image 2: Market lane' });
    expect(within(activityThumbnail).queryByText('Night market')).not.toBeInTheDocument();

    fireEvent.click(activityThumbnail);

    expect(within(screen.getByRole('group', { name: 'Image preview' })).getByText('Night market')).toHaveClass(
      'destination-image-attribution',
    );
  });

  it('blocks stop carousel reorder when a rollup item is not reorderable in the stop carousel', () => {
    const onReorder = vi.fn();
    render(
      <DestinationImageStrip
        {...createProps({
          onReorder,
          mediaRollupItems: [
            createMediaRollupItem(),
            createMediaRollupItem({
              mediaItem: createMediaItem({
                id: 'media-2',
                url: 'https://example.com/activity-1.jpg',
                caption: 'Market lane',
                sortOrder: 1,
              }),
              ownerType: 'activity',
              activityId: 'activity-1',
              activityTitle: 'Night market',
              canReorderInStopCarousel: false,
            }),
          ],
        })}
      />,
    );

    const activityThumbnail = screen.getByRole('button', { name: 'Show image 2: Market lane' });
    expect(activityThumbnail).toHaveAttribute('draggable', 'false');
    vi.spyOn(activityThumbnail, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      width: 80,
      height: 60,
      top: 0,
      right: 180,
      bottom: 60,
      left: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' }));

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, 'clientX', { value: 110 });
    fireEvent(activityThumbnail, dragOverEvent);

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'clientX', { value: 110 });
    fireEvent(activityThumbnail, dropEvent);

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('filters rollup reorder payloads to reorderable stop-owned media ids', () => {
    const onReorder = vi.fn();
    render(
      <DestinationImageStrip
        {...createProps({
          onReorder,
          mediaRollupItems: [
            createMediaRollupItem({
              mediaItem: createMediaItem({
                id: 'stop-media-1',
                caption: 'Stop hero',
              }),
            }),
            createMediaRollupItem({
              mediaItem: createMediaItem({
                id: 'stop-media-2',
                url: 'https://example.com/stop-media-2.jpg',
                caption: 'Stop detail',
                sortOrder: 1,
              }),
            }),
            createMediaRollupItem({
              mediaItem: createMediaItem({
                id: 'activity-media-1',
                url: 'https://example.com/activity-media-1.jpg',
                caption: 'Market lane',
                sortOrder: 2,
              }),
              ownerType: 'activity',
              activityId: 'activity-1',
              activityTitle: 'Night market',
              canReorderInStopCarousel: false,
            }),
          ],
        })}
      />,
    );

    const secondStopThumbnail = screen.getByRole('button', { name: 'Show image 2: Stop detail' });
    vi.spyOn(secondStopThumbnail, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      width: 80,
      height: 60,
      top: 0,
      right: 180,
      bottom: 60,
      left: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(screen.getByRole('button', { name: 'Show image 1: Stop hero' }));

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, 'clientX', { value: 170 });
    fireEvent(secondStopThumbnail, dragOverEvent);

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'clientX', { value: 170 });
    fireEvent(secondStopThumbnail, dropEvent);

    expect(onReorder).toHaveBeenCalledWith(['stop-media-2', 'stop-media-1']);
  });
});
