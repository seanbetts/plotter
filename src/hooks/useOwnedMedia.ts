import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MediaItem } from '../domain/types';
import { normalizeImageFile } from '../media/imageOptimization';

type MediaPatch = Pick<Partial<MediaItem>, 'caption' | 'credit'>;

export type OwnedMediaRepository = {
  list(): Promise<MediaItem[]>;
  upload(file: File): Promise<MediaItem>;
  update(mediaId: string, patch: MediaPatch): Promise<MediaItem>;
  delete(mediaId: string): Promise<void>;
  reorder(orderedMediaIds: string[]): Promise<MediaItem[]>;
};

export type UseOwnedMediaInput = {
  ownerId: string | null;
  repository: OwnedMediaRepository;
  migrationErrorNeedle?: string;
};

const VALID_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const imageTypeError = 'Choose a JPEG, PNG, WebP, or GIF image.';
const mediaOrderingMigrationError =
  'Images need the latest database migration before they can load.';

function formatMediaError(caught: unknown, fallbackMessage: string, migrationErrorNeedle?: string) {
  if (!(caught instanceof Error)) {
    return fallbackMessage;
  }

  if (
    migrationErrorNeedle &&
    caught.message.includes(migrationErrorNeedle) &&
    caught.message.includes('does not exist')
  ) {
    return mediaOrderingMigrationError;
  }

  return caught.message || fallbackMessage;
}

function sortMediaItems(mediaItems: MediaItem[]) {
  return mediaItems
    .map((mediaItem, index) => ({ mediaItem, index }))
    .sort((left, right) => {
      const leftSortOrder = left.mediaItem.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightSortOrder = right.mediaItem.sortOrder ?? Number.MAX_SAFE_INTEGER;

      return leftSortOrder - rightSortOrder || left.index - right.index;
    })
    .map(({ mediaItem }) => mediaItem);
}

function validateMediaOrder(currentMediaIds: string[], orderedMediaIds: string[]) {
  const requestedIds = new Set(orderedMediaIds);
  const missingIds = currentMediaIds.filter((id) => !requestedIds.has(id));
  const extraIds = orderedMediaIds.filter((id) => !currentMediaIds.includes(id));

  if (requestedIds.size === orderedMediaIds.length && missingIds.length === 0 && extraIds.length === 0) {
    return null;
  }

  return `Media order must include each media item exactly once. Missing ${missingIds.join(', ') || 'none'}; extra ${extraIds.join(', ') || 'none'}.`;
}

export function useOwnedMedia({
  ownerId,
  repository,
  migrationErrorNeedle,
}: UseOwnedMediaInput) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(ownerId !== null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaItemsRef = useRef<MediaItem[]>([]);
  const isMountedRef = useRef(false);
  const generationRef = useRef(0);
  const repositoryRef = useRef(repository);
  const reorderSequenceRef = useRef(0);
  const updateSequencesRef = useRef(new Map<string, number>());

  const replaceMediaItems = useCallback((nextMediaItems: MediaItem[]) => {
    mediaItemsRef.current = nextMediaItems;
    setMediaItems(nextMediaItems);
  }, []);

  const updateMediaItems = useCallback((updater: (current: MediaItem[]) => MediaItem[]) => {
    const nextMediaItems = updater(mediaItemsRef.current);
    mediaItemsRef.current = nextMediaItems;
    setMediaItems(nextMediaItems);
    return nextMediaItems;
  }, []);

  const isCurrentGeneration = useCallback(
    (generation: number) => isMountedRef.current && generationRef.current === generation,
    [],
  );

  useLayoutEffect(() => {
    repositoryRef.current = repository;
  }, [repository]);

  useLayoutEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const loadMedia = useCallback(async (generation: number) => {
    if (!isCurrentGeneration(generation)) return;

    setIsLoading(true);
    setError(null);

    try {
      const loadedMediaItems = await repositoryRef.current.list();
      if (!isCurrentGeneration(generation)) return;

      replaceMediaItems(loadedMediaItems);
    } catch (caught) {
      if (!isCurrentGeneration(generation)) return;

      setError(formatMediaError(caught, 'Unable to load images.', migrationErrorNeedle));
    } finally {
      if (isCurrentGeneration(generation)) {
        setIsLoading(false);
      }
    }
  }, [isCurrentGeneration, migrationErrorNeedle, replaceMediaItems]);

  const startMediaGeneration = useCallback(async (nextOwnerId: string | null) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setUploadingCount(0);

    if (!nextOwnerId) {
      replaceMediaItems([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    await loadMedia(generation);
  }, [loadMedia, replaceMediaItems]);

  const reload = useCallback(async () => {
    await startMediaGeneration(ownerId);
  }, [ownerId, startMediaGeneration]);

  useEffect(() => {
    let isCancelled = false;

    queueMicrotask(() => {
      if (isCancelled) return;

      void startMediaGeneration(ownerId);
    });

    return () => {
      isCancelled = true;
    };
  }, [ownerId, startMediaGeneration]);

  const uploadFiles = useCallback(async (files: File[] | FileList) => {
    if (!ownerId) return;

    const validFiles = Array.from(files).filter((file) => VALID_IMAGE_TYPES.has(file.type));

    if (validFiles.length === 0) {
      setError(imageTypeError);
      return;
    }

    const generation = generationRef.current;
    const activeRepository = repositoryRef.current;
    setUploadingCount((count) => count + 1);
    setError(null);

    try {
      const uploadedMediaItems = await Promise.all(
        validFiles.map(async (file) =>
          activeRepository.upload(await normalizeImageFile(file)),
        ),
      );

      if (!isCurrentGeneration(generation)) return;

      updateMediaItems((current) => sortMediaItems([...current, ...uploadedMediaItems]));
    } catch (caught) {
      if (!isCurrentGeneration(generation)) return;

      setError(formatMediaError(caught, 'Unable to upload image.', migrationErrorNeedle));
    } finally {
      if (isCurrentGeneration(generation)) {
        setUploadingCount((count) => Math.max(0, count - 1));
      }
    }
  }, [isCurrentGeneration, migrationErrorNeedle, ownerId, updateMediaItems]);

  const updateMedia = useCallback(async (
    mediaId: string,
    patch: MediaPatch,
  ): Promise<MediaItem | undefined> => {
    const generation = generationRef.current;
    const updateSequence = (updateSequencesRef.current.get(mediaId) ?? 0) + 1;
    updateSequencesRef.current.set(mediaId, updateSequence);
    const isCurrentUpdate = () =>
      isCurrentGeneration(generation) &&
      updateSequencesRef.current.get(mediaId) === updateSequence;

    setError(null);

    try {
      const updatedMediaItem = await repositoryRef.current.update(mediaId, patch);
      if (!isCurrentUpdate()) return undefined;

      updateMediaItems((current) =>
        current.map((mediaItem) =>
          mediaItem.id === mediaId ? updatedMediaItem : mediaItem,
        ),
      );
      return updatedMediaItem;
    } catch (caught) {
      if (isCurrentUpdate()) {
        setError(formatMediaError(caught, 'Unable to update image.', migrationErrorNeedle));
      }
      return undefined;
    }
  }, [isCurrentGeneration, migrationErrorNeedle, updateMediaItems]);

  const deleteMedia = useCallback(async (mediaId: string) => {
    const generation = generationRef.current;
    setError(null);

    try {
      await repositoryRef.current.delete(mediaId);
      if (!isCurrentGeneration(generation)) return;

      updateMediaItems((current) => current.filter((mediaItem) => mediaItem.id !== mediaId));
    } catch (caught) {
      if (isCurrentGeneration(generation)) {
        const error = new Error(formatMediaError(caught, 'Unable to delete image.', migrationErrorNeedle));
        setError(error.message);
        throw error;
      }
    }
  }, [isCurrentGeneration, migrationErrorNeedle, updateMediaItems]);

  const reorder = useCallback(async (orderedMediaIds: string[]) => {
    if (!ownerId) return;

    const generation = generationRef.current;
    const reorderSequence = reorderSequenceRef.current + 1;
    const previousMediaItems = mediaItemsRef.current;
    const orderError = validateMediaOrder(
      previousMediaItems.map((mediaItem) => mediaItem.id),
      orderedMediaIds,
    );

    if (orderError) {
      setError(orderError);
      return;
    }

    reorderSequenceRef.current = reorderSequence;
    const isCurrentReorder = () =>
      isCurrentGeneration(generation) && reorderSequenceRef.current === reorderSequence;
    const mediaById = new Map(previousMediaItems.map((mediaItem) => [mediaItem.id, mediaItem]));
    const optimisticMediaItems = orderedMediaIds.reduce<MediaItem[]>((items, mediaId, index) => {
      const mediaItem = mediaById.get(mediaId);
      if (!mediaItem) return items;

      return [...items, { ...mediaItem, sortOrder: index }];
    }, []);

    replaceMediaItems(optimisticMediaItems);
    setError(null);

    try {
      const reorderedMediaItems = await repositoryRef.current.reorder(orderedMediaIds);
      if (!isCurrentReorder()) return;

      replaceMediaItems(reorderedMediaItems);
    } catch (caught) {
      if (!isCurrentReorder()) return;

      replaceMediaItems(previousMediaItems);
      setError(formatMediaError(caught, 'Unable to reorder images.', migrationErrorNeedle));
    }
  }, [isCurrentGeneration, migrationErrorNeedle, ownerId, replaceMediaItems]);

  return {
    mediaItems,
    isLoading,
    isUploading: uploadingCount > 0,
    error,
    uploadFiles,
    updateMedia,
    deleteMedia,
    reorder,
    reload,
  };
}
