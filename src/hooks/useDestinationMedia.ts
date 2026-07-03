import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MediaItem } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';

type MediaPatch = Pick<Partial<MediaItem>, 'caption' | 'credit'>;

const VALID_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const imageTypeError = 'Choose a JPEG, PNG, WebP, or GIF image.';

export function useDestinationMedia(
  repository: TripRepository,
  destinationId: string | null,
) {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(destinationId !== null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaItemsRef = useRef<MediaItem[]>([]);
  const isMountedRef = useRef(false);
  const generationRef = useRef(0);
  const reorderSequenceRef = useRef(0);

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
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const loadMedia = useCallback(async (generation: number, nextDestinationId: string) => {
    if (!isCurrentGeneration(generation)) return;

    setIsLoading(true);
    setError(null);

    try {
      const loadedMediaItems = await repository.listDestinationMedia(nextDestinationId);
      if (!isCurrentGeneration(generation)) return;

      replaceMediaItems(loadedMediaItems);
    } catch (caught) {
      if (!isCurrentGeneration(generation)) return;

      setError(caught instanceof Error ? caught.message : 'Unable to load images.');
    } finally {
      if (isCurrentGeneration(generation)) {
        setIsLoading(false);
      }
    }
  }, [isCurrentGeneration, replaceMediaItems, repository]);

  const reload = useCallback(async () => {
    if (!destinationId) {
      replaceMediaItems([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    await loadMedia(generation, destinationId);
  }, [destinationId, loadMedia, replaceMediaItems]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsUploading(false);

    if (!destinationId) {
      replaceMediaItems([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    void loadMedia(generation, destinationId);
  }, [destinationId, loadMedia, replaceMediaItems]);

  const uploadFiles = useCallback(async (files: File[] | FileList) => {
    if (!destinationId) return;

    const validFiles = Array.from(files).filter((file) => VALID_IMAGE_TYPES.has(file.type));

    if (validFiles.length === 0) {
      setError(imageTypeError);
      return;
    }

    const generation = generationRef.current;
    setIsUploading(true);
    setError(null);

    try {
      const uploadedMediaItems = await Promise.all(
        validFiles.map((file) =>
          repository.uploadDestinationMedia({
            destinationId,
            file,
          }),
        ),
      );

      if (!isCurrentGeneration(generation)) return;

      updateMediaItems((current) => [...current, ...uploadedMediaItems]);
    } catch (caught) {
      if (!isCurrentGeneration(generation)) return;

      setError(caught instanceof Error ? caught.message : 'Unable to upload image.');
    } finally {
      if (isCurrentGeneration(generation)) {
        setIsUploading(false);
      }
    }
  }, [destinationId, isCurrentGeneration, repository, updateMediaItems]);

  const updateMedia = useCallback(async (
    mediaId: string,
    patch: MediaPatch,
  ): Promise<MediaItem | undefined> => {
    const generation = generationRef.current;
    setError(null);

    try {
      const updatedMediaItem = await repository.updateDestinationMedia(mediaId, patch);
      if (!isCurrentGeneration(generation)) return undefined;

      updateMediaItems((current) =>
        current.map((mediaItem) =>
          mediaItem.id === mediaId ? updatedMediaItem : mediaItem,
        ),
      );
      return updatedMediaItem;
    } catch (caught) {
      if (isCurrentGeneration(generation)) {
        setError(caught instanceof Error ? caught.message : 'Unable to update image.');
      }
      return undefined;
    }
  }, [isCurrentGeneration, repository, updateMediaItems]);

  const deleteMedia = useCallback(async (mediaId: string) => {
    const generation = generationRef.current;
    setError(null);

    try {
      await repository.deleteDestinationMedia(mediaId);
      if (!isCurrentGeneration(generation)) return;

      updateMediaItems((current) => current.filter((mediaItem) => mediaItem.id !== mediaId));
    } catch (caught) {
      if (isCurrentGeneration(generation)) {
        setError(caught instanceof Error ? caught.message : 'Unable to delete image.');
      }
    }
  }, [isCurrentGeneration, repository, updateMediaItems]);

  const reorder = useCallback(async (orderedMediaIds: string[]) => {
    if (!destinationId) return;

    const generation = generationRef.current;
    const reorderSequence = reorderSequenceRef.current + 1;
    reorderSequenceRef.current = reorderSequence;
    const isCurrentReorder = () =>
      isCurrentGeneration(generation) && reorderSequenceRef.current === reorderSequence;
    const previousMediaItems = mediaItemsRef.current;
    const mediaById = new Map(previousMediaItems.map((mediaItem) => [mediaItem.id, mediaItem]));
    const optimisticMediaItems = orderedMediaIds.reduce<MediaItem[]>((items, mediaId, index) => {
      const mediaItem = mediaById.get(mediaId);
      if (!mediaItem) return items;

      return [...items, { ...mediaItem, sortOrder: index }];
    }, []);

    replaceMediaItems(optimisticMediaItems);
    setError(null);

    try {
      const reorderedMediaItems = await repository.reorderDestinationMedia(
        destinationId,
        orderedMediaIds,
      );
      if (!isCurrentReorder()) return;

      replaceMediaItems(reorderedMediaItems);
    } catch (caught) {
      if (!isCurrentReorder()) return;

      replaceMediaItems(previousMediaItems);
      setError(caught instanceof Error ? caught.message : 'Unable to reorder images.');
    }
  }, [destinationId, isCurrentGeneration, replaceMediaItems, repository]);

  return {
    mediaItems,
    isLoading,
    isUploading,
    error,
    uploadFiles,
    updateMedia,
    deleteMedia,
    reorder,
    reload,
  };
}
