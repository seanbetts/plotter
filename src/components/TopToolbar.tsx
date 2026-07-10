import { Camera, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Coordinates, DestinationLocation } from '../domain/types';
import { SearchCombobox } from './SearchCombobox';

type AddDestinationInput = {
  name: string;
  location: DestinationLocation;
  coordinates: Coordinates;
};

type TopToolbarProps = {
  canExportTripMap: boolean;
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  resolveSearchResult: (result: PlaceSearchResult) => Promise<Extract<PlaceSearchResult, { kind: 'place' }>>;
  onAddDestination: (input: AddDestinationInput) => Promise<unknown> | unknown;
  onExportTripMap: () => Promise<void> | void;
};

function addInputFromResult(result: Extract<PlaceSearchResult, { kind: 'place' }>): AddDestinationInput {
  return {
    name: result.location.placeName,
    location: result.location,
    coordinates: result.coordinates,
  };
}

function formatSearchResult(result: PlaceSearchResult) {
  if (result.kind === 'coordinates') {
    return {
      title: 'Use coordinates',
      subtitle: `${result.coordinates.lat}, ${result.coordinates.lng}`,
    };
  }

  return {
    title: result.location.placeName,
    subtitle:
      [result.location.regionName, result.location.countryName].filter(Boolean).join(', ') ||
      result.location.sourceLabel,
  };
}

export function TopToolbar({
  canExportTripMap,
  searchPlaces,
  resolveSearchResult,
  onAddDestination,
  onExportTripMap,
}: TopToolbarProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canExportTripMapRef = useRef(canExportTripMap);
  const visibleExportError = canExportTripMap ? exportError : null;

  useEffect(() => {
    canExportTripMapRef.current = canExportTripMap;
  }, [canExportTripMap]);

  const handleExportTripMap = async () => {
    setExportError(null);
    setIsExporting(true);

    try {
      await onExportTripMap();
    } catch {
      if (canExportTripMapRef.current) {
        setExportError("Couldn't export trip map. Try again.");
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <header className="top-toolbar" aria-label="Map planning tools">
      <SearchCombobox<PlaceSearchResult>
        label="Search for a destination"
        placeholder="Find a city, town, or region"
        inputId="destination-search"
        resultsId="destination-search-results"
        clearLabel="Clear destination search"
        search={searchPlaces}
        getResultId={(result) => result.id}
        getResultLabel={(result) => result.label}
        onSelectResult={async (result) => {
          const resolvedResult = await resolveSearchResult(result);
          await onAddDestination(addInputFromResult(resolvedResult));
        }}
        renderResult={(result) => {
          const formattedResult = formatSearchResult(result);

          return (
            <>
              <span className="search-result-title">{formattedResult.title}</span>
              <span className="search-result-subtitle">{formattedResult.subtitle}</span>
            </>
          );
        }}
      />
      <button
        type="button"
        className="toolbar-icon-action trip-map-export-action"
        aria-label={isExporting ? 'Generating trip map' : 'Download trip map'}
        disabled={!canExportTripMap || isExporting}
        onClick={() => void handleExportTripMap()}
      >
        {isExporting ? (
          <LoaderCircle className="trip-map-export-spinner" aria-hidden="true" />
        ) : (
          <Camera aria-hidden="true" />
        )}
      </button>
      {visibleExportError ? (
        <span className="trip-map-export-error" role="alert">
          {visibleExportError}
        </span>
      ) : null}
    </header>
  );
}
