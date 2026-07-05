import type { MediaItem, MediaRollupItem } from '../domain/types';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from '../services/webImageSearchClient';
import { MediaImageStrip } from './MediaImageStrip';
import type { MediaStripItem } from './MediaImageStrip';
import { WebImageSearchField } from './WebImageSearchField';

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
  webImageSearchClient?: WebImageSearchClient;
  webImageSearchContext?: WebImageSearchStopContext;
  onImportWebImage?: (result: WebImageSearchResult) => Promise<void> | void;
};

function getMediaStripItems(props: DestinationImageStripProps): MediaStripItem[] {
  if (props.mediaRollupItems) {
    return props.mediaRollupItems.map((rollupItem) => ({
      mediaItem: rollupItem.mediaItem,
      attribution: rollupItem.activityTitle,
      thumbnailAttribution: null,
      canReorder: rollupItem.canReorderInStopCarousel,
    }));
  }

  return props.mediaItems.map((mediaItem) => ({
    mediaItem,
    canReorder: true,
  }));
}

export function DestinationImageStrip(props: DestinationImageStripProps) {
  const webImageSearch =
    props.webImageSearchClient && props.webImageSearchContext && props.onImportWebImage
      ? {
          client: props.webImageSearchClient,
          context: props.webImageSearchContext,
          onImportImage: props.onImportWebImage,
        }
      : null;

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
      controls={webImageSearch ? (
        <WebImageSearchField
          client={webImageSearch.client}
          context={webImageSearch.context}
          onImportImage={webImageSearch.onImportImage}
        />
      ) : null}
      onUploadFiles={props.onUploadFiles}
      onReorder={handleReorder}
      onOpenPreview={props.onOpenPreview}
    />
  );
}
