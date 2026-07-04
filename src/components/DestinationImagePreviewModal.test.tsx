import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import { DestinationImagePreviewModal } from './DestinationImagePreviewModal';

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

function createProps(overrides: Partial<React.ComponentProps<typeof DestinationImagePreviewModal>> = {}) {
  return {
    mediaItem: createMediaItem(),
    canMoveLeft: true,
    canMoveRight: true,
    onDelete: vi.fn(),
    onMoveLeft: vi.fn(),
    onMoveRight: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DestinationImagePreviewModal', () => {
  it('renders an accessible image-only preview without visible metadata fields', () => {
    render(<DestinationImagePreviewModal {...createProps()} />);

    const dialog = screen.getByRole('dialog', { name: 'Image preview' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('img', { name: 'Sunset over the harbour' })).toHaveAttribute(
      'src',
      'https://example.com/media-1.jpg',
    );
    expect(within(dialog).queryByRole('heading', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Reference image')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Caption')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Credit')).not.toBeInTheDocument();
  });

  it('uses a useful generic image label when the media has no caption', () => {
    render(<DestinationImagePreviewModal {...createProps({ mediaItem: createMediaItem({ caption: '' }) })} />);

    expect(screen.getByRole('img', { name: 'Stop reference image' })).toBeInTheDocument();
  });

  it('moves left and right while respecting disabled move controls', () => {
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();

    const { rerender } = render(
      <DestinationImagePreviewModal
        {...createProps({ onMoveLeft, onMoveRight, canMoveLeft: false, canMoveRight: true })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move image left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move image right' }));

    expect(onMoveLeft).not.toHaveBeenCalled();
    expect(onMoveRight).toHaveBeenCalledWith('media-1');

    rerender(
      <DestinationImagePreviewModal
        {...createProps({ onMoveLeft, onMoveRight, canMoveLeft: true, canMoveRight: false })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move image left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move image right' }));

    expect(onMoveLeft).toHaveBeenCalledWith('media-1');
    expect(onMoveRight).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and Escape key', () => {
    const onClose = vi.fn();

    render(<DestinationImagePreviewModal {...createProps({ onClose })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close image preview' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens a confirmation popover before deleting an image', () => {
    const onDelete = vi.fn();

    render(<DestinationImagePreviewModal {...createProps({ onDelete })} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete image' });
    expect(deleteButton).toHaveTextContent('');

    fireEvent.click(deleteButton);

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Delete image confirmation' })).toBeInTheDocument();
    expect(screen.getByText('Delete this image?')).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Delete image confirmation' })).getByRole('button', {
        name: 'Delete image',
      }),
    );
    expect(onDelete).toHaveBeenCalledWith('media-1');
  });

  it('cancels the delete confirmation without deleting', () => {
    const onDelete = vi.fn();

    render(<DestinationImagePreviewModal {...createProps({ onDelete })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Delete image confirmation' })).not.toBeInTheDocument();
  });

  it('uses Escape to close the confirmation popover before closing the preview', () => {
    const onClose = vi.fn();

    render(<DestinationImagePreviewModal {...createProps({ onClose })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Delete image confirmation' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only calls delete once while a confirmed delete is pending', () => {
    const deleteRequest = deferred<void>();
    const onDelete = vi.fn().mockReturnValue(deleteRequest.promise);

    render(<DestinationImagePreviewModal {...createProps({ onDelete })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    const confirmButton = within(screen.getByRole('alertdialog', { name: 'Delete image confirmation' })).getByRole(
      'button',
      { name: 'Delete image' },
    );

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(confirmButton).toBeDisabled();
  });

  it('shows accessible delete error feedback when delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('storage unavailable'));

    render(<DestinationImagePreviewModal {...createProps({ onDelete })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Delete image confirmation' })).getByRole('button', {
        name: 'Delete image',
      }),
    );

    await flushPromises();

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to delete image.');
    expect(
      within(screen.getByRole('alertdialog', { name: 'Delete image confirmation' })).getByRole('button', {
        name: 'Delete image',
      }),
    ).not.toBeDisabled();
  });
});
