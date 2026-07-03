import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
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
      createMediaItem({
        id: 'media-3',
        url: 'https://example.com/media-3.jpg',
        caption: '',
        sortOrder: 2,
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

function createImageFile(name = 'bergen.jpg', type = 'image/jpeg') {
  return new File(['image-bytes'], name, { type });
}

function dropFiles(element: Element, files: File[]) {
  fireEvent.drop(element, {
    dataTransfer: {
      files,
      types: ['Files'],
    },
  });
}

describe('DestinationImageStrip', () => {
  it('renders an accessible compact empty state and supports choosing files', () => {
    const onUploadFiles = vi.fn();
    render(
      <DestinationImageStrip
        {...createProps({
          mediaItems: [],
          onUploadFiles,
        })}
      />,
    );

    const region = screen.getByRole('region', { name: 'Stop images' });
    expect(region).toHaveTextContent('No images yet');

    fireEvent.click(screen.getByRole('button', { name: 'Add stop images for Bergen' }));

    const file = createImageFile();
    const input = screen.getByLabelText('Choose stop images') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
    expect(input).toHaveAttribute('multiple');

    fireEvent.change(input, { target: { files: [file] } });

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
  });

  it('renders the first media item as the hero and opens its preview when clicked', () => {
    const onOpenPreview = vi.fn();
    render(<DestinationImageStrip {...createProps({ onOpenPreview })} />);

    const hero = screen.getByRole('button', { name: 'Open hero image: Sunset over the harbour' });
    expect(within(hero).getByRole('img', { name: 'Sunset over the harbour' })).toHaveAttribute(
      'src',
      'https://example.com/media-1.jpg',
    );

    fireEvent.click(hero);

    expect(onOpenPreview).toHaveBeenCalledWith('media-1');
  });

  it('opens a thumbnail preview when clicked', () => {
    const onOpenPreview = vi.fn();
    render(<DestinationImageStrip {...createProps({ onOpenPreview })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open image 2: Mountain trail' }));

    expect(onOpenPreview).toHaveBeenCalledWith('media-2');
  });

  it('uses a fallback label for uncaptained thumbnails', () => {
    const onOpenPreview = vi.fn();
    render(<DestinationImageStrip {...createProps({ onOpenPreview })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open image 3' }));

    expect(onOpenPreview).toHaveBeenCalledWith('media-3');
  });

  it('keeps the drag state stable during file drag movement and clears it on drop', () => {
    const onUploadFiles = vi.fn();
    render(<DestinationImageStrip {...createProps({ onUploadFiles })} />);

    const region = screen.getByRole('region', { name: 'Stop images' });
    const dragOverEvent = createEvent.dragOver(region, {
      dataTransfer: {
        files: [],
        types: ['Files'],
      },
    });

    fireEvent(region, dragOverEvent);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(region).toHaveClass('is-drag-over');

    const nullTargetLeaveEvent = createEvent.dragLeave(region, {
      dataTransfer: {
        files: [],
        types: ['Files'],
      },
    });
    Object.defineProperty(nullTargetLeaveEvent, 'relatedTarget', { value: null });
    fireEvent(region, nullTargetLeaveEvent);
    expect(region).toHaveClass('is-drag-over');

    const file = createImageFile('drop.webp', 'image/webp');
    dropFiles(region, [file]);

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    expect(region).not.toHaveClass('is-drag-over');
  });

  it('reorders thumbnails by inserting the dragged image after the drop target', () => {
    const onReorder = vi.fn();
    render(<DestinationImageStrip {...createProps({ onReorder })} />);

    fireEvent.dragStart(screen.getByRole('button', { name: 'Open image 1: Sunset over the harbour' }));
    fireEvent.dragOver(screen.getByRole('button', { name: 'Open image 3' }));
    fireEvent.drop(screen.getByRole('button', { name: 'Open image 3' }));

    expect(onReorder).toHaveBeenCalledWith(['media-2', 'media-3', 'media-1']);
  });

  it('renders loading, uploading, and error feedback accessibly', () => {
    const { rerender } = render(<DestinationImageStrip {...createProps({ isLoading: true })} />);

    expect(screen.getByRole('status', { name: 'Loading images' })).toBeInTheDocument();

    rerender(<DestinationImageStrip {...createProps({ isUploading: true })} />);
    expect(screen.getByRole('status', { name: 'Uploading images' })).toBeInTheDocument();

    rerender(<DestinationImageStrip {...createProps({ error: 'Unable to upload image.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to upload image.');
  });
});
