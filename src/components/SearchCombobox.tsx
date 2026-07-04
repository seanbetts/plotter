import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type SearchComboboxProps<Result> = {
  label: string;
  placeholder: string;
  inputId: string;
  resultsId: string;
  className?: string;
  clearLabel?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  search: (query: string) => Promise<Result[]>;
  getResultId: (result: Result) => string;
  getResultLabel: (result: Result) => string;
  onSelectResult: (result: Result) => Promise<unknown> | unknown;
  renderResult: (result: Result, state: { isHighlighted: boolean }) => ReactNode;
};

const liveSearchDelayMs = 300;

export function SearchCombobox<Result>({
  label,
  placeholder,
  inputId,
  resultsId,
  className = 'search-group',
  clearLabel = 'Clear search',
  value,
  onValueChange,
  search,
  getResultId,
  getResultLabel,
  onSelectResult,
  renderResult,
}: SearchComboboxProps<Result>) {
  const [internalQuery, setInternalQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSearchId = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const query = value ?? internalQuery;

  function setQuery(nextQuery: string) {
    if (value === undefined) {
      setInternalQuery(nextQuery);
    }

    onValueChange?.(nextQuery);
  }

  const handleSearch = useCallback(
    async (nextQuery: string) => {
      const searchId = latestSearchId.current + 1;
      latestSearchId.current = searchId;
      setIsSearching(true);
      setError(null);

      try {
        const nextResults = await search(nextQuery);
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
    [search],
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

  function clearSearch() {
    latestSearchId.current += 1;
    setQuery('');
    setResults([]);
    setHighlightedIndex(-1);
    setIsSearching(false);
    setError(null);
  }

  async function selectResult(result: Result) {
    setError(null);

    try {
      await onSelectResult(result);
      clearSearch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to select result');
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
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
      void selectResult(results[highlightedIndex]);
    }
  }

  const activeResultId =
    highlightedIndex >= 0 && results[highlightedIndex]
      ? `${resultsId}-${getResultId(results[highlightedIndex])}`
      : undefined;

  return (
    <div className={className}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <div className="search-input-shell">
        <Search className="search-input-icon" size={18} aria-hidden="true" />
        <input
          id={inputId}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            if (!nextQuery.trim()) {
              latestSearchId.current += 1;
              setResults([]);
              setHighlightedIndex(-1);
              setIsSearching(false);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={resultsId}
          aria-activedescendant={activeResultId}
        />
        {query ? (
          <button type="button" className="search-clear" aria-label={clearLabel} onClick={clearSearch}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {isSearching ? <div className="toolbar-status">Searching...</div> : null}
      {error ? <div className="toolbar-error">{error}</div> : null}
      {results.length > 0 ? (
        <div id={resultsId} className="search-results" role="listbox">
          {results.map((result, index) => {
            const isHighlighted = index === highlightedIndex;
            const resultId = `${resultsId}-${getResultId(result)}`;

            return (
              <button
                id={resultId}
                key={resultId}
                type="button"
                role="option"
                aria-label={getResultLabel(result)}
                aria-selected={isHighlighted}
                className={isHighlighted ? 'is-highlighted' : undefined}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => void selectResult(result)}
              >
                {renderResult(result, { isHighlighted })}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
