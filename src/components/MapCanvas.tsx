import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Destination, RouteLeg } from '../domain/types';

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onDropPin: (coordinates: { lat: number; lng: number }) => void;
};

const styleUrl = 'https://demotiles.maplibre.org/style.json';

type ScreenPoint = {
  x: number;
  y: number;
};

type RoutePath = {
  id: string;
  type: RouteLeg['type'];
  points: string;
};

export function MapCanvas({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onDropPin,
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onDropPinRef = useRef(onDropPin);
  const updateOverlayRef = useRef(() => {});
  const [pinPositions, setPinPositions] = useState<Record<string, ScreenPoint>>({});
  const [routePaths, setRoutePaths] = useState<RoutePath[]>([]);

  const updateOverlayPositions = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    setPinPositions(
      Object.fromEntries(
        destinations.map((destination) => {
          const point = map.project([destination.coordinates.lng, destination.coordinates.lat]);
          return [destination.id, { x: point.x, y: point.y }];
        }),
      ),
    );

    setRoutePaths(
      routeLegs
        .map((leg) => {
          const origin = destinations.find((destination) => destination.id === leg.originDestinationId);
          const target = destinations.find((destination) => destination.id === leg.targetDestinationId);
          const coordinates =
            leg.geometry && leg.geometry.coordinates.length >= 2
              ? leg.geometry.coordinates
              : origin && target
                ? [
                    [origin.coordinates.lng, origin.coordinates.lat],
                    [target.coordinates.lng, target.coordinates.lat],
                  ]
                : null;

          if (!coordinates) return null;

          return {
            id: leg.id,
            type: leg.type,
            points: coordinates
              .map(([lng, lat]) => {
                const point = map.project([lng, lat]);
                return `${point.x},${point.y}`;
              })
              .join(' '),
          };
        })
        .filter((path): path is RoutePath => path !== null),
    );
  }, [destinations, routeLegs]);

  useEffect(() => {
    onDropPinRef.current = onDropPin;
  }, [onDropPin]);

  useEffect(() => {
    updateOverlayRef.current = updateOverlayPositions;
  }, [updateOverlayPositions]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: [18, 24],
      zoom: 1.4,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const handleDropPin = (event: maplibregl.MapMouseEvent) => {
      onDropPinRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    };
    const syncOverlay = () => {
      updateOverlayRef.current();
    };

    map.on('dblclick', handleDropPin);
    map.on('move', syncOverlay);
    map.on('zoom', syncOverlay);
    map.on('resize', syncOverlay);

    mapRef.current = map;
    syncOverlay();

    return () => {
      map.off('dblclick', handleDropPin);
      map.off('move', syncOverlay);
      map.off('zoom', syncOverlay);
      map.off('resize', syncOverlay);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    updateOverlayPositions();
  }, [updateOverlayPositions]);

  const routeCount = useMemo(() => routeLegs.length, [routeLegs.length]);

  return (
    <section className="map-canvas" aria-label="Interactive world tour map">
      <div ref={mapContainerRef} className="maplibre-container" data-testid="map-container" />
      {destinations.length === 0 ? <div className="map-empty-label">Blank planning map</div> : null}
      <svg className="route-layer" aria-label="Route legs">
        {routePaths.map((path) => (
          <polyline
            key={path.id}
            className={`route-line route-line-${path.type}`}
            points={path.points}
          />
        ))}
      </svg>
      <div className="pin-layer" aria-label="Destination pins">
        {destinations.map((destination) => (
          <button
            key={destination.id}
            type="button"
            className={`map-pin ${destination.id === selectedDestinationId ? 'is-selected' : ''}`}
            aria-label={`Select ${destination.name}`}
            onClick={() => onSelectDestination(destination.id)}
            style={{
              left: `${pinPositions[destination.id]?.x ?? 0}px`,
              top: `${pinPositions[destination.id]?.y ?? 0}px`,
            }}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="map-route-count" aria-live="polite">
        {routeCount} route {routeCount === 1 ? 'leg' : 'legs'}
      </div>
    </section>
  );
}
