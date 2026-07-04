import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchCombobox } from './SearchCombobox';

type Result = {
  id: string;
  label: string;
  title: string;
  subtitle: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function renderSearchCombobox(input: {
  search?: (query: string) => Promise<Result[]>;
  onSelect?: (result: Result) => Promise<unknown> | unknown;
  onSubmitQuery?: (query: string) => Promise<unknown> | unknown;
} = {}) {
  return render(
    <SearchCombobox<Result>
      label="Search test places"
      placeholder="Search places"
      inputId="test-search"
      resultsId="test-search-results"
      search={input.search ?? vi.fn().mockResolvedValue([])}
      getResultId={(result) => result.id}
      getResultLabel={(result) => result.label}
      onSelectResult={input.onSelect ?? vi.fn()}
      onSubmitQuery={input.onSubmitQuery}
      renderResult={(result) => (
        <>
          <span>{result.title}</span>
          <span>{result.subtitle}</span>
        </>
      )}
    />,
  );
}

describe('SearchCombobox', () => {
  it('searches, renders results, and selects the highlighted result', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const search = vi.fn().mockResolvedValue([
      { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
    ]);
    renderSearchCombobox({ search, onSelect });

    await user.type(screen.getByLabelText('Search test places'), 'Paris');

    await waitFor(() => expect(search).toHaveBeenCalledWith('Paris'));
    expect(await screen.findByRole('option', { name: 'Paris, France' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith({
      id: 'paris',
      label: 'Paris, France',
      title: 'Paris',
      subtitle: 'France',
    });
    expect(screen.getByLabelText('Search test places')).toHaveValue('');
  });

  it('ignores stale search responses', async () => {
    const user = userEvent.setup();
    const first = deferred<Result[]>();
    const second = deferred<Result[]>();
    const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderSearchCombobox({ search });

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Paris'));
    await user.clear(input);
    await user.type(input, 'Seoul');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Seoul'));

    first.resolve([{ id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' }]);
    await waitFor(() => expect(screen.getByText('Searching...')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();

    second.resolve([{ id: 'seoul', label: 'Seoul, South Korea', title: 'Seoul', subtitle: 'South Korea' }]);
    expect(await screen.findByRole('option', { name: 'Seoul, South Korea' })).toBeInTheDocument();
  });

  it('clears query, results, and errors', async () => {
    const user = userEvent.setup();
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' }])
      .mockRejectedValueOnce(new Error('Search unavailable'));
    renderSearchCombobox({ search });

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await screen.findByRole('option', { name: 'Paris, France' });
    await user.clear(input);
    await user.type(input, 'Ankara');
    await screen.findByText('Search unavailable');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(input).toHaveValue('');
    expect(screen.queryByText('Search unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();
  });

  it('shows errors from selecting a result', async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue([
      { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
    ]);
    renderSearchCombobox({
      search,
      onSelect: vi.fn().mockRejectedValue(new Error('Unable to add destination')),
    });

    await user.type(screen.getByLabelText('Search test places'), 'Paris');
    await screen.findByRole('option', { name: 'Paris, France' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(await screen.findByText('Unable to add destination')).toBeInTheDocument();
  });

  it('shows errors from submitting the current query', async () => {
    const user = userEvent.setup();
    renderSearchCombobox({
      onSubmitQuery: vi.fn().mockRejectedValue(new Error('Unable to create activity')),
    });

    await user.type(screen.getByLabelText('Search test places'), 'Bakery crawl{Enter}');

    expect(await screen.findByText('Unable to create activity')).toBeInTheDocument();
  });

  it('cancels Escape when clearing an active search', async () => {
    const user = userEvent.setup();
    const onAncestorKeyDown = vi.fn();
    const search = vi.fn().mockResolvedValue([
      { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
    ]);
    render(
      <div onKeyDown={onAncestorKeyDown}>
        <SearchCombobox<Result>
          label="Search test places"
          placeholder="Search places"
          inputId="test-search"
          resultsId="test-search-results"
          search={search}
          getResultId={(result) => result.id}
          getResultLabel={(result) => result.label}
          onSelectResult={vi.fn()}
          renderResult={(result) => <span>{result.title}</span>}
        />
      </div>,
    );

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await screen.findByRole('option', { name: 'Paris, France' });
    onAncestorKeyDown.mockClear();

    const wasNotCanceled = fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(onAncestorKeyDown).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('supports controlled query state', async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue([]);

    function ControlledSearch() {
      const [value, setValue] = useState('Paris');

      return (
        <>
          <SearchCombobox<Result>
            label="Search test places"
            placeholder="Search places"
            inputId="test-search"
            resultsId="test-search-results"
            value={value}
            onValueChange={setValue}
            search={search}
            getResultId={(result) => result.id}
            getResultLabel={(result) => result.label}
            onSelectResult={vi.fn()}
            renderResult={(result) => <span>{result.title}</span>}
          />
          <button type="button" onClick={() => setValue('Seoul')}>
            Set Seoul
          </button>
        </>
      );
    }

    render(<ControlledSearch />);

    const input = screen.getByLabelText('Search test places');
    expect(input).toHaveValue('Paris');

    await user.clear(input);
    await user.type(input, 'Rome');
    expect(input).toHaveValue('Rome');

    await user.click(screen.getByRole('button', { name: 'Set Seoul' }));
    expect(input).toHaveValue('Seoul');
  });

  it('does not expose stale controlled results after an external clear and new query', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const seoulSearch = deferred<Result[]>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
      ])
      .mockReturnValueOnce(seoulSearch.promise);

    function ControlledSearch() {
      const [value, setValue] = useState('');

      return (
        <>
          <SearchCombobox<Result>
            label="Search test places"
            placeholder="Search places"
            inputId="test-search"
            resultsId="test-search-results"
            value={value}
            onValueChange={setValue}
            search={search}
            getResultId={(result) => result.id}
            getResultLabel={(result) => result.label}
            onSelectResult={onSelect}
            renderResult={(result) => <span>{result.title}</span>}
          />
          <button type="button" onClick={() => setValue('')}>
            External clear
          </button>
        </>
      );
    }

    render(<ControlledSearch />);

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Paris'));
    expect(await screen.findByRole('option', { name: 'Paris, France' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');

    await user.click(screen.getByRole('button', { name: 'External clear' }));

    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();

    await user.type(input, 'Seoul');
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();

    seoulSearch.resolve([
      { id: 'seoul', label: 'Seoul, South Korea', title: 'Seoul', subtitle: 'South Korea' },
    ]);
    expect(await screen.findByRole('option', { name: 'Seoul, South Korea' })).toBeInTheDocument();
  });

  it('does not revive stale controlled results when retyping the same query after external clear', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const secondParisSearch = deferred<Result[]>();
    const search = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
      ])
      .mockReturnValueOnce(secondParisSearch.promise);

    function ControlledSearch() {
      const [value, setValue] = useState('');

      return (
        <>
          <SearchCombobox<Result>
            label="Search test places"
            placeholder="Search places"
            inputId="test-search"
            resultsId="test-search-results"
            value={value}
            onValueChange={setValue}
            search={search}
            getResultId={(result) => result.id}
            getResultLabel={(result) => result.label}
            onSelectResult={onSelect}
            renderResult={(result) => <span>{result.title}</span>}
          />
          <button type="button" onClick={() => setValue('')}>
            External clear
          </button>
        </>
      );
    }

    render(<ControlledSearch />);

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Paris'));
    expect(await screen.findByRole('option', { name: 'Paris, France' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');

    await user.click(screen.getByRole('button', { name: 'External clear' }));
    await user.type(input, 'Paris');

    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();

    secondParisSearch.resolve([
      { id: 'paris-2', label: 'Paris, Texas', title: 'Paris', subtitle: 'Texas' },
    ]);
    expect(await screen.findByRole('option', { name: 'Paris, Texas' })).toBeInTheDocument();
  });
});
