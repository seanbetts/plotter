import { Download, Search, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Coordinates } from '../domain/types';

type TopToolbarProps = {
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  onAddDestination: (input: {
    name: string;
    countryRegion: string;
    coordinates: Coordinates;
  }) => Promise<void> | void;
  onExport: () => void;
  onImportText: (text: string) => Promise<void> | void;
};

function nameFromLabel(label: string) {
  return label.split(',')[0]?.trim() || label;
}

export function TopToolbar({ searchPlaces, onAddDestination, onExport, onImportText }: TopToolbarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setIsSearching(true);
    setError(null);
    try {
      setResults(await searchPlaces(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await onImportText(await file.text());
    event.target.value = '';
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
      <button type="button" className="icon-action" onClick={onExport} aria-label="Export trip data">
        <Download size={17} aria-hidden="true" />
      </button>
      <label className="icon-action file-action" aria-label="Import trip data">
        <Upload size={17} aria-hidden="true" />
        <input type="file" accept="application/json" onChange={handleImport} />
      </label>
      {isSearching ? <div className="toolbar-status">Searching...</div> : null}
      {error ? <div className="toolbar-error">{error}</div> : null}
      {results.length > 0 ? (
        <div className="search-results">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() =>
                onAddDestination({
                  name: nameFromLabel(result.label),
                  countryRegion: result.countryRegion,
                  coordinates: result.coordinates,
                })
              }
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
