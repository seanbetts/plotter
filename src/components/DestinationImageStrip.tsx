import type { MediaItem, MediaRollupItem } from '../domain/types';
import { MediaImageStrip } from './MediaImageStrip';
import type { MediaStripItem } from './MediaImageStrip';

export type DestinationImageStripProps = {
  destinationName: string;
  mediaItems: MediaItem[];
  mediaRollupItems?: MediaRollupItem[];
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  onUploadFiles: (files: File[]) => Promise<void> | void;
  onReorder: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenPreview: (mediaId: string) => void;
};

function getMediaStripItems(props: DestinationImageStripProps): MediaStripItem[] {
  if (props.mediaRollupItems) {
    return props.mediaRollupItems.map((rollupItem) => ({
      mediaItem: rollupItem.mediaItem,
      attribution: rollupItem.activityTitle,
      canReorder: rollupItem.canReorderInStopCarousel,
    }));
  }

  return props.mediaItems.map((mediaItem) => ({
    mediaItem,
    canReorder: true,
  }));
}

export function DestinationImageStrip(props: DestinationImageStripProps) {
  const handleReorder = (orderedMediaIds: string[]) => {
    if (!props.mediaRollupItems) {
      return props.onReorder(orderedMediaIds);
    }

    const reorderableDestinationMediaIds = new Set(
      props.mediaRollupItems
        .filter((rollupItem) => rollupItem.ownerType === 'destination' && rollupItem.canReorderInStopCarousel)
        .map((rollupItem) => rollupItem.mediaItem.id),
    );

    return props.onReorder(orderedMediaIds.filter((mediaId) => reorderableDestinationMediaIds.has(mediaId)));
  };

  return (
    <MediaImageStrip
      regionLabel="Stop images"
      emptyLabel="No images yet"
      emptyHint="Drop images here or click to add."
      chooseFilesLabel="Choose stop images"
      uploadingLabel="Uploading stop images"
      items={getMediaStripItems(props)}
      isLoading={props.isLoading}
      isUploading={props.isUploading}
      error={props.error}
      onUploadFiles={props.onUploadFiles}
      onReorder={handleReorder}
      onOpenPreview={props.onOpenPreview}
    />
  );
}
