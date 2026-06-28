import { useCallback, useMemo, useState } from 'react';
import { resolveMapTilerCoordinates, searchMapTilerPlaces } from './adapters/geocoding';
import { calculateOpenRouteServiceRoute } from './adapters/openRouteService';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import { TopToolbar } from './components/TopToolbar';
import { useTripData } from './hooks/useTripData';
import { tripDb } from './storage/tripDb';
import { createTripRepository } from './storage/tripRepository';
import './styles.css';

const repository = createTripRepository(tripDb);
const openRouteServiceApiKey = import.meta.env.VITE_OPENROUTESERVICE_API_KEY ?? '';
const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';

export default function App() {
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
