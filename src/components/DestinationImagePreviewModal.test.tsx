import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../domain/types';
import { DestinationImagePreviewModal } from './DestinationImagePreviewModal';

const autosaveDelayMs = 700;
const savedStatusVisibleMs = 2400;

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
    onUpdate: vi.fn(async (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => ({
      ...createMediaItem({ id: mediaId }),
      ...patch,
    })),
    onDelete: vi.fn(),
    onMoveLeft: vi.fn(),
    onMoveRight: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function advanceAutosave(ms = autosaveDelayMs) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DestinationImagePreviewModal', () => {
  it('renders an accessible dialog with the image, caption, and credit fields', () => {
    render(<DestinationImagePreviewModal {...createProps()} />);

    const dialog = screen.getByRole('dialog', { name: 'Image preview' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('img', { name: 'Sunset over the harbour' })).toHaveAttribute(
      'src',
      'https://example.com/media-1.jpg',
    );
    expect(screen.getByLabelText('Caption')).toHaveValue('Sunset over the harbour');
    expect(screen.getByLabelText('Credit')).toHaveValue('Example photographer');
  });

  it('uses a useful generic image label when the media has no caption', () => {
    render(<DestinationImagePreviewModal {...createProps({ mediaItem: createMediaItem({ caption: '' }) })} />);

    expect(screen.getByRole('img', { name: 'Stop reference image' })).toBeInTheDocument();
  });

  it('autosaves changed caption and credit fields after the debounce, but not immediately', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn(async (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => ({
      ...createMediaItem({ id: mediaId }),
      ...patch,
    }));

    render(<DestinationImagePreviewModal {...createProps({ onUpdate })} />);

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Morning light' } });
    expect(onUpdate).not.toHaveBeenCalled();

    await advanceAutosave();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith('media-1', { caption: 'Morning light' });

    fireEvent.change(screen.getByLabelText('Credit'), { target: { value: 'Alex' } });
    await advanceAutosave();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith('media-1', { credit: 'Alex' });
  });

  it('coalesces rapid typing into one save with the final value', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn(async (mediaId: string, patch: Pick<Partial<MediaItem>, 'caption' | 'credit'>) => ({
      ...createMediaItem({ id: mediaId }),
      ...patch,
    }));

    render(<DestinationImagePreviewModal {...createProps({ onUpdate })} />);

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'First' } });
    await advanceAutosave(300);
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Second' } });
    await advanceAutosave(300);
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Final' } });
    await advanceAutosave();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('media-1', { caption: 'Final' });
  });

  it('shows saving, saved, and clears saved feedback after autosave succeeds', async () => {
    vi.useFakeTimers();
    const save = deferred<MediaItem>();
    const onUpdate = vi.fn(() => save.promise);

    render(<DestinationImagePreviewModal {...createProps({ onUpdate })} />);

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Soft blue hour' } });
    await advanceAutosave();

    expect(screen.getByRole('status', { name: 'Saving...' })).toHaveClass(
      'image-preview-save-status',
      'is-saving',
    );

    save.resolve(createMediaItem({ caption: 'Soft blue hour' }));
    await flushPromises();
    expect(screen.getByRole('status', { name: 'Saved' })).toHaveClass(
      'image-preview-save-status',
      'is-saved',
    );

    await advanceAutosave(savedStatusVisibleMs);
    expect(screen.queryByRole('status', { name: 'Saved' })).not.toBeInTheDocument();
  });

  it('shows unable to save feedback when autosave fails', async () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn().mockRejectedValue(new Error('network unavailable'));

    render(<DestinationImagePreviewModal {...createProps({ onUpdate })} />);

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Storm front' } });
    await advanceAutosave();
    await flushPromises();

    expect(screen.getByRole('status', { name: 'Unable to save' })).toHaveClass(
      'image-preview-save-status',
      'is-error',
    );
  });

  it('does not show saved feedback from a stale save after a newer edit has started', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<MediaItem>();
    const secondSave = deferred<MediaItem>();
    const onUpdate = vi.fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    render(<DestinationImagePreviewModal {...createProps({ onUpdate })} />);

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'First edit' } });
    await advanceAutosave();

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Second edit' } });
    await advanceAutosave();
    expect(onUpdate).toHaveBeenCalledTimes(2);

    firstSave.resolve(createMediaItem({ caption: 'First edit' }));
    await flushPromises();

    expect(screen.queryByRole('status', { name: 'Saved' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Saving...' })).toBeInTheDocument();

    secondSave.resolve(createMediaItem({ caption: 'Second edit' }));
    await flushPromises();
    expect(screen.getByRole('status', { name: 'Saved' })).toBeInTheDocument();
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

  it('requires confirmation before deleting an image', () => {
    const onDelete = vi.fn();

    render(<DestinationImagePreviewModal {...createProps({ onDelete })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this image?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete image' }));
    expect(onDelete).toHaveBeenCalledWith('media-1');
  });

  it('resets draft fields when the media item changes', () => {
    const { rerender } = render(<DestinationImagePreviewModal {...createProps()} />);

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Unsaved local edit' } });

    rerender(
      <DestinationImagePreviewModal
        {...createProps({
          mediaItem: createMediaItem({
            id: 'media-2',
            url: 'https://example.com/media-2.jpg',
            caption: 'Fjord morning',
            credit: 'Mina',
          }),
        })}
      />,
    );

    expect(screen.getByLabelText('Caption')).toHaveValue('Fjord morning');
    expect(screen.getByLabelText('Credit')).toHaveValue('Mina');
  });
});
