import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createBoundingBoxAroundCoordinates,
  resolveMapTilerCoordinates,
  searchMapTilerPlaces,
} from './adapters/geocoding';
import type { PlaceSearchResult } from './adapters/geocoding';
import { calculateOpenRouteServiceRoute, calculateOpenRouteServiceRouteOptions } from './adapters/openRouteService';
import { ActivityPanel } from './components/ActivityPanel';
import { AppStatusPanel } from './components/AppStatusPanel';
import { DestinationImagePreviewModal } from './components/DestinationImagePreviewModal';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import type { MapAddStopRequest } from './components/MapCanvas';
import { PlotterAppShell } from './components/PlotterAppShell';
import { RouteAlternativesPanel } from './components/RouteAlternativesPanel';
import { TopToolbar } from './components/TopToolbar';
import { TripSelector } from './components/TripSelector';
import { buildTagSuggestions } from './components/tagEditorModel';
import { withRoutingAnchor } from './domain/destinations';
import { createLegacyLocation, formatLocationParts } from './domain/locations';
import { ensureUniqueRouteOptionIds, type RouteOption } from './domain/routeOptions';
import type {
  Activity,
  ActivityLocation,
  Coordinates,
  Destination,
  DestinationLocation,
  MediaRollupItem,
} from './domain/types';
import { useActivityMedia } from './hooks/useActivityMedia';
import { useDestinationMedia } from './hooks/useDestinationMedia';
import { useTripData } from './hooks/useTripData';
import { useTripWorkspace } from './hooks/useTripWorkspace';
import { clampOverlayPosition, getAvailableOverlayHeight } from './map/overlayGeometry';
import { downloadTripMap } from './map/tripMapExport';
import { preloadImageUrls } from './media/imagePreloading';
import { applyCalculatedRouteResult, createRouteResultFingerprint } from './tripCommands/routeOrchestration';
import { createAppLinkPreviewClient } from './services/linkPreviewClient';
import type { LinkPreviewClient } from './services/linkPreviewClient';
import { createAppWebImageSearchClient } from './services/webImageSearchClient';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from './services/webImageSearchClient';
import type { TripSummary } from './storage/tripDirectoryRepository';
import type { TripRealtimeSubscriptions } from './storage/tripRealtime';
import type { TripRepository } from './storage/tripRepository';
import { getBrowserStorage, readMigratedStorageValue, writeStorageValue } from './storage/localPreferences';
import './styles.css';

const openRouteServiceApiKey = import.meta.env.VITE_OPENROUTESERVICE_API_KEY ?? '';
const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';
const mobileWorkspacePanelsQuery = '(max-width: 760px)';
const stopsPanelCollapsedStorageKey = 'plotter:stops-panel-collapsed';
const legacyStopsPanelCollapsedStorageKey = 'world-tour:stops-panel-collapsed';

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

type PreviewMediaSource = 'destination-rollup' | 'activity';
type PreviewMediaSelection = {
  mediaId: string;
  source: PreviewMediaSource;
};
type RouteAlternativesState = {
  operationId: number;
  routeLegId: string;
  expectedFingerprint: string;
  status: 'loading' | 'ready' | 'empty' | 'error' | 'saving';
  options: RouteOption[];
  selectedOptionId: string | null;
  error: string | null;
};
type AppProps = {
  webImageSearchClient?: WebImageSearchClient;
};

const activitySearchRadiusKm = 100;
const mapStopConfirmationApproxSize = {
  width: 320,
  height: 260,
};
const blockingStatusMapStyles = `
  .map-stage--blocking-status .map-canvas {
    pointer-events: none;
  }

  .map-stage--blocking-status .map-destination-label-layer,
  .map-stage--blocking-status .map-accessible-destination-list,
  .map-stage--blocking-status .map-add-stop-menu {
    display: none;
  }
`;

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function formatCoordinatePair(coordinates: Coordinates) {
  return `${formatCoordinate(coordinates.lat)}, ${formatCoordinate(coordinates.lng)}`;
}

function getFullMediaImageUrl(mediaItem: { fullUrl?: string; previewUrl?: string; url: string }) {
  return mediaItem.fullUrl ?? mediaItem.previewUrl ?? mediaItem.url;
}

function createWebImageSearchContext(destination: Destination): WebImageSearchStopContext {
  return {
    stopName: destination.name,
    regionName: destination.location.regionName || destination.countryRegion,
    countryName: destination.location.countryName || destination.countryRegion,
    countryCode: destination.location.countryCode,
  };
}

function createActivityWebImageSearchContext(destination: Destination, activity: Activity): WebImageSearchStopContext {
  const location = activity.location;
  const coordinates = location?.coordinates;

  return {
    ...createWebImageSearchContext(destination),
    stopName: activity.title,
    ...(location?.name ? { locationName: location.name } : {}),
    ...(location?.address ? { address: location.address } : {}),
    ...(coordinates ? { latitude: coordinates.lat, longitude: coordinates.lng } : {}),
  };
}

function readStopsPanelCollapsedPreference() {
  if (typeof window === 'undefined') return false;
  return readMigratedStorageValue(
    getBrowserStorage(),
    stopsPanelCollapsedStorageKey,
    legacyStopsPanelCollapsedStorageKey,
  ) === 'true';
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

function createActivityLocationFromPlaceResult(
  result: Extract<PlaceSearchResult, { kind: 'place' }>,
): ActivityLocation {
  return {
    name: result.location.placeName,
    address: result.address ?? result.location.sourceLabel,
    coordinates: result.coordinates,
    sourceProvider: 'maptiler',
    sourceFeatureId: result.location.sourceFeatureId,
  };
}

function createDestinationLocationFromPlaceResult(
  result: Extract<PlaceSearchResult, { kind: 'place' }>,
): DestinationLocation {
  return {
    ...result.location,
    sourceProvider: 'maptiler',
  };
}

function shouldResolveActivityLocation(location: ActivityLocation | undefined): location is ActivityLocation & {
  coordinates: Coordinates;
} {
  return Boolean(location?.coordinates);
}

export default function App({ webImageSearchClient: injectedWebImageSearchClient }: AppProps = {}) {
  const linkPreviewClient = useMemo(() => createAppLinkPreviewClient(), []);
  const webImageSearchClient = useMemo(
    () => injectedWebImageSearchClient ?? createAppWebImageSearchClient(),
    [injectedWebImageSearchClient],
  );
  const {
    trips,
    activeTrip,
    repository,
    isLoading,
    error,
    actionError,
    selectTrip,
    createTrip,
    updateTrip,
    deleteTrip,
    refreshTrips,
    realtime,
  } = useTripWorkspace();

  useEffect(() => {
    if (!realtime) return undefined;

    return realtime.subscribeToTrips(() => {
      void refreshTrips();
    });
  }, [refreshTrips, realtime]);

  const workspace = !repository || !linkPreviewClient || !webImageSearchClient ? (
    <div className="app-shell">
        <style>{blockingStatusMapStyles}</style>
        <section className="map-stage map-stage--blocking-status" aria-label="Plotter map workspace">
          <MapCanvas
            destinations={[]}
            routeLegs={[]}
            selectedDestinationId={null}
            onSelectDestination={() => undefined}
          />
          <AppStatusPanel
            status={error ? 'error' : 'loading'}
            title={error?.title ?? 'Loading Plotter'}
            message={error?.message ?? 'Preparing your trip map.'}
          />
        </section>
    </div>
  ) : (
    <TripWorkspace
      key={activeTrip?.id}
      repository={repository}
      linkPreviewClient={linkPreviewClient}
      webImageSearchClient={webImageSearchClient}
      trips={trips}
      activeTrip={activeTrip}
      tripActionError={actionError}
      onSelectTrip={selectTrip}
      onCreateTrip={createTrip}
      onUpdateTrip={updateTrip}
      onDeleteTrip={deleteTrip}
      isTripWorkspaceLoading={isLoading}
      realtime={realtime}
    />
  );

  return <PlotterAppShell>{workspace}</PlotterAppShell>;
}

function TripWorkspace({
  repository,
  linkPreviewClient,
  webImageSearchClient,
  trips,
  activeTrip,
  tripActionError,
  onSelectTrip,
  onCreateTrip,
  onUpdateTrip,
  onDeleteTrip,
  isTripWorkspaceLoading,
  realtime,
}: {
  repository: TripRepository;
  linkPreviewClient: LinkPreviewClient;
  webImageSearchClient: WebImageSearchClient;
  trips: TripSummary[];
  activeTrip: TripSummary | null;
  tripActionError: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => Promise<boolean | void> | boolean | void;
  onUpdateTrip: (
    tripId: string,
    patch: { name: string; vehiclePreset: TripSummary['routingVehicle']['preset'] },
  ) => Promise<TripSummary | false> | TripSummary | false;
  onDeleteTrip: (tripId: string) => Promise<boolean | void> | boolean | void;
  isTripWorkspaceLoading: boolean;
  realtime: TripRealtimeSubscriptions | null;
}) {
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
    mutationError,
    addDestination,
    updateDestination,
    deleteDestination,
    reorderDestinations,
    updateRouteLeg,
    applyValidatedRouteLegResult,
    createActivity,
    updateActivity,
    deleteActivity,
    reorderActivities,
    recalculateForVehicle,
    reload,
  } = useTripData(repository, {
    calculateRoute,
    routingVehicle: activeTrip?.routingVehicle,
  });
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [tripConsistencyError, setTripConsistencyError] = useState<string | null>(null);
  const combinedTripActionError = [tripConsistencyError, tripActionError, mutationError]
    .filter((message): message is string => Boolean(message))
    .join(' ') || null;
  const [isStopsPanelCollapsed, setIsStopsPanelCollapsed] = useState(readStopsPanelCollapsedPreference);
  const [previewMedia, setPreviewMedia] = useState<PreviewMediaSelection | null>(null);
  const [destinationMediaRollupItems, setDestinationMediaRollupItems] = useState<MediaRollupItem[]>([]);
  const [isDestinationMediaRollupLoading, setIsDestinationMediaRollupLoading] = useState(false);
  const [destinationMediaRollupError, setDestinationMediaRollupError] = useState<string | null>(null);
  const [pendingMapStop, setPendingMapStop] = useState<PendingMapStop | null>(null);
  const [routeAlternativesState, setRouteAlternativesState] = useState<RouteAlternativesState | null>(null);
  const selectedDestinationIdRef = useRef<string | null>(null);
  const selectedActivityIdRef = useRef<string | null>(null);
  const routeLegsRef = useRef(routeLegs);
  const activeRoutingVehicleRef = useRef(activeTrip?.routingVehicle ?? null);
  const activityPanelRef = useRef<HTMLElement | null>(null);
  const mapStageRef = useRef<HTMLElement | null>(null);
  const rollupLoadSequenceRef = useRef(0);
  const pendingMapStopRequestIdRef = useRef(0);
  const routeAlternativesOperationIdRef = useRef(0);
  const activePendingMapStopIdRef = useRef<number | null>(null);
  const pendingMapStopDialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedMapStopElementRef = useRef<HTMLElement | null>(null);
  const isInteractionLocked = isLoading || isTripWorkspaceLoading;
  const routeLegsById = useMemo(
    () => new Map(routeLegs.map((routeLeg) => [routeLeg.id, routeLeg])),
    [routeLegs],
  );
  const destinationsById = useMemo(
    () => new Map(destinations.map((destination) => [destination.id, destination])),
    [destinations],
  );
  const activeRouteAlternativesLeg = routeAlternativesState
    ? routeLegsById.get(routeAlternativesState.routeLegId) ?? null
    : null;
  const activeRouteAlternativesOrigin = activeRouteAlternativesLeg
    ? destinationsById.get(activeRouteAlternativesLeg.originDestinationId) ?? null
    : null;
  const activeRouteAlternativesTarget = activeRouteAlternativesLeg
    ? destinationsById.get(activeRouteAlternativesLeg.targetDestinationId) ?? null
    : null;

  const handleExportTripMap = useCallback(async () => {
    if (!activeTrip || destinations.length === 0) {
      throw new Error('Trip map export requires an active trip with at least one stop.');
    }

    await downloadTripMap({
      tripName: activeTrip.name,
      destinations,
      routeLegs,
    });
  }, [activeTrip, destinations, routeLegs]);

  const handleUpdateTrip = useCallback(async (
    tripId: string,
    patch: { name: string; vehiclePreset: TripSummary['routingVehicle']['preset'] },
  ) => {
    setTripConsistencyError(null);
    const previousTrip = trips.find((trip) => trip.id === tripId);
    const updatedTrip = await onUpdateTrip(tripId, patch);
    if (updatedTrip === false) return false;

    if (
      activeTrip?.id === tripId &&
      previousTrip?.routingVehicle.preset !== updatedTrip.routingVehicle.preset
    ) {
      try {
        await recalculateForVehicle(updatedTrip.routingVehicle);
      } catch (caught) {
        const primaryMessage = caught instanceof Error
          ? caught.message
          : 'Unable to save recalculated routes.';
        let metadataRollbackMessage =
          'Trip metadata rollback failed; trip metadata may not match the restored route legs.';

        try {
          const rollbackTrip = previousTrip
            ? await onUpdateTrip(tripId, {
              name: previousTrip.name,
              vehiclePreset: previousTrip.routingVehicle.preset,
            })
            : false;
          if (rollbackTrip !== false) {
            metadataRollbackMessage = 'Trip metadata was restored.';
          }
        } catch (rollbackCaught) {
          metadataRollbackMessage = `Trip metadata rollback failed: ${
            rollbackCaught instanceof Error ? rollbackCaught.message : 'Unknown metadata rollback error'
          }. Trip metadata may not match the restored route legs.`;
        }

        setTripConsistencyError(`${primaryMessage} ${metadataRollbackMessage}`);
        return false;
      }
    }

    return updatedTrip;
  }, [activeTrip?.id, onUpdateTrip, recalculateForVehicle, trips]);

  useEffect(() => {
    if (!realtime || !activeTrip) return undefined;

    return realtime.subscribeToTripData(activeTrip.id, () => {
      void reload();
    });
  }, [activeTrip, realtime, reload]);

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
  const appStatusPanel = useMemo(() => {
    if (isInteractionLocked) {
      return {
        status: 'loading' as const,
        title: 'Loading Plotter',
        message: 'Preparing your trip map.',
      };
    }

    if (error) {
      return {
        status: 'error' as const,
        title: 'Unable to load trip data',
        message: error,
        onRetry: reload,
      };
    }

    if (destinations.length === 0) {
      return {
        status: 'empty' as const,
        title: 'No stops in this trip yet',
        message: 'Search for a destination or add a stop from the map.',
      };
    }

    return null;
  }, [destinations.length, error, isInteractionLocked, reload]);
  const tagSuggestions = useMemo(
    () =>
      buildTagSuggestions([
        ...destinations.map((destination) => destination.tags),
        ...Object.values(activitiesByDestinationId).flatMap((activities) =>
          activities.map((activity) => activity.tags),
        ),
      ]),
    [activitiesByDestinationId, destinations],
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
  const mapStageRect = pendingMapStop
    ? mapStageRef.current?.getBoundingClientRect()
    : null;
  const mapStageViewport = mapStageRect
    ? { width: mapStageRect.width, height: mapStageRect.height }
    : null;
  const pendingMapStopPosition = pendingMapStop && mapStageViewport
    ? clampOverlayPosition(
        pendingMapStop.screenPosition,
        mapStopConfirmationApproxSize,
        mapStageViewport,
      )
    : null;
  const pendingMapStopMaxHeight = pendingMapStopPosition && mapStageViewport
    ? getAvailableOverlayHeight(pendingMapStopPosition, mapStageViewport)
    : undefined;
  const isBlockingStatusState = isInteractionLocked || Boolean(error);
  const mapStageClassName = [
    'map-stage',
    isBlockingStatusState ? 'map-stage--blocking-status' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
    selectedActivityIdRef.current = selectedActivityId;
  }, [selectedActivityId]);

  useEffect(() => {
    routeLegsRef.current = routeLegs;
  }, [routeLegs]);

  useEffect(() => {
    activeRoutingVehicleRef.current = activeTrip?.routingVehicle ?? null;
  }, [activeTrip?.routingVehicle]);

  useEffect(() => {
    writeStorageValue(getBrowserStorage(), stopsPanelCollapsedStorageKey, String(isStopsPanelCollapsed));
  }, [isStopsPanelCollapsed]);

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
    if (!isInteractionLocked) return;

    routeAlternativesOperationIdRef.current += 1;
    setRouteAlternativesState(null);
  }, [isInteractionLocked]);

  useEffect(() => {
    if (!error) return;

    routeAlternativesOperationIdRef.current += 1;
    setRouteAlternativesState(null);
    setPendingMapStop(null);
    setSelectedDestinationId(null);
    setSelectedActivityId(null);
    setPreviewMedia(null);
  }, [error]);

  useEffect(() => () => {
    routeAlternativesOperationIdRef.current += 1;
  }, []);

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

  const isRouteAlternativesFingerprintCurrent = useCallback((
    routeLegId: string,
    expectedFingerprint: string,
  ) => {
    const currentRouteLeg = routeLegsRef.current.find((candidate) => candidate.id === routeLegId);
    const currentRoutingVehicle = activeRoutingVehicleRef.current;

    return Boolean(
      currentRouteLeg &&
      currentRoutingVehicle &&
      createRouteResultFingerprint(currentRouteLeg, currentRoutingVehicle) === expectedFingerprint,
    );
  }, []);

  const openRouteAlternatives = useCallback(
    async (routeLegId: string) => {
      const routeLeg = routeLegsById.get(routeLegId);
      if (
        !routeLeg ||
        routeLeg.movement !== 'drive' ||
        routeLeg.calculation !== 'automatic' ||
        !activeTrip
      ) return;

      const origin = destinationsById.get(routeLeg.originDestinationId);
      const target = destinationsById.get(routeLeg.targetDestinationId);
      if (!origin || !target) return;
      const operationId = routeAlternativesOperationIdRef.current + 1;
      routeAlternativesOperationIdRef.current = operationId;
      const expectedFingerprint = createRouteResultFingerprint(routeLeg, activeTrip.routingVehicle);

      setRouteAlternativesState({
        operationId,
        routeLegId,
        expectedFingerprint,
        status: 'loading',
        options: [],
        selectedOptionId: null,
        error: null,
      });

      try {
        const options = ensureUniqueRouteOptionIds(await calculateOpenRouteServiceRouteOptions({
          apiKey: openRouteServiceApiKey,
          origin: origin.coordinates,
          target: target.coordinates,
          routingVehicle: activeTrip?.routingVehicle,
          waypoints: [...(routeLeg.waypoints ?? [])].sort((left, right) => left.order - right.order),
          ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
          currentRouteLeg: routeLeg,
          originAnchors: origin.routingAnchors,
          targetAnchors: target.routingAnchors,
        }));

        setRouteAlternativesState((current) =>
          routeAlternativesOperationIdRef.current === operationId &&
          current?.operationId === operationId &&
          current.routeLegId === routeLegId &&
          current.expectedFingerprint === expectedFingerprint
            ? {
                operationId,
                routeLegId,
                expectedFingerprint,
                ...(isRouteAlternativesFingerprintCurrent(routeLegId, expectedFingerprint)
                  ? {
                    status: options.length > 0 ? 'ready' as const : 'empty' as const,
                    options,
                    selectedOptionId: options[0]?.id ?? null,
                    error: null,
                  }
                  : {
                    status: 'error' as const,
                    options: [],
                    selectedOptionId: null,
                    error: 'Route intent changed. Recalculate route options.',
                  }),
              }
            : current,
        );
      } catch (caught) {
        setRouteAlternativesState((current) =>
          routeAlternativesOperationIdRef.current === operationId &&
          current?.operationId === operationId &&
          current.routeLegId === routeLegId &&
          current.expectedFingerprint === expectedFingerprint
            ? isRouteAlternativesFingerprintCurrent(routeLegId, expectedFingerprint)
              ? {
                  ...current,
                  status: 'error',
                  options: [],
                  selectedOptionId: null,
                  error: caught instanceof Error ? caught.message : 'Unable to calculate route options',
                }
              : {
                  ...current,
                  status: 'error',
                  options: [],
                  selectedOptionId: null,
                  error: 'Route intent changed. Recalculate route options.',
                }
            : current,
        );
      }
    },
    [activeTrip, destinationsById, isRouteAlternativesFingerprintCurrent, routeLegsById],
  );

  const closeRouteAlternatives = useCallback((
    operationId: number,
    routeLegId: string,
    expectedFingerprint: string,
  ) => {
    if (routeAlternativesOperationIdRef.current !== operationId) return;

    routeAlternativesOperationIdRef.current += 1;
    setRouteAlternativesState((current) =>
      current?.operationId === operationId &&
      current.routeLegId === routeLegId &&
      current.expectedFingerprint === expectedFingerprint
        ? null
        : current,
    );
  }, []);

  const selectRouteAlternative = useCallback((
    operationId: number,
    routeLegId: string,
    expectedFingerprint: string,
    optionId: string,
  ) => {
    setRouteAlternativesState((current) =>
      routeAlternativesOperationIdRef.current === operationId &&
      current?.operationId === operationId &&
      current.routeLegId === routeLegId &&
      current.expectedFingerprint === expectedFingerprint
        ? { ...current, selectedOptionId: optionId }
        : current,
    );
  }, []);

  const confirmRouteAlternative = useCallback(async () => {
    if (!routeAlternativesState?.selectedOptionId) return;
    const { operationId, routeLegId, expectedFingerprint } = routeAlternativesState;
    if (routeAlternativesOperationIdRef.current !== operationId) return;

    const selectedOption = routeAlternativesState.options.find(
      (option) => option.id === routeAlternativesState.selectedOptionId,
    );
    if (!selectedOption) return;
    const routeLeg = routeLegsById.get(routeAlternativesState.routeLegId);
    if (!routeLeg) return;
    const origin = destinationsById.get(routeLeg.originDestinationId);
    const target = destinationsById.get(routeLeg.targetDestinationId);
    if (!origin || !target) return;
    if (selectedOption.profile !== 'driving-car' && selectedOption.profile !== 'driving-hgv') {
      return;
    }

    setRouteAlternativesState((current) =>
      routeAlternativesOperationIdRef.current === operationId &&
      current?.operationId === operationId &&
      current.routeLegId === routeLegId &&
      current.expectedFingerprint === expectedFingerprint
        ? { ...current, status: 'saving' }
        : current,
    );

    try {
      let validatedOrigin = origin;
      let validatedTarget = target;
      const destinationAnchorUpdates = [];
      if (selectedOption.endpointAnchors.origin) {
        validatedOrigin = withRoutingAnchor(origin, selectedOption.endpointAnchors.origin);
        destinationAnchorUpdates.push({
          destinationId: origin.id,
          anchor: selectedOption.endpointAnchors.origin,
        });
      }
      if (selectedOption.endpointAnchors.target) {
        validatedTarget = withRoutingAnchor(target, selectedOption.endpointAnchors.target);
        destinationAnchorUpdates.push({
          destinationId: target.id,
          anchor: selectedOption.endpointAnchors.target,
        });
      }
      const validatedRouteLeg = applyCalculatedRouteResult({
        routeLeg,
        origin: validatedOrigin,
        target: validatedTarget,
        routeKey: selectedOption.routeKey,
        route: {
          distanceKm: selectedOption.distanceKm,
          travelTimeHours: selectedOption.travelTimeHours,
          geometry: selectedOption.geometry,
          sections: selectedOption.sections,
          provider: selectedOption.provider,
          profile: selectedOption.profile,
          warnings: selectedOption.warnings,
          endpointAnchors: selectedOption.endpointAnchors,
        },
      });
      const applied = await applyValidatedRouteLegResult({
        routeLegId,
        expectedFingerprint,
        validatedRouteLeg,
        destinationAnchorUpdates,
      });
      if (!applied) {
        setRouteAlternativesState((current) =>
          routeAlternativesOperationIdRef.current === operationId &&
          current?.operationId === operationId &&
          current.routeLegId === routeLegId &&
          current.expectedFingerprint === expectedFingerprint
            ? { ...current, status: 'error', error: 'Route intent changed. Recalculate route options.' }
            : current,
        );
        return;
      }
      if (routeAlternativesOperationIdRef.current !== operationId) return;
      routeAlternativesOperationIdRef.current += 1;
      setRouteAlternativesState((current) =>
        current?.operationId === operationId &&
        current.routeLegId === routeLegId &&
        current.expectedFingerprint === expectedFingerprint
          ? null
          : current,
      );
    } catch (caught) {
      setRouteAlternativesState((current) =>
        routeAlternativesOperationIdRef.current === operationId &&
        current?.operationId === operationId &&
        current.routeLegId === routeLegId &&
        current.expectedFingerprint === expectedFingerprint
          ? {
              ...current,
              status: 'error',
              error: caught instanceof Error ? caught.message : 'Unable to save selected route',
            }
          : current,
      );
    }
  }, [applyValidatedRouteLegResult, destinationsById, routeAlternativesState, routeLegsById]);

  const handleCloseDestinationProfile = useCallback(() => {
    setSelectedDestinationId(null);
    setSelectedActivityId(null);
  }, []);

  const handleUpdateDestinationPanel = useCallback(
    async (
      destinationId: string,
      patch: Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>,
    ) => {
      let nextPatch = patch;

      if (patch.coordinates) {
        try {
          const resolvedLocation = await resolveMapTilerCoordinates(patch.coordinates, {
            apiKey: mapTilerApiKey,
            profile: 'stop',
          });
          nextPatch = {
            ...patch,
            countryRegion: resolvedLocation.location.countryName,
            coordinates: resolvedLocation.coordinates,
            location: createDestinationLocationFromPlaceResult(resolvedLocation),
          };
        } catch {
          nextPatch = patch;
        }
      }

      await updateDestination(destinationId, nextPatch);
    },
    [updateDestination],
  );

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
      patch: Partial<
        Pick<Activity, 'title' | 'description' | 'notes' | 'status' | 'priority' | 'tags' | 'links' | 'location'>
      >,
    ) => {
      let nextPatch = patch;

      if (shouldResolveActivityLocation(patch.location)) {
        try {
          const resolvedLocation = await resolveMapTilerCoordinates(patch.location.coordinates, {
            apiKey: mapTilerApiKey,
            profile: 'activity',
          });
          nextPatch = {
            ...patch,
            location: createActivityLocationFromPlaceResult(resolvedLocation),
          };
        } catch {
          nextPatch = patch;
        }
      }

      await updateActivity(activityId, nextPatch);
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

  const handleDestinationWebImageImport = useCallback(async (result: WebImageSearchResult) => {
    if (!selectedDestinationId) return;
    const importDestinationId = selectedDestinationId;

    await repository.importDestinationMediaFromSearch({
      destinationId: importDestinationId,
      result,
    });
    if (selectedDestinationIdRef.current !== importDestinationId) return;

    await destinationMedia.reload();
    await reloadDestinationMediaRollup();
  }, [destinationMedia, reloadDestinationMediaRollup, repository, selectedDestinationId]);

  const handleActivityMediaUpload = useCallback(async (files: File[]) => {
    await activityMedia.uploadFiles(files);
    await reloadDestinationMediaRollup();
  }, [activityMedia, reloadDestinationMediaRollup]);

  const handleActivityMediaReorder = useCallback(async (orderedMediaIds: string[]) => {
    await activityMedia.reorder(orderedMediaIds);
    await reloadDestinationMediaRollup();
  }, [activityMedia, reloadDestinationMediaRollup]);

  const handleActivityWebImageImport = useCallback(async (result: WebImageSearchResult) => {
    if (!selectedDestinationId || !selectedActivityId) return;
    const importDestinationId = selectedDestinationId;
    const importActivityId = selectedActivityId;

    await repository.importActivityMediaFromSearch({
      destinationId: importDestinationId,
      activityId: importActivityId,
      result,
    });
    if (
      selectedDestinationIdRef.current !== importDestinationId ||
      selectedActivityIdRef.current !== importActivityId
    ) {
      return;
    }

    await activityMedia.reload();
    await reloadDestinationMediaRollup();
  }, [activityMedia, reloadDestinationMediaRollup, repository, selectedActivityId, selectedDestinationId]);

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
    <div className="app-shell">
      <style>{blockingStatusMapStyles}</style>
      <section ref={mapStageRef} className={mapStageClassName} aria-label="Plotter map workspace">
        <MapCanvas
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          focusedActivities={selectedDestinationActivities}
          selectedActivityId={selectedActivityId}
          onSelectDestination={isBlockingStatusState ? () => undefined : handleSelectDestination}
          onSelectActivity={isBlockingStatusState ? undefined : setSelectedActivityId}
          onRequestAddStop={isBlockingStatusState ? undefined : openPendingMapStop}
        />
        {!isInteractionLocked && !error ? (
          <>
            <TopToolbar
              canExportTripMap={Boolean(activeTrip) && destinations.length > 0}
              searchPlaces={searchStopPlaces}
              resolveSearchResult={resolveSearchResult}
              onAddDestination={handleAddDestination}
              onExportTripMap={handleExportTripMap}
            />
            <div className="trip-selector-anchor">
              <TripSelector
                trips={trips}
                activeTrip={activeTrip}
                actionError={combinedTripActionError}
                onSelectTrip={onSelectTrip}
                onCreateTrip={onCreateTrip}
                onUpdateTrip={handleUpdateTrip}
                onDeleteTrip={onDeleteTrip}
              />
            </div>
            <div className="workspace-left-stack">
              <ItineraryPanel
                destinations={destinations}
                routeLegs={routeLegs}
                selectedDestinationId={selectedDestinationId}
                isCollapsed={isStopsPanelCollapsed}
                onToggleCollapsed={() => setIsStopsPanelCollapsed((isCollapsed) => !isCollapsed)}
                onSelectDestination={handleSelectDestination}
                onDeleteDestination={(destinationId) => void handleDeleteDestination(destinationId)}
                onReorderDestinations={(destinationIds) => void reorderDestinations(destinationIds)}
                onUpdateRouteLeg={(routeLegId, patch) => void updateRouteLeg(routeLegId, patch)}
                onEditRouteLeg={(routeLegId) => void openRouteAlternatives(routeLegId)}
              />
            </div>
          </>
        ) : null}
        {!isBlockingStatusState && pendingMapStop && pendingMapStopPosition ? (
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
              maxHeight: pendingMapStopMaxHeight === undefined
                ? undefined
                : `${pendingMapStopMaxHeight}px`,
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
        {!isBlockingStatusState &&
        routeAlternativesState &&
        activeRouteAlternativesOrigin &&
        activeRouteAlternativesTarget ? (
          <RouteAlternativesPanel
            originName={activeRouteAlternativesOrigin.name}
            targetName={activeRouteAlternativesTarget.name}
            status={routeAlternativesState.status}
            options={routeAlternativesState.options}
            selectedOptionId={routeAlternativesState.selectedOptionId}
            error={routeAlternativesState.error}
            onSelectOption={(optionId) => selectRouteAlternative(
              routeAlternativesState.operationId,
              routeAlternativesState.routeLegId,
              routeAlternativesState.expectedFingerprint,
              optionId,
            )}
            onConfirm={() => void confirmRouteAlternative()}
            onClose={() => closeRouteAlternatives(
              routeAlternativesState.operationId,
              routeAlternativesState.routeLegId,
              routeAlternativesState.expectedFingerprint,
            )}
          />
        ) : null}
        {!isInteractionLocked && !error && selectedDestination ? (
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
                linkPreviewClient={linkPreviewClient}
                tagSuggestions={tagSuggestions}
                onClose={() => setSelectedActivityId(null)}
                onUpdateActivity={handleUpdateActivityPanel}
                onUploadMedia={handleActivityMediaUpload}
                onReorderMedia={handleActivityMediaReorder}
                onOpenMediaPreview={(mediaId) => setPreviewMedia({ mediaId, source: 'activity' })}
                webImageSearchClient={webImageSearchClient}
                webImageSearchContext={createActivityWebImageSearchContext(selectedDestination, selectedActivity)}
                onImportWebImage={handleActivityWebImageImport}
              />
            ) : null}
            <DestinationProfile
              destination={selectedDestination}
              activities={selectedDestinationActivities}
              selectedActivityId={selectedActivityId}
              stopNumber={selectedDestinationNumber}
              stopCount={destinations.length}
              mediaItems={destinationMedia.mediaItems}
              mediaRollupItems={destinationMediaRollupItems}
              isMediaLoading={destinationMedia.isLoading || isDestinationMediaRollupLoading}
              isMediaUploading={destinationMedia.isUploading}
              mediaError={destinationMedia.error ?? destinationMediaRollupError}
              linkPreviewClient={linkPreviewClient}
              tagSuggestions={tagSuggestions}
              onSelectActivity={setSelectedActivityId}
              onCreateActivity={handleCreateActivity}
              searchActivities={searchActivityPlaces}
              onDeleteActivity={handleDeleteActivity}
              onReorderActivities={reorderActivities}
              onUpdate={handleUpdateDestinationPanel}
              onUploadMedia={handleDestinationMediaUpload}
              onReorderMedia={handleDestinationMediaReorder}
              onOpenMediaPreview={(mediaId) => setPreviewMedia({ mediaId, source: 'destination-rollup' })}
              webImageSearchClient={webImageSearchClient}
              webImageSearchContext={createWebImageSearchContext(selectedDestination)}
              onImportWebImage={handleDestinationWebImageImport}
              onClose={handleCloseDestinationProfile}
            />
          </div>
        ) : null}
        {!isInteractionLocked && !error && previewMediaItem ? (
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
        {appStatusPanel ? (
          <AppStatusPanel
            status={appStatusPanel.status}
            title={appStatusPanel.title}
            message={appStatusPanel.message}
            onRetry={'onRetry' in appStatusPanel ? appStatusPanel.onRetry : undefined}
          />
        ) : null}
      </section>
    </div>
  );
}
