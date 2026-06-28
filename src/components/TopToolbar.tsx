import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Coordinates } from '../domain/types';

type TopToolbarProps = {
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  onAddDestination: (input: {
    name: string;
    countryRegion: string;
    coordinates: Coordinates;
  }) => Promise<void> | void;
};

function nameFromLabel(label: string) {
  return label.split(',')[0]?.trim() || label;
}

export function TopToolbar({ searchPlaces, onAddDestination }: TopToolbarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSearchId = useRef(0);

  async function handleSearch() {
    const searchId = latestSearchId.current + 1;
    latestSearchId.current = searchId;
    setIsSearching(true);
    setError(null);
    try {
      const nextResults = await searchPlaces(query);
      if (searchId !== latestSearchId.current) return;
      setResults(nextResults);
    } catch (caught) {
      if (searchId !== latestSearchId.current) return;
      setResults([]);
      setError(caught instanceof Error ? caught.message : 'Search failed');
    } finally {
      if (searchId === latestSearchId.current) {
        setIsSearching(false);
      }
    }
  }

  async function handleSelectResult(result: PlaceSearchResult) {
    setError(null);
    try {
      await onAddDestination({
        name: nameFromLabel(result.label),
        countryRegion: result.countryRegion,
        coordinates: result.coordinates,
      });
      setQuery('');
      setResults([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add destination');
    }
  }

  return (
    <header className="top-toolbar" aria-label="Map planning tools">
      <div className="search-group">
        <label className="sr-only" htmlFor="destination-search">
          Search for a destination
        </label>
        <input
          id="destination-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search places"
        />
        <button type="button" onClick={handleSearch}>
          <Search size={16} aria-hidden="true" />
          Search
        </button>
      </div>
      {isSearching ? <div className="toolbar-status">Searching...</div> : null}
      {error ? <div className="toolbar-error">{error}</div> : null}
      {results.length > 0 ? (
        <div className="search-results">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => void handleSelectResult(result)}
              aria-label={`Add ${result.label}`}
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
