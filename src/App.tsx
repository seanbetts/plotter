import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createBoundingBoxAroundCoordinates,
  resolveMapTilerCoordinates,
  searchMapTilerPlaces,
} from './adapters/geocoding';
import { calculateOpenRouteServiceRoute } from './adapters/openRouteService';
import { ActivityPanel } from './components/ActivityPanel';
import { DestinationImagePreviewModal } from './components/DestinationImagePreviewModal';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import type { MapAddStopRequest } from './components/MapCanvas';
import { TopToolbar } from './components/TopToolbar';
import { createLegacyLocation, formatLocationParts } from './domain/locations';
import type { Activity, ActivityLocation, Coordinates, DestinationLocation, MediaRollupItem } from './domain/types';
import { useActivityMedia } from './hooks/useActivityMedia';
import { useDestinationMedia } from './hooks/useDestinationMedia';
import { useTripData } from './hooks/useTripData';
import { preloadImageUrls } from './media/imagePreloading';
import { createAppTripRepository } from './storage/appRepository';
import type { TripRepository } from './storage/tripRepository';
import './styles.css';

const openRouteServiceApiKey = import.meta.env.VITE_OPENROUTESERVICE_API_KEY ?? '';
const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';
const mobileWorkspacePanelsQuery = '(max-width: 760px)';

type RepositoryError = {
  title: string;
  message: string;
};

type PendingMapStop = {
  id: number;
  coordinates: Coordinates;
  screenPosition: MapAddStopRequest['screenPosition'];
  source: MapAddStopRequest['source'];
  name: string;
  location: DestinationLocation;
  isResolving: boolean;
  isSaving: boolean;
  resolveError: string | null;
  saveError: string | null;
};

type OverlayPosition = {
  x: number;
  y: number;
};

type PreviewMediaSource = 'destination-rollup' | 'activity';
type PreviewMediaSelection = {
  mediaId: string;
  source: PreviewMediaSource;
};

const overlayViewportPaddingPx = 16;
const activitySearchRadiusKm = 100;
const mapStopConfirmationApproxSize = {
  width: 320,
  height: 260,
};

function formatRepositoryError(caught: unknown): RepositoryError {
  const message = caught instanceof Error ? caught.message : 'Unable to prepare trip storage';

  if (message.includes('Supabase is not configured')) {
    return {
      title: 'Supabase is not configured',
      message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
    };
  }

  if (message.includes('row-level security') || message.includes('permission denied')) {
    return {
      title: 'Supabase permission denied',
      message,
    };
  }

  return {
    title: 'Trip storage unavailable',
    message,
  };
}

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function formatCoordinatePair(coordinates: Coordinates) {
  return `${formatCoordinate(coordinates.lat)}, ${formatCoordinate(coordinates.lng)}`;
}

function getFullMediaImageUrl(mediaItem: { fullUrl?: string; previewUrl?: string; url: string }) {
  return mediaItem.fullUrl ?? mediaItem.previewUrl ?? mediaItem.url;
}

function createFallbackMapStop(coordinates: Coordinates): Pick<PendingMapStop, 'name' | 'location'> {
  const name = 'Dropped pin';

  return {
    name,
    location: createLegacyLocation({
      name,
      countryRegion: formatCoordinatePair(coordinates),
    }),
  };
}

function clampOverlayPosition(
  position: OverlayPosition,
  size: { width: number; height: number },
): OverlayPosition {
  if (typeof window === 'undefined') return position;

  return {
    x: Math.min(
      Math.max(overlayViewportPaddingPx, position.x),
      Math.max(overlayViewportPaddingPx, window.innerWidth - size.width - overlayViewportPaddingPx),
    ),
    y: Math.min(
      Math.max(overlayViewportPaddingPx, position.y),
      Math.max(overlayViewportPaddingPx, window.innerHeight - size.height - overlayViewportPaddingPx),
    ),
  };
}

function getAvailableOverlayHeight(position: OverlayPosition) {
  if (typeof window === 'undefined') return `calc(100vh - ${overlayViewportPaddingPx * 2}px)`;

  return `${Math.max(
    overlayViewportPaddingPx,
    window.innerHeight - position.y - overlayViewportPaddingPx,
  )}px`;
}

export default function App() {
  const [repository, setRepository] = useState<TripRepository | null>(null);
  const [repositoryError, setRepositoryError] = useState<RepositoryError | null>(null);

  useEffect(() => {
    let isCancelled = false;

    createAppTripRepository()
      .then((nextRepository) => {
        if (isCancelled) return;

        setRepository(nextRepository);
      })
      .catch((caught) => {
        if (isCancelled) return;

        setRepositoryError(formatRepositoryError(caught));
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!repository) {
    return (
      <main className="app-shell">
        <section className="map-stage" aria-label="World tour map workspace">
          <MapCanvas
            destinations={[]}
            routeLegs={[]}
            selectedDestinationId={null}
            onSelectDestination={() => undefined}
          />
          <div
            className={repositoryError ? 'app-status app-status-error' : 'app-status'}
            role={repositoryError ? 'alert' : 'status'}
          >
            {repositoryError ? (
              <>
                <strong>{repositoryError.title}</strong>
                <span>{repositoryError.message}</span>
              </>
            ) : (
              'Loading trip data'
            )}
          </div>
        </section>
      </main>
    );
  }

  return <TripWorkspace repository={repository} />;
}

function TripWorkspace({ repository }: { repository: TripRepository }) {
  const calculateRoute = useCallback(
    (input: Omit<Parameters<typeof calculateOpenRouteServiceRoute>[0], 'apiKey'>) =>
      calculateOpenRouteServiceRoute({
        ...input,
        apiKey: openRouteServiceApiKey,
      }),
    [],
  );
  const {
    destinations,
    routeLegs,
    activitiesByDestinationId,
    isLoading,
    error,
    addDestination,
    updateDestination,
    deleteDestination,
    reorderDestinations,
    updateRouteLeg,
    createActivity,
    updateActivity,
    deleteActivity,
    reorderActivities,
  } = useTripData(repository, { calculateRoute });
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [previewMedia, setPreviewMedia] = useState<PreviewMediaSelection | null>(null);
  const [destinationMediaRollupItems, setDestinationMediaRollupItems] = useState<MediaRollupItem[]>([]);
  const [isDestinationMediaRollupLoading, setIsDestinationMediaRollupLoading] = useState(false);
  const [destinationMediaRollupError, setDestinationMediaRollupError] = useState<string | null>(null);
  const [pendingMapStop, setPendingMapStop] = useState<PendingMapStop | null>(null);
  const selectedDestinationIdRef = useRef<string | null>(null);
  const activityPanelRef = useRef<HTMLElement | null>(null);
  const rollupLoadSequenceRef = useRef(0);
  const pendingMapStopRequestIdRef = useRef(0);
  const activePendingMapStopIdRef = useRef<number | null>(null);
  const pendingMapStopDialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedMapStopElementRef = useRef<HTMLElement | null>(null);
  const isInteractionLocked = isLoading;

  const selectedDestination = useMemo(
    () => destinations.find((destination) => destination.id === selectedDestinationId) ?? null,
    [destinations, selectedDestinationId],
  );
  const selectedDestinationNumber = useMemo(() => {
    const selectedDestinationIndex = destinations.findIndex(
      (destination) => destination.id === selectedDestinationId,
    );

    return selectedDestinationIndex === -1 ? undefined : selectedDestinationIndex + 1;
  }, [destinations, selectedDestinationId]);
  const destinationMedia = useDestinationMedia(repository, selectedDestinationId);
  const selectedDestinationActivities = useMemo(
    () => (selectedDestination ? activitiesByDestinationId[selectedDestination.id] ?? [] : []),
    [activitiesByDestinationId, selectedDestination],
  );
  const selectedActivity = useMemo(
    () =>
      selectedActivityId === null
        ? null
        : selectedDestinationActivities.find((activity) => activity.id === selectedActivityId) ?? null,
    [selectedActivityId, selectedDestinationActivities],
  );
  const selectedActivityPanelId = selectedActivity?.id ?? null;
  const activityMedia = useActivityMedia(
    repository,
    selectedDestination?.id ?? null,
    selectedActivity?.id ?? null,
  );
  const previewMediaRollupItem =
    previewMedia?.source === 'destination-rollup'
      ? destinationMediaRollupItems.find((rollupItem) => rollupItem.mediaItem.id === previewMedia.mediaId) ?? null
      : null;
  const previewMediaNavigationItems =
    previewMedia?.source === 'destination-rollup'
      ? destinationMediaRollupItems.map((rollupItem) => rollupItem.mediaItem)
      : previewMedia?.source === 'activity'
        ? activityMedia.mediaItems
        : destinationMedia.mediaItems;
  const previewMediaIndex =
    previewMedia === null
      ? -1
      : previewMediaNavigationItems.findIndex((mediaItem) => mediaItem.id === previewMedia.mediaId);
  const previewMediaItem =
    previewMediaIndex === -1
      ? null
      : previewMediaNavigationItems[previewMediaIndex];
  const pendingMapStopPosition = pendingMapStop
    ? clampOverlayPosition(pendingMapStop.screenPosition, mapStopConfirmationApproxSize)
    : null;
  const pendingMapStopMaxHeight = pendingMapStopPosition
    ? getAvailableOverlayHeight(pendingMapStopPosition)
    : undefined;

  const restorePendingMapStopFocus = useCallback(() => {
    const previouslyFocusedElement = previouslyFocusedMapStopElementRef.current;
    previouslyFocusedMapStopElementRef.current = null;

    if (previouslyFocusedElement && document.contains(previouslyFocusedElement)) {
      previouslyFocusedElement.focus();
    }
  }, []);

  useEffect(() => {
    if (!pendingMapStop || isInteractionLocked) return undefined;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      if (pendingMapStop.isSaving) return;

      activePendingMapStopIdRef.current = null;
      setPendingMapStop(null);
      restorePendingMapStopFocus();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isInteractionLocked, pendingMapStop, restorePendingMapStopFocus]);

  const pendingMapStopId = pendingMapStop?.id;
  useEffect(() => {
    if (!pendingMapStopId || isInteractionLocked) return;

    pendingMapStopDialogRef.current?.focus();
  }, [isInteractionLocked, pendingMapStopId]);

  useEffect(() => {
    selectedDestinationIdRef.current = selectedDestinationId;
  }, [selectedDestinationId]);

  useEffect(() => {
    setPreviewMedia(null);
  }, [selectedDestinationId]);

  const loadDestinationMediaRollup = useCallback(async (destinationId: string | null) => {
    const loadSequence = rollupLoadSequenceRef.current + 1;
    rollupLoadSequenceRef.current = loadSequence;
    const isCurrentLoad = () =>
      rollupLoadSequenceRef.current === loadSequence &&
      selectedDestinationIdRef.current === destinationId;

    if (!destinationId) {
      setDestinationMediaRollupItems([]);
      setIsDestinationMediaRollupLoading(false);
      setDestinationMediaRollupError(null);
      return;
    }

    setIsDestinationMediaRollupLoading(true);
    setDestinationMediaRollupError(null);
    setDestinationMediaRollupItems([]);

    try {
      const rollupItems = await repository.listDestinationMediaRollup(destinationId);
      if (!isCurrentLoad()) return;

      setDestinationMediaRollupItems(rollupItems);
    } catch (caught) {
      if (!isCurrentLoad()) return;

      setDestinationMediaRollupItems([]);
      setDestinationMediaRollupError(
        caught instanceof Error ? caught.message : 'Unable to load images.',
      );
    } finally {
      if (isCurrentLoad()) {
        setIsDestinationMediaRollupLoading(false);
      }
    }
  }, [repository]);

  const reloadDestinationMediaRollup = useCallback(async () => {
    await loadDestinationMediaRollup(selectedDestinationIdRef.current);
  }, [loadDestinationMediaRollup]);

  useEffect(() => {
    void loadDestinationMediaRollup(selectedDestinationId);
  }, [loadDestinationMediaRollup, selectedDestinationId]);

  useEffect(() => {
    if (previewMediaIndex === -1 || previewMediaNavigationItems.length < 2) return;

    const previousIndex =
      (previewMediaIndex - 1 + previewMediaNavigationItems.length) % previewMediaNavigationItems.length;
    const nextIndex = (previewMediaIndex + 1) % previewMediaNavigationItems.length;

    preloadImageUrls([
      getFullMediaImageUrl(previewMediaNavigationItems[previousIndex]),
      getFullMediaImageUrl(previewMediaNavigationItems[nextIndex]),
    ]);
  }, [previewMediaNavigationItems, previewMediaIndex]);

  useEffect(() => {
    if (!selectedDestinationId) {
      setSelectedActivityId(null);
      return;
    }

    if (
      selectedActivityId &&
      !selectedDestinationActivities.some((activity) => activity.id === selectedActivityId)
    ) {
      setSelectedActivityId(null);
    }
  }, [selectedActivityId, selectedDestinationActivities, selectedDestinationId]);

  useEffect(() => {
    if (!selectedActivityPanelId) return;
    if (!window.matchMedia?.(mobileWorkspacePanelsQuery).matches) return;

    activityPanelRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
  }, [selectedActivityPanelId]);

  useEffect(() => {
    if (pendingMapStop || previewMediaItem || !selectedDestinationId || isInteractionLocked) {
      return undefined;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      if (selectedActivityPanelId) {
        setSelectedActivityId(null);
        return;
      }

      setSelectedDestinationId(null);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [
    isInteractionLocked,
    pendingMapStop,
    previewMediaItem,
    selectedActivityPanelId,
    selectedDestinationId,
  ]);

  const handleAddDestination = useCallback(
    async (input: Parameters<typeof addDestination>[0]) => {
      if (isInteractionLocked) return undefined;

      return addDestination(input);
    },
    [addDestination, isInteractionLocked],
  );

  const handleSelectDestination = useCallback((destinationId: string) => {
    setSelectedDestinationId(destinationId);
    setSelectedActivityId(null);
  }, []);

  const openPendingMapStop = useCallback(
    async (request: MapAddStopRequest) => {
      if (isInteractionLocked || pendingMapStop?.isSaving) return;

      const requestId = pendingMapStopRequestIdRef.current + 1;
      pendingMapStopRequestIdRef.current = requestId;
      activePendingMapStopIdRef.current = requestId;
      const activeElement = document.activeElement;
      previouslyFocusedMapStopElementRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      const fallback = createFallbackMapStop(request.coordinates);
      setPendingMapStop({
        id: requestId,
        coordinates: request.coordinates,
        screenPosition: request.screenPosition,
        source: request.source,
        name: fallback.name,
        location: fallback.location,
        isResolving: true,
        isSaving: false,
        resolveError: null,
        saveError: null,
      });

      try {
        const resolvedResult = await resolveMapTilerCoordinates(request.coordinates, { apiKey: mapTilerApiKey });
        setPendingMapStop((current) => {
          if (!current || current.id !== requestId) return current;

          return {
            ...current,
            name: resolvedResult.location.placeName,
            location: resolvedResult.location,
            isResolving: false,
            resolveError: null,
          };
        });
      } catch (caught) {
        setPendingMapStop((current) => {
          if (!current || current.id !== requestId) return current;

          return {
            ...current,
            isResolving: false,
            resolveError: caught instanceof Error ? caught.message : 'Coordinate lookup failed',
          };
        });
      }
    },
    [isInteractionLocked, pendingMapStop?.isSaving],
  );

  const closePendingMapStop = useCallback(() => {
    if (pendingMapStop?.isSaving) return;

    activePendingMapStopIdRef.current = null;
    setPendingMapStop(null);
    restorePendingMapStopFocus();
  }, [pendingMapStop?.isSaving, restorePendingMapStopFocus]);

  const confirmPendingMapStop = useCallback(async () => {
    if (!pendingMapStop || pendingMapStop.isResolving || pendingMapStop.isSaving || isInteractionLocked) return;

    const pendingMapStopId = pendingMapStop.id;
    setPendingMapStop((current) =>
      current && current.id === pendingMapStopId
        ? { ...current, isSaving: true, saveError: null }
        : current,
    );
    try {
      const destination = await handleAddDestination({
        name: pendingMapStop.name,
        location: pendingMapStop.location,
        coordinates: pendingMapStop.coordinates,
      });
      if (activePendingMapStopIdRef.current !== pendingMapStopId) return;

      activePendingMapStopIdRef.current = null;
      setPendingMapStop((current) => (current?.id === pendingMapStopId ? null : current));
      if (destination) {
        setSelectedDestinationId(destination.id);
      }
    } catch (caught) {
      if (activePendingMapStopIdRef.current !== pendingMapStopId) return;

      setPendingMapStop((current) =>
        current && current.id === pendingMapStopId
          ? {
              ...current,
              isSaving: false,
              saveError: caught instanceof Error ? caught.message : 'Unable to add stop',
            }
          : current,
      );
    }
  }, [handleAddDestination, isInteractionLocked, pendingMapStop]);

  const searchStopPlaces = useCallback(
    (query: string) => searchMapTilerPlaces(query, { apiKey: mapTilerApiKey, profile: 'stop' }),
    [],
  );
  const searchActivityPlaces = useCallback(
    (query: string) =>
      searchMapTilerPlaces(query, {
        apiKey: mapTilerApiKey,
        profile: 'activity',
        proximity: selectedDestination?.coordinates,
        ...(selectedDestination?.coordinates
          ? {
              bbox: createBoundingBoxAroundCoordinates(
                selectedDestination.coordinates,
                activitySearchRadiusKm,
              ),
              fallbackWithoutBbox: true,
            }
          : {}),
      }),
    [selectedDestination?.coordinates],
  );
  const resolveSearchResult = useCallback(
    (result: Awaited<ReturnType<typeof searchMapTilerPlaces>>[number]) => {
      if (result.kind === 'place') return Promise.resolve(result);

      return resolveMapTilerCoordinates(result.coordinates, { apiKey: mapTilerApiKey, profile: 'stop' });
    },
    [],
  );

  const handleDeleteDestination = useCallback(
    async (destinationId: string) => {
      if (isInteractionLocked) return;

      await deleteDestination(destinationId);
      setSelectedDestinationId((currentDestinationId) =>
        currentDestinationId === destinationId ? null : currentDestinationId,
      );
      setSelectedActivityId(null);
    },
    [deleteDestination, isInteractionLocked],
  );

  const handleCloseDestinationProfile = useCallback(() => {
    setSelectedDestinationId(null);
    setSelectedActivityId(null);
  }, []);

  const handleCreateActivity = useCallback(
    async (destinationId: string, input: { title: string; location?: ActivityLocation }) => {
      const activity = await createActivity({
        destinationId,
        title: input.title,
        location: input.location,
      });
      setSelectedActivityId(activity.id);
    },
    [createActivity],
  );

  const handleDeleteActivity = useCallback(
    async (activityId: string) => {
      await deleteActivity(activityId);
      setSelectedActivityId((currentActivityId) =>
        currentActivityId === activityId ? null : currentActivityId,
      );
    },
    [deleteActivity],
  );

  const handleUpdateActivityPanel = useCallback(
    async (
      activityId: string,
      patch: Partial<Pick<Activity, 'title' | 'description' | 'notes' | 'status' | 'priority' | 'tags' | 'location'>>,
    ) => {
      await updateActivity(activityId, patch);
    },
    [updateActivity],
  );

  const handleDestinationMediaUpload = useCallback(async (files: File[]) => {
    await destinationMedia.uploadFiles(files);
    await reloadDestinationMediaRollup();
  }, [destinationMedia, reloadDestinationMediaRollup]);

  const handleDestinationMediaReorder = useCallback(async (orderedMediaIds: string[]) => {
    await destinationMedia.reorder(orderedMediaIds);
    await reloadDestinationMediaRollup();
  }, [destinationMedia, reloadDestinationMediaRollup]);

  const handleActivityMediaUpload = useCallback(async (files: File[]) => {
    await activityMedia.uploadFiles(files);
    await reloadDestinationMediaRollup();
  }, [activityMedia, reloadDestinationMediaRollup]);

  const handleActivityMediaReorder = useCallback(async (orderedMediaIds: string[]) => {
    await activityMedia.reorder(orderedMediaIds);
    await reloadDestinationMediaRollup();
  }, [activityMedia, reloadDestinationMediaRollup]);

  function navigatePreviewMedia(mediaId: string, direction: -1 | 1) {
    const currentIndex = previewMediaNavigationItems.findIndex((mediaItem) => mediaItem.id === mediaId);
    if (!previewMedia || currentIndex === -1 || previewMediaNavigationItems.length === 0) return;

    const targetIndex =
      (currentIndex + direction + previewMediaNavigationItems.length) % previewMediaNavigationItems.length;

    setPreviewMedia({
      mediaId: previewMediaNavigationItems[targetIndex].id,
      source: previewMedia.source,
    });
  }

  async function deletePreviewMedia(mediaId: string) {
    const currentIndex = previewMediaNavigationItems.findIndex((mediaItem) => mediaItem.id === mediaId);
    const nextPreviewMediaItem =
      currentIndex === -1
        ? null
        : previewMediaNavigationItems[currentIndex + 1] ?? previewMediaNavigationItems[currentIndex - 1] ?? null;

    if (previewMedia?.source === 'activity') {
      await Promise.resolve(activityMedia.deleteMedia(mediaId));
    } else if (previewMediaRollupItem?.ownerType === 'activity') {
      await repository.deleteActivityMedia(mediaId);
      if (previewMediaRollupItem.activityId === selectedActivity?.id) {
        await activityMedia.reload();
      }
    } else {
      await Promise.resolve(destinationMedia.deleteMedia(mediaId));
    }
    await reloadDestinationMediaRollup();
    setPreviewMedia(
      nextPreviewMediaItem && previewMedia
        ? { mediaId: nextPreviewMediaItem.id, source: previewMedia.source }
        : null,
    );
  }

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="World tour map workspace">
        <MapCanvas
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={handleSelectDestination}
          onRequestAddStop={openPendingMapStop}
        />
        {!isInteractionLocked ? (
          <>
            <TopToolbar
              searchPlaces={searchStopPlaces}
              resolveSearchResult={resolveSearchResult}
              onAddDestination={handleAddDestination}
            />
            <ItineraryPanel
              destinations={destinations}
              routeLegs={routeLegs}
              selectedDestinationId={selectedDestinationId}
              onSelectDestination={handleSelectDestination}
              onDeleteDestination={(destinationId) => void handleDeleteDestination(destinationId)}
              onReorderDestinations={(destinationIds) => void reorderDestinations(destinationIds)}
              onUpdateRouteLeg={(routeLegId, patch) => void updateRouteLeg(routeLegId, patch)}
            />
          </>
        ) : null}
        {!isInteractionLocked && pendingMapStop && pendingMapStopPosition ? (
          <section
            ref={pendingMapStopDialogRef}
            className="map-stop-confirmation"
            role="dialog"
            aria-modal="false"
            aria-label="Add stop from map"
            tabIndex={-1}
            style={{
              left: `${pendingMapStopPosition.x}px`,
              top: `${pendingMapStopPosition.y}px`,
              maxHeight: pendingMapStopMaxHeight,
            }}
          >
            <div>
              <span className="map-stop-confirmation__eyebrow">
                {pendingMapStop.isResolving ? 'Resolving map location' : 'Map stop'}
              </span>
              <h2>{pendingMapStop.name}</h2>
              <p>{formatLocationParts(pendingMapStop.location) || formatCoordinatePair(pendingMapStop.coordinates)}</p>
              <p>{formatCoordinatePair(pendingMapStop.coordinates)}</p>
            </div>
            {pendingMapStop.resolveError ? (
              <p className="map-stop-confirmation__error">{pendingMapStop.resolveError}</p>
            ) : null}
            {pendingMapStop.saveError ? (
              <p className="map-stop-confirmation__error">{pendingMapStop.saveError}</p>
            ) : null}
            <div className="map-stop-confirmation__actions">
              <button type="button" disabled={pendingMapStop.isSaving} onClick={closePendingMapStop}>
                Cancel
              </button>
              <button
                type="button"
                disabled={pendingMapStop.isResolving || pendingMapStop.isSaving}
                onClick={() => void confirmPendingMapStop()}
              >
                Add stop
              </button>
            </div>
          </section>
        ) : null}
        {!isInteractionLocked && selectedDestination ? (
          <div className="workspace-panels">
            {selectedActivity ? (
              <ActivityPanel
                ref={activityPanelRef}
                activity={selectedActivity}
                stopName={selectedDestination.name}
                mediaItems={activityMedia.mediaItems}
                mediaError={activityMedia.error}
                isMediaLoading={activityMedia.isLoading}
                isMediaUploading={activityMedia.isUploading}
                onClose={() => setSelectedActivityId(null)}
                onUpdateActivity={handleUpdateActivityPanel}
                onUploadMedia={handleActivityMediaUpload}
                onReorderMedia={handleActivityMediaReorder}
                onOpenMediaPreview={(mediaId) => setPreviewMedia({ mediaId, source: 'activity' })}
              />
            ) : null}
            <DestinationProfile
              destination={selectedDestination}
              activities={selectedDestinationActivities}
              selectedActivityId={selectedActivityId}
              stopNumber={selectedDestinationNumber}
              mediaItems={destinationMedia.mediaItems}
              mediaRollupItems={destinationMediaRollupItems}
              isMediaLoading={destinationMedia.isLoading || isDestinationMediaRollupLoading}
              isMediaUploading={destinationMedia.isUploading}
              mediaError={destinationMedia.error ?? destinationMediaRollupError}
              onSelectActivity={setSelectedActivityId}
              onCreateActivity={handleCreateActivity}
              searchActivities={searchActivityPlaces}
              onDeleteActivity={handleDeleteActivity}
              onReorderActivities={reorderActivities}
              onUpdate={updateDestination}
              onUploadMedia={handleDestinationMediaUpload}
              onReorderMedia={handleDestinationMediaReorder}
              onOpenMediaPreview={(mediaId) => setPreviewMedia({ mediaId, source: 'destination-rollup' })}
              onClose={handleCloseDestinationProfile}
            />
          </div>
        ) : null}
        {!isInteractionLocked && previewMediaItem ? (
          <DestinationImagePreviewModal
            mediaItem={previewMediaItem}
            canMoveLeft={previewMediaNavigationItems.length > 1}
            canMoveRight={previewMediaNavigationItems.length > 1}
            activityAttribution={previewMediaRollupItem?.activityTitle}
            onOpenActivity={
              previewMediaRollupItem?.activityId
                ? () => {
                    setSelectedActivityId(previewMediaRollupItem.activityId ?? null);
                    setPreviewMedia(null);
                  }
                : undefined
            }
            onDelete={deletePreviewMedia}
            onNavigatePrevious={(mediaId) => navigatePreviewMedia(mediaId, -1)}
            onNavigateNext={(mediaId) => navigatePreviewMedia(mediaId, 1)}
            onClose={() => setPreviewMedia(null)}
          />
        ) : null}
        {isInteractionLocked ? (
          <div className="app-status" role="status">
            Loading trip data
          </div>
        ) : null}
        {error ? (
          <div className="app-status app-status-error" role="alert">
            {error}
          </div>
        ) : null}
      </section>
    </main>
  );
}
