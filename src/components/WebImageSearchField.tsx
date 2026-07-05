import { Image as ImageIcon, LoaderCircle, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
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
  const inputId = useId();
  const resultsId = useId();
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

  const searchImages = useCallback((searchQuery: string) => {
    const searchId = latestSearchId.current + 1;
    latestSearchId.current = searchId;
    setIsSearching(true);
    setError('');

    void client.searchImages(searchQuery, context)
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
  }, [client, context]);

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

    searchTimerRef.current = window.setTimeout(() => {
      searchImages(trimmedQuery);
    }, liveSearchDelayMs);

    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchImages, trimmedQuery]);

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
      latestSearchId.current += 1;
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
      return;
    }

    if (event.key === 'Enter' && trimmedQuery) {
      event.preventDefault();
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
      searchImages(trimmedQuery);
    }
  }

  return (
    <div className="activity-add-row">
      <label className="sr-only" htmlFor={inputId}>
        Search web images
      </label>
      <div className="activity-search-group">
        <div className="search-input-shell">
          <ImageIcon className="search-input-icon" size={18} aria-hidden="true" />
          <input
            id={inputId}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search web images"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showPopover}
            aria-controls={resultsId}
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
                id={resultsId}
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
      <button
        type="button"
        aria-label="Submit web image search"
        disabled={!trimmedQuery || isSearching}
        onClick={() => {
          if (searchTimerRef.current !== null) {
            window.clearTimeout(searchTimerRef.current);
          }
          searchImages(trimmedQuery);
        }}
      >
        {isSearching ? <LoaderCircle size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
      </button>
    </div>
  );
}
