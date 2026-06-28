import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Coordinates, DestinationLocation } from '../domain/types';

type AddDestinationInput = {
  name: string;
  location: DestinationLocation;
  coordinates: Coordinates;
};

type TopToolbarProps = {
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  resolveSearchResult: (result: PlaceSearchResult) => Promise<Extract<PlaceSearchResult, { kind: 'place' }>>;
  onAddDestination: (input: AddDestinationInput) => Promise<void> | void;
};

const liveSearchDelayMs = 300;

function addInputFromResult(result: Extract<PlaceSearchResult, { kind: 'place' }>): AddDestinationInput {
  return {
    name: result.location.placeName,
    location: result.location,
    coordinates: result.coordinates,
  };
}

export function TopToolbar({ searchPlaces, resolveSearchResult, onAddDestination }: TopToolbarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSearchId = useRef(0);
  const searchTimerRef = useRef<number | null>(null);

  const handleSearch = useCallback(
    async (nextQuery: string) => {
      const searchId = latestSearchId.current + 1;
      latestSearchId.current = searchId;
      setIsSearching(true);
      setError(null);
      try {
        const nextResults = await searchPlaces(nextQuery);
        if (searchId !== latestSearchId.current) return;
        setResults(nextResults);
        setHighlightedIndex(-1);
      } catch (caught) {
        if (searchId !== latestSearchId.current) return;
        setResults([]);
        setHighlightedIndex(-1);
        setError(caught instanceof Error ? caught.message : 'Search failed');
      } finally {
        if (searchId === latestSearchId.current) {
          setIsSearching(false);
        }
      }
    },
    [searchPlaces],
  );

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      latestSearchId.current += 1;
      return;
    }

    searchTimerRef.current = window.setTimeout(() => {
      void handleSearch(trimmed);
    }, liveSearchDelayMs);

    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [handleSearch, query]);

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;
    setQuery(nextQuery);

    if (!nextQuery.trim()) {
      latestSearchId.current += 1;
      setResults([]);
      setHighlightedIndex(-1);
      setIsSearching(false);
    }
  }

  async function handleSelectResult(result: PlaceSearchResult) {
    setError(null);
    try {
      const resolvedResult = await resolveSearchResult(result);
      await onAddDestination(addInputFromResult(resolvedResult));
      setQuery('');
      setResults([]);
      setHighlightedIndex(-1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add destination');
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setResults([]);
      setHighlightedIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter' && highlightedIndex >= 0 && results[highlightedIndex]) {
      event.preventDefault();
      void handleSelectResult(results[highlightedIndex]);
    }
  }

  const activeResultId =
    highlightedIndex >= 0 && results[highlightedIndex] ? `destination-result-${results[highlightedIndex].id}` : undefined;

  return (
    <header className="top-toolbar" aria-label="Map planning tools">
      <div className="search-group">
        <label className="sr-only" htmlFor="destination-search">
          Search for a destination
        </label>
        <input
          id="destination-search"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search places or paste lat/lng"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls="destination-search-results"
          aria-activedescendant={activeResultId}
        />
      </div>
      {isSearching ? <div className="toolbar-status">Searching...</div> : null}
      {error ? <div className="toolbar-error">{error}</div> : null}
      {results.length > 0 ? (
        <div id="destination-search-results" className="search-results" role="listbox">
          {results.map((result, index) => (
            <button
              id={`destination-result-${result.id}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={index === highlightedIndex ? 'is-highlighted' : undefined}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => void handleSelectResult(result)}
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
