import { useCallback, useMemo, useState } from 'react';
import { searchNominatimPlaces } from './adapters/geocoding';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import { TopToolbar } from './components/TopToolbar';
import { parseTripSnapshot, serializeTripSnapshot } from './domain/snapshots';
import { useTripData } from './hooks/useTripData';
import { tripDb } from './storage/tripDb';
import { createTripRepository } from './storage/tripRepository';
import './styles.css';

const repository = createTripRepository(tripDb);
const exportFileName = 'world-tour-planner.json';

export default function App() {
  const {
    destinations,
    routeLegs,
    isLoading,
    error,
    addDestination,
    updateDestination,
    addRouteLeg,
    reload,
  } = useTripData(repository);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);

  const selectedDestination = useMemo(
    () => destinations.find((destination) => destination.id === selectedDestinationId) ?? null,
    [destinations, selectedDestinationId],
  );

  const handleAddDestination = useCallback(
    async (input: Parameters<typeof addDestination>[0]) => {
      const destination = await addDestination(input);
      setSelectedDestinationId(destination.id);
    },
    [addDestination],
  );

  const handleDropPin = useCallback(
    async (coordinates: { lat: number; lng: number }) => {
      const destination = await addDestination({
        name: `Dropped pin ${destinations.length + 1}`,
        countryRegion: 'Dropped pin',
        coordinates,
      });
      setSelectedDestinationId(destination.id);
    },
    [addDestination, destinations.length],
  );

  const handleImportText = useCallback(
    async (text: string) => {
      const snapshot = parseTripSnapshot(text);
      await repository.replaceTripData({
        destinations: snapshot.destinations,
        routeLegs: snapshot.routeLegs,
      });
      await reload();
      setSelectedDestinationId(snapshot.destinations[0]?.id ?? null);
    },
    [reload],
  );

  const handleCreateRouteLeg = useCallback(
    async (input: Parameters<typeof addRouteLeg>[0]) => {
      await addRouteLeg(input);
    },
    [addRouteLeg],
  );

  const handleExport = useCallback(() => {
    const snapshotJson = serializeTripSnapshot({ destinations, routeLegs });
    const blob = new Blob([snapshotJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = exportFileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [destinations, routeLegs]);

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="World tour map workspace">
        <MapCanvas
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={setSelectedDestinationId}
          onDropPin={handleDropPin}
        />
        <TopToolbar
          searchPlaces={searchNominatimPlaces}
          onAddDestination={handleAddDestination}
          onExport={handleExport}
          onImportText={handleImportText}
        />
        <ItineraryPanel
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={setSelectedDestinationId}
          onCreateRouteLeg={handleCreateRouteLeg}
        />
        {selectedDestination ? (
          <DestinationProfile
            destination={selectedDestination}
            onUpdate={updateDestination}
            onClose={() => setSelectedDestinationId(null)}
          />
        ) : null}
        {isLoading ? (
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
