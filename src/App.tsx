import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveMapTilerCoordinates, searchMapTilerPlaces } from './adapters/geocoding';
import { calculateOpenRouteServiceRoute } from './adapters/openRouteService';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import type { MapAddStopRequest } from './components/MapCanvas';
import { TopToolbar } from './components/TopToolbar';
import { createLegacyLocation, formatLocationParts } from './domain/locations';
import type { Coordinates, DestinationLocation } from './domain/types';
import { useTripData } from './hooks/useTripData';
import { createAppTripRepository } from './storage/appRepository';
import type { TripRepository } from './storage/tripRepository';
import './styles.css';

const openRouteServiceApiKey = import.meta.env.VITE_OPENROUTESERVICE_API_KEY ?? '';
const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';

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
    isLoading,
    error,
    addDestination,
    updateDestination,
    deleteDestination,
    reorderDestinations,
    updateRouteLeg,
  } = useTripData(repository, { calculateRoute });
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);
  const [pendingMapStop, setPendingMapStop] = useState<PendingMapStop | null>(null);
  const [mapCenterCoordinates, setMapCenterCoordinates] = useState<Coordinates | null>(null);
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
      activePendingMapStopIdRef.current = null;
      setPendingMapStop(null);
      restorePendingMapStopFocus();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isInteractionLocked, pendingMapStop, restorePendingMapStopFocus]);

  useEffect(() => {
    if (!pendingMapStop || isInteractionLocked) return;

    pendingMapStopDialogRef.current?.focus();
  }, [isInteractionLocked, pendingMapStop?.id]);

  useEffect(() => {
    if (pendingMapStop || !selectedDestination || isInteractionLocked) return undefined;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      setSelectedDestinationId(null);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isInteractionLocked, pendingMapStop, selectedDestination]);

  const handleAddDestination = useCallback(
    async (input: Parameters<typeof addDestination>[0]) => {
      if (isInteractionLocked) return undefined;

      return addDestination(input);
    },
    [addDestination, isInteractionLocked],
  );

  const openPendingMapStop = useCallback(
    async (request: MapAddStopRequest) => {
      if (isInteractionLocked) return;

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
    [isInteractionLocked],
  );

  const handleRequestAddAtMapCenter = useCallback(() => {
    if (!mapCenterCoordinates) return;

    void openPendingMapStop({
      coordinates: mapCenterCoordinates,
      screenPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      source: 'map-center',
    });
  }, [mapCenterCoordinates, openPendingMapStop]);

  const closePendingMapStop = useCallback(() => {
    activePendingMapStopIdRef.current = null;
    setPendingMapStop(null);
    restorePendingMapStopFocus();
  }, [restorePendingMapStopFocus]);

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

  const searchPlaces = useCallback(
    (query: string) => searchMapTilerPlaces(query, { apiKey: mapTilerApiKey }),
    [],
  );
  const resolveSearchResult = useCallback(
    (result: Awaited<ReturnType<typeof searchMapTilerPlaces>>[number]) => {
      if (result.kind === 'place') return Promise.resolve(result);

      return resolveMapTilerCoordinates(result.coordinates, { apiKey: mapTilerApiKey });
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
    },
    [deleteDestination, isInteractionLocked],
  );

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="World tour map workspace">
        <MapCanvas
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={setSelectedDestinationId}
          onRequestAddStop={openPendingMapStop}
          onMapCenterCoordinatesChange={setMapCenterCoordinates}
        />
        {!isInteractionLocked ? (
          <>
            <TopToolbar
              searchPlaces={searchPlaces}
              resolveSearchResult={resolveSearchResult}
              onAddDestination={handleAddDestination}
              onRequestAddAtMapCenter={mapCenterCoordinates ? handleRequestAddAtMapCenter : undefined}
            />
            <ItineraryPanel
              destinations={destinations}
              routeLegs={routeLegs}
              selectedDestinationId={selectedDestinationId}
              onSelectDestination={setSelectedDestinationId}
              onDeleteDestination={(destinationId) => void handleDeleteDestination(destinationId)}
              onReorderDestinations={(destinationIds) => void reorderDestinations(destinationIds)}
              onUpdateRouteLeg={(routeLegId, patch) => void updateRouteLeg(routeLegId, patch)}
            />
          </>
        ) : null}
        {!isInteractionLocked && pendingMapStop ? (
          <section
            ref={pendingMapStopDialogRef}
            className="map-stop-confirmation"
            role="dialog"
            aria-modal="false"
            aria-label="Add stop from map"
            tabIndex={-1}
            style={{
              left: `${pendingMapStop.screenPosition.x}px`,
              top: `${pendingMapStop.screenPosition.y}px`,
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
              <button type="button" onClick={closePendingMapStop}>
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
          <DestinationProfile
            destination={selectedDestination}
            stopNumber={selectedDestinationNumber}
            onUpdate={updateDestination}
            onClose={() => setSelectedDestinationId(null)}
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
