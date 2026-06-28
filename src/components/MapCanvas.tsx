import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import type { Destination, RouteLeg } from '../domain/types';

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onDropPin: (coordinates: { lat: number; lng: number }) => void;
};

const styleUrl = 'https://demotiles.maplibre.org/style.json';

export function MapCanvas({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onDropPin,
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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
    map.on('dblclick', (event) => {
      onDropPin({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onDropPin]);

  const routeCount = useMemo(() => routeLegs.length, [routeLegs.length]);

  const routeSegments = useMemo(
    () =>
      routeLegs
        .map((leg) => {
          const origin = destinations.find((destination) => destination.id === leg.originDestinationId);
          const target = destinations.find((destination) => destination.id === leg.targetDestinationId);
          if (!origin || !target) return null;

          return {
            id: leg.id,
            type: leg.type,
            x1: ((origin.coordinates.lng + 180) / 360) * 100,
            y1: ((90 - origin.coordinates.lat) / 180) * 100,
            x2: ((target.coordinates.lng + 180) / 360) * 100,
            y2: ((90 - target.coordinates.lat) / 180) * 100,
          };
        })
        .filter((segment): segment is NonNullable<typeof segment> => segment !== null),
    [destinations, routeLegs],
  );

  return (
    <section className="map-canvas" aria-label="Interactive world tour map">
      <div ref={mapContainerRef} className="maplibre-container" data-testid="map-container" />
      {destinations.length === 0 ? <div className="map-empty-label">Blank planning map</div> : null}
      <svg className="route-layer" aria-label="Route legs">
        {routeSegments.map((segment) => (
          <line
            key={segment.id}
            className={`route-line route-line-${segment.type}`}
            x1={`${segment.x1}%`}
            y1={`${segment.y1}%`}
            x2={`${segment.x2}%`}
            y2={`${segment.y2}%`}
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
              left: `${((destination.coordinates.lng + 180) / 360) * 100}%`,
              top: `${((90 - destination.coordinates.lat) / 180) * 100}%`,
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
