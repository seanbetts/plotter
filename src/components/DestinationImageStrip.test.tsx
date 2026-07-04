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

function fileDragEnter(element: Element) {
  fireEvent.dragEnter(element, {
    dataTransfer: {
      files: [],
      types: ['Files'],
    },
  });
}

function fileDragLeave(element: Element, relatedTarget: EventTarget | null = null) {
  const dragLeaveEvent = createEvent.dragLeave(element, {
    dataTransfer: {
      files: [],
      types: ['Files'],
    },
  });

  Object.defineProperty(dragLeaveEvent, 'relatedTarget', { value: relatedTarget });
  fireEvent(element, dragLeaveEvent);
}

function mockThumbnailBounds(element: Element) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
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
}

function dragOverThumbnail(element: Element, clientX: number) {
  const dragOverEvent = createEvent.dragOver(element);

  Object.defineProperty(dragOverEvent, 'clientX', { value: clientX });
  fireEvent(element, dragOverEvent);
}

function dropThumbnail(element: Element, clientX: number) {
  const dropEvent = createEvent.drop(element);

  Object.defineProperty(dropEvent, 'clientX', { value: clientX });
  fireEvent(element, dropEvent);
}

describe('DestinationImageStrip', () => {
  it('renders an accessible compact empty state and supports choosing files', () => {
    const onUploadFiles = vi.fn();
    const { container } = render(
      <DestinationImageStrip
        {...createProps({
          mediaItems: [],
          onUploadFiles,
        })}
      />,
    );

    const region = screen.getByRole('region', { name: 'Stop images' });
    expect(region).toHaveTextContent('No images yet');
    expect(screen.queryByRole('heading', { name: 'Stop images' })).not.toBeInTheDocument();
    expect(screen.queryByText('Bergen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(container.querySelector('.destination-image-carousel')).not.toBeInTheDocument();

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

    expect(screen.queryByRole('heading', { name: 'Stop images' })).not.toBeInTheDocument();
    expect(screen.queryByText('Bergen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add another stop image for Bergen' })).not.toBeInTheDocument();

    const hero = screen.getByRole('button', { name: 'Open hero image: Sunset over the harbour' });
    expect(within(hero).getByRole('img', { name: 'Sunset over the harbour' })).toHaveAttribute(
      'src',
      'https://example.com/media-1.jpg',
    );

    fireEvent.click(hero);

    expect(onOpenPreview).toHaveBeenCalledWith('media-1');
  });

  it('shows upload progress inside the empty image drop zone', () => {
    const { container } = render(
      <DestinationImageStrip {...createProps({ mediaItems: [], isUploading: true })} />,
    );

    const uploadTarget = screen.getByRole('button', { name: 'Uploading stop images for Bergen' });
    const uploadStatus = screen.getByRole('status', { name: 'Uploading images' });

    expect(uploadTarget).toBeDisabled();
    expect(uploadTarget).toContainElement(uploadStatus);
    expect(uploadTarget).toHaveTextContent('Uploading images...');
    expect(container.querySelector('.destination-image-upload-icon svg')).toBeInTheDocument();
    expect(container.querySelector('.destination-image-uploading')).not.toBeInTheDocument();
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

  it('keeps file drag state stable through nested movement and clears on final leave or drop', () => {
    const onUploadFiles = vi.fn();
    render(<DestinationImageStrip {...createProps({ onUploadFiles })} />);

    const region = screen.getByRole('region', { name: 'Stop images' });
    const firstThumbnail = screen.getByRole('button', { name: 'Open image 1: Sunset over the harbour' });
    fileDragEnter(region);
    fileDragEnter(firstThumbnail);
    expect(region).toHaveClass('is-drag-over');

    fileDragLeave(firstThumbnail);
    expect(region).toHaveClass('is-drag-over');

    fileDragLeave(region);
    expect(region).not.toHaveClass('is-drag-over');

    const dragOverEvent = createEvent.dragOver(region, {
      dataTransfer: {
        files: [],
        types: ['Files'],
      },
    });

    fireEvent(region, dragOverEvent);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(region).toHaveClass('is-drag-over');

    const file = createImageFile('drop.webp', 'image/webp');
    dropFiles(region, [file]);

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    expect(region).not.toHaveClass('is-drag-over');
  });

  it('drops the dragged thumbnail after the target when hovering the right half', () => {
    const onReorder = vi.fn();
    render(<DestinationImageStrip {...createProps({ onReorder })} />);
    const thirdThumbnail = screen.getByRole('button', { name: 'Open image 3' });
    mockThumbnailBounds(thirdThumbnail);

    fireEvent.dragStart(screen.getByRole('button', { name: 'Open image 1: Sunset over the harbour' }));
    dragOverThumbnail(thirdThumbnail, 170);
    expect(thirdThumbnail).toHaveClass('is-drop-after');
    dropThumbnail(thirdThumbnail, 170);

    expect(onReorder).toHaveBeenCalledWith(['media-2', 'media-3', 'media-1']);
  });

  it('drops the dragged thumbnail before the target when hovering the left half', () => {
    const onReorder = vi.fn();
    render(<DestinationImageStrip {...createProps({ onReorder })} />);
    const firstThumbnail = screen.getByRole('button', { name: 'Open image 1: Sunset over the harbour' });
    mockThumbnailBounds(firstThumbnail);

    fireEvent.dragStart(screen.getByRole('button', { name: 'Open image 3' }));
    dragOverThumbnail(firstThumbnail, 110);
    expect(firstThumbnail).toHaveClass('is-drop-before');
    dropThumbnail(firstThumbnail, 110);

    expect(onReorder).toHaveBeenCalledWith(['media-3', 'media-1', 'media-2']);
  });

  it('renders loading, hero upload, and error feedback accessibly', () => {
    const { container, rerender } = render(<DestinationImageStrip {...createProps({ isLoading: true })} />);

    expect(screen.getByRole('status', { name: 'Loading images' })).toBeInTheDocument();

    rerender(<DestinationImageStrip {...createProps({ isUploading: true })} />);
    const uploadStatus = screen.getByRole('status', { name: 'Uploading images' });
    expect(uploadStatus.closest('.destination-image-hero')).toBeInTheDocument();
    expect(container.querySelector('.destination-image-uploading')).not.toBeInTheDocument();

    rerender(<DestinationImageStrip {...createProps({ error: 'Unable to upload image.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to upload image.');
  });
});
