import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveMapTilerCoordinates, searchMapTilerPlaces } from './adapters/geocoding';
import { calculateOpenRouteServiceRoute } from './adapters/openRouteService';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import { TopToolbar } from './components/TopToolbar';
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

  useEffect(() => {
    if (!selectedDestination || isInteractionLocked) return undefined;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      setSelectedDestinationId(null);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isInteractionLocked, selectedDestination]);

  const handleAddDestination = useCallback(
    async (input: Parameters<typeof addDestination>[0]) => {
      if (isInteractionLocked) return;

      await addDestination(input);
    },
    [addDestination, isInteractionLocked],
  );
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
        />
        {!isInteractionLocked ? (
          <>
            <TopToolbar
              searchPlaces={searchPlaces}
              resolveSearchResult={resolveSearchResult}
              onAddDestination={handleAddDestination}
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
