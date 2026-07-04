import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import { MediaImageStrip } from './MediaImageStrip';

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

function createProps(overrides: Partial<React.ComponentProps<typeof MediaImageStrip>> = {}) {
  return {
    regionLabel: 'Stop images',
    emptyLabel: 'No images yet',
    emptyHint: 'Drop images here or click to add.',
    chooseFilesLabel: 'Choose stop images',
    uploadingLabel: 'Uploading stop images',
    items: [
      { mediaItem: createMediaItem(), canReorder: true },
      {
        mediaItem: createMediaItem({
          id: 'media-2',
          url: 'https://example.com/media-2.jpg',
          caption: 'Mountain trail',
          sortOrder: 1,
        }),
        canReorder: true,
      },
      {
        mediaItem: createMediaItem({
          id: 'media-3',
          url: 'https://example.com/media-3.jpg',
          caption: '',
          sortOrder: 2,
        }),
        canReorder: true,
      },
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

function fileDragLeave(element: Element) {
  fireEvent.dragLeave(element, {
    dataTransfer: {
      files: [],
      types: ['Files'],
    },
  });
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MediaImageStrip', () => {
  it('renders an accessible compact empty state and supports choosing files', () => {
    const onUploadFiles = vi.fn();
    const { container } = render(<MediaImageStrip {...createProps({ items: [], onUploadFiles })} />);

    const region = screen.getByRole('region', { name: 'Stop images' });
    expect(region).toHaveTextContent('No images yet');
    expect(region).toHaveTextContent('Drop images here or click to add.');
    expect(screen.queryByRole('heading', { name: 'Stop images' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(container.querySelector('.destination-image-empty-graphic')).toBeInTheDocument();
    const placeholderCarousel = container.querySelector('.destination-image-carousel.is-empty');
    expect(placeholderCarousel).toHaveAttribute('aria-hidden', 'true');
    expect(placeholderCarousel?.querySelector('.destination-image-thumbnail-placeholder')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Choose stop images' }));

    const file = createImageFile();
    const input = screen.getByLabelText('Choose stop images file input') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
    expect(input).toHaveAttribute('multiple');

    fireEvent.change(input, { target: { files: [file] } });

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
  });

  it('renders the first media item as the preview and opens the full image when clicked', () => {
    const onOpenPreview = vi.fn();
    render(<MediaImageStrip {...createProps({ onOpenPreview })} />);

    const hero = screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' });
    expect(within(hero).getByRole('img', { name: 'Sunset over the harbour' })).toHaveAttribute(
      'src',
      'https://example.com/media-1.jpg',
    );

    fireEvent.click(hero);

    expect(onOpenPreview).toHaveBeenCalledWith('media-1');
  });

  it('keeps the loading shell visible until the hero image is ready to display', () => {
    const imageInstances: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';

      constructor() {
        imageInstances.push(this);
      }
    }
    vi.stubGlobal('Image', FakeImage);

    render(<MediaImageStrip {...createProps({ items: [{ mediaItem: createMediaItem(), canReorder: true }] })} />);

    expect(screen.getByRole('status', { name: 'Loading images' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open full image: Sunset over the harbour' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show image 1: Sunset over the harbour' })).not.toBeInTheDocument();

    act(() => {
      imageInstances[0]?.onload?.();
    });

    expect(screen.queryByRole('status', { name: 'Loading images' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' })).toBeInTheDocument();
  });

  it('selects thumbnails into the preview without opening the full image', () => {
    const onOpenPreview = vi.fn();
    render(<MediaImageStrip {...createProps({ onOpenPreview })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 2: Mountain trail' }));

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open full image: Mountain trail' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show image 3' }));
    expect(screen.getByRole('button', { name: 'Open full image' })).toBeInTheDocument();
  });

  it('loops the selected preview image with overlay arrows and focused strip arrow keys', () => {
    const onOpenPreview = vi.fn();
    render(<MediaImageStrip {...createProps({ onOpenPreview })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Previous preview image' }));
    expect(screen.getByRole('button', { name: 'Open full image' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next preview image' }));
    expect(screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('button', { name: 'Open full image: Mountain trail' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Open full image: Mountain trail' }), {
      key: 'ArrowLeft',
    });
    expect(screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' })).toBeInTheDocument();
    expect(onOpenPreview).not.toHaveBeenCalled();
  });

  it('only advances the strip that contains keyboard focus when multiple strips are mounted', () => {
    render(
      <>
        <MediaImageStrip {...createProps({ regionLabel: 'Stop images' })} />
        <MediaImageStrip
          {...createProps({
            regionLabel: 'Activity images',
            chooseFilesLabel: 'Choose activity images',
            uploadingLabel: 'Uploading activity images',
            items: [
              {
                mediaItem: createMediaItem({
                  id: 'activity-media-1',
                  url: 'https://example.com/activity-media-1.jpg',
                  caption: 'Activity hero',
                }),
                canReorder: true,
              },
              {
                mediaItem: createMediaItem({
                  id: 'activity-media-2',
                  url: 'https://example.com/activity-media-2.jpg',
                  caption: 'Activity detail',
                }),
                canReorder: true,
              },
            ],
          })}
        />
      </>,
    );

    const stopRegion = screen.getByRole('region', { name: 'Stop images' });
    const activityRegion = screen.getByRole('region', { name: 'Activity images' });

    stopRegion.focus();
    fireEvent.keyDown(stopRegion, { key: 'ArrowRight' });

    expect(within(stopRegion).getByRole('button', { name: 'Open full image: Mountain trail' })).toBeInTheDocument();
    expect(within(activityRegion).getByRole('button', { name: 'Open full image: Activity hero' })).toBeInTheDocument();
  });

  it('does not hijack left and right arrow keys from editable controls', () => {
    const textInput = document.createElement('input');
    document.body.append(textInput);

    try {
      render(<MediaImageStrip {...createProps()} />);
      textInput.focus();

      fireEvent.keyDown(window, { key: 'ArrowRight' });

      expect(screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' })).toBeInTheDocument();
    } finally {
      textInput.remove();
    }
  });

  it('preloads adjacent preview images and uses optimized preview and thumbnail URLs', () => {
    const preloadedUrls: string[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      complete = true;
      #src = '';

      get src() {
        return this.#src;
      }

      set src(value: string) {
        this.#src = value;
        preloadedUrls.push(value);
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', FakeImage);

    render(
      <MediaImageStrip
        {...createProps({
          items: [
            {
              mediaItem: createMediaItem({
                previewUrl: 'https://example.com/media-1-preview.webp',
                thumbnailUrl: 'https://example.com/media-1-thumbnail.webp',
              }),
              canReorder: true,
            },
            {
              mediaItem: createMediaItem({
                id: 'media-2',
                url: 'https://example.com/media-2.jpg',
                previewUrl: 'https://example.com/media-2-preview.webp',
                thumbnailUrl: 'https://example.com/media-2-thumbnail.webp',
                caption: 'Mountain trail',
                sortOrder: 1,
              }),
              canReorder: true,
            },
            {
              mediaItem: createMediaItem({
                id: 'media-3',
                url: 'https://example.com/media-3.jpg',
                previewUrl: 'https://example.com/media-3-preview.webp',
                caption: '',
                sortOrder: 2,
              }),
              canReorder: true,
            },
          ],
        })}
      />,
    );

    const hero = screen.getByRole('button', { name: 'Open full image: Sunset over the harbour' });
    expect(within(hero).getByRole('img', { name: 'Sunset over the harbour' })).toHaveAttribute(
      'src',
      'https://example.com/media-1-preview.webp',
    );
    expect(
      within(screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' })).getByRole('img', {
        name: 'Sunset over the harbour',
      }),
    ).toHaveAttribute('src', 'https://example.com/media-1-thumbnail.webp');
    expect(
      within(screen.getByRole('button', { name: 'Show image 2: Mountain trail' })).getByRole('img', {
        name: 'Mountain trail',
      }),
    ).toHaveAttribute('src', 'https://example.com/media-2-thumbnail.webp');
    expect(preloadedUrls).toEqual(
      expect.arrayContaining([
        'https://example.com/media-2-preview.webp',
        'https://example.com/media-3-preview.webp',
      ]),
    );
  });

  it('keeps file drag state stable through nested movement and clears on final leave or drop', () => {
    const onUploadFiles = vi.fn();
    render(<MediaImageStrip {...createProps({ onUploadFiles })} />);

    const region = screen.getByRole('region', { name: 'Stop images' });
    const firstThumbnail = screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' });
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

  it('reorders thumbnails around the drop target when both items are reorderable', () => {
    const onReorder = vi.fn();
    render(<MediaImageStrip {...createProps({ onReorder })} />);
    const thirdThumbnail = screen.getByRole('button', { name: 'Show image 3' });
    mockThumbnailBounds(thirdThumbnail);

    fireEvent.dragStart(screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' }));
    dragOverThumbnail(thirdThumbnail, 170);
    expect(thirdThumbnail).toHaveClass('is-drop-after');
    dropThumbnail(thirdThumbnail, 170);

    expect(onReorder).toHaveBeenCalledWith(['media-2', 'media-3', 'media-1']);
  });

  it('does not reorder when the dragged or target thumbnail is not reorderable', () => {
    const onReorder = vi.fn();
    render(
      <MediaImageStrip
        {...createProps({
          onReorder,
          items: [
            { mediaItem: createMediaItem(), canReorder: true },
            {
              mediaItem: createMediaItem({
                id: 'media-2',
                url: 'https://example.com/media-2.jpg',
                caption: 'Market lane',
                sortOrder: 1,
              }),
              attribution: 'Night market',
              canReorder: false,
            },
            {
              mediaItem: createMediaItem({
                id: 'media-3',
                url: 'https://example.com/media-3.jpg',
                caption: 'Mountain trail',
                sortOrder: 2,
              }),
              canReorder: true,
            },
          ],
        })}
      />,
    );

    const rollupThumbnail = screen.getByRole('button', { name: 'Show image 2: Market lane' });
    mockThumbnailBounds(rollupThumbnail);
    fireEvent.dragStart(screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' }));
    dragOverThumbnail(rollupThumbnail, 110);
    dropThumbnail(rollupThumbnail, 110);

    expect(onReorder).not.toHaveBeenCalled();

    const firstThumbnail = screen.getByRole('button', { name: 'Show image 1: Sunset over the harbour' });
    mockThumbnailBounds(firstThumbnail);
    fireEvent.dragStart(rollupThumbnail);
    dragOverThumbnail(firstThumbnail, 170);
    dropThumbnail(firstThumbnail, 170);

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('renders attribution on activity-owned thumbnails and the selected preview', () => {
    render(
      <MediaImageStrip
        {...createProps({
          items: [
            { mediaItem: createMediaItem(), canReorder: true },
            {
              mediaItem: createMediaItem({
                id: 'media-2',
                url: 'https://example.com/media-2.jpg',
                caption: 'Market lane',
                sortOrder: 1,
              }),
              attribution: 'Night market',
              canReorder: false,
            },
          ],
        })}
      />,
    );

    const thumbnail = screen.getByRole('button', { name: 'Show image 2: Market lane' });
    expect(within(thumbnail).getByText('Night market')).toBeInTheDocument();

    fireEvent.click(thumbnail);

    const preview = screen.getByRole('group', { name: 'Image preview' });
    expect(within(preview).getByText('Night market')).toBeInTheDocument();
  });

  it('renders loading, upload, and error feedback accessibly', () => {
    const { container, rerender } = render(<MediaImageStrip {...createProps({ isLoading: true })} />);

    const loadingStatus = screen.getByRole('status', { name: 'Loading images' });
    expect(loadingStatus).toHaveClass('destination-image-empty', 'is-loading');
    expect(container.querySelector('.destination-image-loading-spinner')).toBeInTheDocument();
    expect(container.querySelector('.destination-image-carousel.is-empty')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.destination-image-thumbnail-placeholder')).toBeInTheDocument();

    rerender(<MediaImageStrip {...createProps({ items: [], isUploading: true })} />);
    const uploadTarget = screen.getByRole('button', { name: 'Uploading stop images' });
    const uploadStatus = screen.getByRole('status', { name: 'Uploading stop images' });
    expect(uploadTarget).toBeDisabled();
    expect(uploadTarget).toContainElement(uploadStatus);
    expect(container.querySelector('.destination-image-upload-icon svg')).toBeInTheDocument();

    rerender(<MediaImageStrip {...createProps({ isUploading: true })} />);
    expect(screen.getByRole('status', { name: 'Uploading stop images' }).closest('.destination-image-hero')).toBeInTheDocument();

    rerender(<MediaImageStrip {...createProps({ error: 'Unable to upload image.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to upload image.');
  });
});
