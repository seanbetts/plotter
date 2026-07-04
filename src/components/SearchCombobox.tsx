import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
  onSubmitQuery?: (query: string) => Promise<unknown> | unknown;
  renderResult: (result: Result, state: { isHighlighted: boolean }) => ReactNode;
};

const liveSearchDelayMs = 300;
const keepLatestSearchId = (_current: number, nextSearchId: number) => nextSearchId;

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
  onSubmitQuery,
  renderResult,
}: SearchComboboxProps<Result>) {
  const [internalQuery, setInternalQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [resultsQuery, setResultsQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchingQuery, setSearchingQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorQuery, setErrorQuery] = useState('');
  const [resultsSearchId, setResultsSearchId] = useState(0);
  const [latestClearSearchId, markLatestClearSearchId] = useReducer(keepLatestSearchId, 0);
  const latestSearchId = useRef(0);
  const searchTimerRef = useRef<number | null>(null);
  const query = value ?? internalQuery;
  const trimmedQuery = query.trim();
  const isCurrentResultsQuery =
    Boolean(trimmedQuery) &&
    resultsQuery === trimmedQuery &&
    resultsSearchId > latestClearSearchId;
  const visibleResults = isCurrentResultsQuery ? results : [];
  const visibleHighlightedIndex = isCurrentResultsQuery ? highlightedIndex : -1;
  const visibleIsSearching = Boolean(trimmedQuery) && isSearching && searchingQuery === trimmedQuery;
  const visibleError = Boolean(trimmedQuery) && errorQuery === trimmedQuery ? error : null;

  function setQuery(nextQuery: string) {
    if (value === undefined) {
      setInternalQuery(nextQuery);
    }

    onValueChange?.(nextQuery);
  }

  function invalidateSearches() {
    latestSearchId.current += 1;
    markLatestClearSearchId(latestSearchId.current);
  }

  function resetSearchState() {
    invalidateSearches();
    setResults([]);
    setResultsQuery('');
    setResultsSearchId(0);
    setHighlightedIndex(-1);
    setIsSearching(false);
    setSearchingQuery('');
    setError(null);
    setErrorQuery('');
  }

  const handleSearch = useCallback(
    async (nextQuery: string) => {
      const searchId = latestSearchId.current + 1;
      latestSearchId.current = searchId;
      setIsSearching(true);
      setSearchingQuery(nextQuery);
      setError(null);
      setErrorQuery('');

      try {
        const nextResults = await search(nextQuery);
        if (searchId !== latestSearchId.current) return;
        setResults(nextResults);
        setResultsQuery(nextQuery);
        setResultsSearchId(searchId);
        setHighlightedIndex(-1);
      } catch (caught) {
        if (searchId !== latestSearchId.current) return;
        setResults([]);
        setResultsQuery('');
        setResultsSearchId(0);
        setHighlightedIndex(-1);
        setError(caught instanceof Error ? caught.message : 'Search failed');
        setErrorQuery(nextQuery);
      } finally {
        if (searchId === latestSearchId.current) {
          setIsSearching(false);
          setSearchingQuery('');
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
      invalidateSearches();
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
    setQuery('');
    resetSearchState();
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

  async function submitQuery() {
    const trimmed = query.trim();
    if (!trimmed || !onSubmitQuery) return;

    setError(null);
    try {
      await onSubmitQuery(trimmed);
      clearSearch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit search');
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
      setHighlightedIndex((current) => Math.min(current + 1, visibleResults.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (
      event.key === 'Enter' &&
      visibleHighlightedIndex >= 0 &&
      visibleResults[visibleHighlightedIndex]
    ) {
      event.preventDefault();
      void selectResult(visibleResults[visibleHighlightedIndex]);
      return;
    }

    if (event.key === 'Enter' && onSubmitQuery) {
      event.preventDefault();
      void submitQuery();
    }
  }

  const activeResultId =
    visibleHighlightedIndex >= 0 && visibleResults[visibleHighlightedIndex]
      ? `${resultsId}-${getResultId(visibleResults[visibleHighlightedIndex])}`
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
              resetSearchState();
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visibleResults.length > 0}
          aria-controls={resultsId}
          aria-activedescendant={activeResultId}
        />
        {query ? (
          <button type="button" className="search-clear" aria-label={clearLabel} onClick={clearSearch}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {visibleIsSearching ? <div className="toolbar-status">Searching...</div> : null}
      {visibleError ? <div className="toolbar-error">{visibleError}</div> : null}
      {visibleResults.length > 0 ? (
        <div id={resultsId} className="search-results" role="listbox">
          {visibleResults.map((result, index) => {
            const isHighlighted = index === visibleHighlightedIndex;
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
