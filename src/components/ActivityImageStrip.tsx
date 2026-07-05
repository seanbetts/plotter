import type { MediaItem } from '../domain/types';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from '../services/webImageSearchClient';
import { MediaImageStrip } from './MediaImageStrip';
import { WebImageSearchField } from './WebImageSearchField';

export type ActivityImageStripProps = {
  mediaItems: MediaItem[];
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

export function ActivityImageStrip(props: ActivityImageStripProps) {
  const webImageSearch =
    props.webImageSearchClient && props.webImageSearchContext && props.onImportWebImage
      ? {
          client: props.webImageSearchClient,
          context: props.webImageSearchContext,
          onImportImage: props.onImportWebImage,
        }
      : null;

  return (
    <MediaImageStrip
      regionLabel="Activity images"
      emptyLabel="No images yet"
      emptyHint="Drop images here or click to add."
      chooseFilesLabel="Choose activity images"
      uploadingLabel="Uploading activity images"
      items={props.mediaItems.map((mediaItem) => ({
        mediaItem,
        canReorder: true,
      }))}
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
      onReorder={props.onReorder}
      onOpenPreview={props.onOpenPreview}
    />
  );
}
