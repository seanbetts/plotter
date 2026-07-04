import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import { ActivityImageStrip } from './ActivityImageStrip';

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'media-1',
    url: 'https://example.com/activity-1.jpg',
    caption: 'Market stall',
    credit: 'Example photographer',
    sortOrder: 0,
    ...overrides,
  };
}

function createProps(overrides: Partial<React.ComponentProps<typeof ActivityImageStrip>> = {}) {
  return {
    mediaItems: [
      createMediaItem(),
      createMediaItem({
        id: 'media-2',
        url: 'https://example.com/activity-2.jpg',
        caption: 'Dinner counter',
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

describe('ActivityImageStrip', () => {
  it('renders activity image labels through the shared media strip', () => {
    render(<ActivityImageStrip {...createProps({ mediaItems: [] })} />);

    const region = screen.getByRole('region', { name: 'Activity images' });
    expect(region).toHaveTextContent('No activity images yet');
    expect(region).toHaveTextContent('Drop images here or click to add.');
    expect(screen.getByRole('button', { name: 'Choose activity images' })).toBeInTheDocument();
  });

  it('passes activity images as owner-local reorderable media items', () => {
    const onReorder = vi.fn();
    render(<ActivityImageStrip {...createProps({ onReorder })} />);

    const secondThumbnail = screen.getByRole('button', { name: 'Show image 2: Dinner counter' });
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

    fireEvent.dragStart(screen.getByRole('button', { name: 'Show image 1: Market stall' }));

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, 'clientX', { value: 170 });
    fireEvent(secondThumbnail, dragOverEvent);

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'clientX', { value: 170 });
    fireEvent(secondThumbnail, dropEvent);

    expect(onReorder).toHaveBeenCalledWith(['media-2', 'media-1']);
  });
});
