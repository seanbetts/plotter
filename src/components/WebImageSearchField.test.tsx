import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from '../services/webImageSearchClient';
import { WebImageSearchField } from './WebImageSearchField';

const context: WebImageSearchStopContext = {
  stopName: 'Paris',
  countryName: 'France',
  countryCode: 'FR',
};

const result: WebImageSearchResult = {
  id: 'image-1',
  title: 'Paris mural',
  sourceName: 'Example Source',
  sourceUrl: 'https://example.com/page',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  imageUrl: 'https://example.com/image.jpg',
  width: 1600,
  height: 1000,
};

function createClient(results: WebImageSearchResult[] = [result]): WebImageSearchClient {
  return {
    searchImages: vi.fn(async () => results),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe('WebImageSearchField', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches and renders image results in a popover grid', async () => {
    const user = userEvent.setup();
    const client = createClient();
    render(
      <WebImageSearchField
        context={context}
        client={client}
        onImportImage={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Search web images'), 'mural');

    await waitFor(() => expect(client.searchImages).toHaveBeenCalledWith('mural', context));
    const grid = await screen.findByRole('listbox', { name: 'Web image results' });
    expect(
      within(grid).getByRole('option', { name: 'Import Paris mural from Example Source' }),
    ).toBeInTheDocument();
  });

  it('imports immediately and clears the query on success', async () => {
    const user = userEvent.setup();
    const onImportImage = vi.fn(async () => undefined);
    render(
      <WebImageSearchField
        context={context}
        client={createClient()}
        onImportImage={onImportImage}
      />,
    );

    const input = screen.getByLabelText('Search web images');
    await user.type(input, 'mural');
    await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));

    expect(onImportImage).toHaveBeenCalledWith(result);
    expect(input).toHaveValue('');
  });

  it('keeps results open when import fails', async () => {
    const user = userEvent.setup();
    render(
      <WebImageSearchField
        context={context}
        client={createClient()}
        onImportImage={vi.fn(async () => {
          throw new Error('Imported image is too small.');
        })}
      />,
    );

    await user.type(screen.getByLabelText('Search web images'), 'mural');
    await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Imported image is too small.');
    expect(screen.getByRole('option', { name: 'Import Paris mural from Example Source' })).toBeInTheDocument();
  });

  it('ignores in-flight search results after the query changes', async () => {
    vi.useFakeTimers();
    const firstSearch = createDeferred<WebImageSearchResult[]>();
    const secondSearch = createDeferred<WebImageSearchResult[]>();
    const bridgeResult: WebImageSearchResult = {
      ...result,
      id: 'image-2',
      title: 'Paris bridge',
      sourceName: 'Bridge Source',
    };
    const client: WebImageSearchClient = {
      searchImages: vi.fn((query: string) => {
        if (query === 'mural') return firstSearch.promise;
        return secondSearch.promise;
      }),
    };
    render(
      <WebImageSearchField
        context={context}
        client={client}
        onImportImage={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Search web images');
    fireEvent.change(input, { target: { value: 'mural' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(client.searchImages).toHaveBeenCalledWith('mural', context);

    fireEvent.change(input, { target: { value: 'bridge' } });
    expect(client.searchImages).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSearch.resolve([result]);
    });

    expect(
      screen.queryByRole('option', { name: 'Import Paris mural from Example Source' }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(client.searchImages).toHaveBeenCalledWith('bridge', context);

    await act(async () => {
      secondSearch.resolve([bridgeResult]);
    });

    const grid = screen.getByRole('listbox', { name: 'Web image results' });
    expect(
      within(grid).getByRole('option', { name: 'Import Paris bridge from Bridge Source' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Import Paris mural from Example Source' }),
    ).not.toBeInTheDocument();
  });
});
