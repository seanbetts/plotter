import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Destination, RouteLeg } from '../domain/types';

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
};

const styleUrl = 'https://demotiles.maplibre.org/style.json';
const majorCityMinZoom = 3;

const majorCities = [
  { id: 'london', name: 'London', coordinates: { lat: 51.5072, lng: -0.1276 } },
  { id: 'paris', name: 'Paris', coordinates: { lat: 48.8566, lng: 2.3522 } },
  { id: 'istanbul', name: 'Istanbul', coordinates: { lat: 41.0082, lng: 28.9784 } },
  { id: 'cairo', name: 'Cairo', coordinates: { lat: 30.0444, lng: 31.2357 } },
  { id: 'mumbai', name: 'Mumbai', coordinates: { lat: 19.076, lng: 72.8777 } },
  { id: 'bangkok', name: 'Bangkok', coordinates: { lat: 13.7563, lng: 100.5018 } },
  { id: 'tokyo', name: 'Tokyo', coordinates: { lat: 35.6762, lng: 139.6503 } },
  { id: 'sydney', name: 'Sydney', coordinates: { lat: -33.8688, lng: 151.2093 } },
  { id: 'los-angeles', name: 'Los Angeles', coordinates: { lat: 34.0522, lng: -118.2437 } },
  { id: 'mexico-city', name: 'Mexico City', coordinates: { lat: 19.4326, lng: -99.1332 } },
  { id: 'bogota', name: 'Bogota', coordinates: { lat: 4.711, lng: -74.0721 } },
  { id: 'buenos-aires', name: 'Buenos Aires', coordinates: { lat: -34.6037, lng: -58.3816 } },
  { id: 'cape-town', name: 'Cape Town', coordinates: { lat: -33.9249, lng: 18.4241 } },
  { id: 'nairobi', name: 'Nairobi', coordinates: { lat: -1.2921, lng: 36.8219 } },
];

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
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const updateOverlayRef = useRef(() => {});
  const [pinPositions, setPinPositions] = useState<Record<string, ScreenPoint>>({});
  const [routePaths, setRoutePaths] = useState<RoutePath[]>([]);
  const [cityPositions, setCityPositions] = useState<Record<string, ScreenPoint>>({});
  const [showMajorCities, setShowMajorCities] = useState(false);

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

    setShowMajorCities(map.getZoom() >= majorCityMinZoom);
    setCityPositions(
      Object.fromEntries(
        majorCities.map((city) => {
          const point = map.project([city.coordinates.lng, city.coordinates.lat]);
          return [city.id, { x: point.x, y: point.y }];
        }),
      ),
    );
  }, [destinations, routeLegs]);

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
    const syncOverlay = () => {
      updateOverlayRef.current();
    };

    map.on('move', syncOverlay);
    map.on('zoom', syncOverlay);
    map.on('resize', syncOverlay);

    mapRef.current = map;
    syncOverlay();

    return () => {
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
      {showMajorCities ? (
        <div className="major-city-layer" aria-label="Major cities">
          {majorCities.map((city) => (
            <span
              key={city.id}
              className="major-city-label"
              style={{
                left: `${cityPositions[city.id]?.x ?? 0}px`,
                top: `${cityPositions[city.id]?.y ?? 0}px`,
              }}
            >
              {city.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="map-route-count" aria-live="polite">
        {routeCount} route {routeCount === 1 ? 'leg' : 'legs'}
      </div>
    </section>
  );
}
