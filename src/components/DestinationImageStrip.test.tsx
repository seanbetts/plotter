import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
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
});
