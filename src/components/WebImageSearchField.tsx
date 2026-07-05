import { LoaderCircle, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from '../services/webImageSearchClient';

type WebImageSearchFieldProps = {
  context: WebImageSearchStopContext;
  client: WebImageSearchClient;
  onImportImage: (result: WebImageSearchResult) => Promise<void> | void;
};

const liveSearchDelayMs = 300;

export function WebImageSearchField({ context, client, onImportImage }: WebImageSearchFieldProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebImageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const latestSearchId = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const trimmedQuery = query.trim();
  const showPopover = Boolean(trimmedQuery && (isSearching || error || results.length > 0));

  const clearSearch = useCallback(() => {
    latestSearchId.current += 1;
    setQuery('');
    setResults([]);
    setIsSearching(false);
    setImportingId(null);
    setError('');
  }, []);

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }

    if (!trimmedQuery) {
      latestSearchId.current += 1;
      setResults([]);
      setIsSearching(false);
      setError('');
      return;
    }

    const searchId = latestSearchId.current + 1;
    latestSearchId.current = searchId;

    searchTimerRef.current = window.setTimeout(() => {
      setIsSearching(true);
      setError('');

      void client.searchImages(trimmedQuery, context)
        .then((nextResults) => {
          if (searchId !== latestSearchId.current) return;
          setResults(nextResults);
        })
        .catch((caught) => {
          if (searchId !== latestSearchId.current) return;
          setResults([]);
          setError(caught instanceof Error ? caught.message : 'Unable to search web images.');
        })
        .finally(() => {
          if (searchId === latestSearchId.current) {
            setIsSearching(false);
          }
        });
    }, liveSearchDelayMs);

    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [client, context, trimmedQuery]);

  async function importResult(result: WebImageSearchResult) {
    if (importingId) return;

    setImportingId(result.id);
    setError('');

    try {
      await onImportImage(result);
      clearSearch();
    } catch (caught) {
      setImportingId(null);
      setError(caught instanceof Error ? caught.message : 'Unable to import image.');
    }
  }

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;

    if (nextQuery.trim() !== trimmedQuery) {
      setResults([]);
      setError('');
    }

    setQuery(nextQuery);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    }
  }

  return (
    <div className="web-image-search">
      <label className="sr-only" htmlFor="web-image-search-input">
        Search web images
      </label>
      <div className="search-input-shell web-image-search-input-shell">
        <Search className="search-input-icon" size={18} aria-hidden="true" />
        <input
          id="web-image-search-input"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          placeholder="Search web images"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPopover}
          aria-controls="web-image-search-results"
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear web image search"
            onClick={clearSearch}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {showPopover ? (
        <div className="web-image-search-popover">
          {isSearching ? (
            <div className="web-image-search-status" role="status">
              <LoaderCircle size={16} aria-hidden="true" />
              <span>Searching images...</span>
            </div>
          ) : null}
          {error ? (
            <p className="web-image-search-error" role="alert">
              {error}
            </p>
          ) : null}
          {results.length > 0 ? (
            <div
              id="web-image-search-results"
              className="web-image-result-grid"
              role="listbox"
              aria-label="Web image results"
            >
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  aria-label={`Import ${result.title} from ${result.sourceName}`}
                  className="web-image-result-tile"
                  disabled={Boolean(importingId)}
                  onClick={() => void importResult(result)}
                >
                  <img src={result.thumbnailUrl} alt="" />
                  <span className="web-image-result-meta">
                    <span>{result.title}</span>
                    <small>{importingId === result.id ? 'Importing...' : result.sourceName}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
