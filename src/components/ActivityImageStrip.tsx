import type { MediaItem } from '../domain/types';
import { MediaImageStrip } from './MediaImageStrip';

export type ActivityImageStripProps = {
  mediaItems: MediaItem[];
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  onUploadFiles: (files: File[]) => Promise<void> | void;
  onReorder: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenPreview: (mediaId: string) => void;
};

export function ActivityImageStrip(props: ActivityImageStripProps) {
  return (
    <MediaImageStrip
      regionLabel="Activity images"
      emptyLabel="No activity images yet"
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
      onUploadFiles={props.onUploadFiles}
      onReorder={props.onReorder}
      onOpenPreview={props.onOpenPreview}
    />
  );
}
