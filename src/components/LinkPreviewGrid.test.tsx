import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import { LinkPreviewGrid } from './LinkPreviewGrid';

function createResearchLink(overrides: Partial<ResearchLink> = {}): ResearchLink {
  return {
    id: 'link-1',
    title: 'Museum guide',
    url: 'https://example.com/museum',
    domain: 'example.com',
    imageUrl: 'https://example.com/museum.jpg',
    sortOrder: 0,
    previewFetchedAt: '2026-07-04T10:00:00.000Z',
    ...overrides,
  };
}

function createPreviewClient(overrides: Partial<LinkPreviewClient> = {}): LinkPreviewClient {
  return {
    fetchPreview: vi.fn().mockResolvedValue({
      title: 'Fetched cafe',
      url: 'https://cafe.example/visit',
      domain: 'cafe.example',
      imageUrl: 'https://cafe.example/hero.jpg',
    }),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createProps(overrides: Partial<React.ComponentProps<typeof LinkPreviewGrid>> = {}) {
  return {
    label: 'Research links',
    links: [
      createResearchLink(),
      createResearchLink({
        id: 'link-2',
        title: 'Train schedule',
        url: 'https://rail.example/times',
        domain: 'rail.example',
        imageUrl: undefined,
        sortOrder: 1,
        previewFetchedAt: '2026-07-04T10:05:00.000Z',
      }),
    ],
    previewClient: createPreviewClient(),
    onChange: vi.fn(),
    ...overrides,
  };
}

function dragOver(element: Element, clientX: number) {
  const event = createEvent.dragOver(element);
  Object.defineProperty(event, 'clientX', { value: clientX });
  fireEvent(element, event);
}

function drop(element: Element, clientX: number) {
  const event = createEvent.drop(element);
  Object.defineProperty(event, 'clientX', { value: clientX });
  fireEvent(element, event);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LinkPreviewGrid', () => {
  it('renders image-led link cards as anchors with delete buttons and a section label', () => {
    render(<LinkPreviewGrid {...createProps()} />);

    const region = screen.getByRole('region', { name: 'Research links' });
    const museumLink = within(region).getByRole('link', { name: /Museum guide/ });
    const trainLink = within(region).getByRole('link', { name: /Train schedule/ });

    expect(museumLink).toHaveAttribute('href', 'https://example.com/museum');
    expect(museumLink).toHaveAttribute('target', '_blank');
    expect(museumLink).toHaveAttribute('rel', 'noreferrer');
    expect(within(museumLink).getByRole('img', { name: 'Preview for Museum guide' })).toHaveAttribute(
      'src',
      'https://example.com/museum.jpg',
    );
    expect(trainLink).toHaveAttribute('href', 'https://rail.example/times');
    expect(within(trainLink).getByText('T')).toHaveClass('link-preview-card__fallback-initial');
    expect(within(region).getByRole('button', { name: 'Delete Museum guide' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Delete Train schedule' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Move Train schedule up' })).not.toHaveClass('sr-only');
  });

  it('adds a fetched preview link from the entered URL', async () => {
    vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const previewClient = createPreviewClient();
    const onChange = vi.fn();

    render(<LinkPreviewGrid {...createProps({ links: [], previewClient, onChange })} />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'cafe.example/visit' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() => expect(previewClient.fetchPreview).toHaveBeenCalledWith('cafe.example/visit'));
    expect(onChange).toHaveBeenCalledWith([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Fetched cafe',
        url: 'https://cafe.example/visit',
        domain: 'cafe.example',
        imageUrl: 'https://cafe.example/hero.jpg',
        sortOrder: 0,
        previewFetchedAt: '2026-07-04T12:00:00.000Z',
      },
    ]);
    expect(screen.getByLabelText('Add link URL')).toHaveValue('');
  });

  it('falls back to a domain card when preview fetching fails', async () => {
    vi.setSystemTime(new Date('2026-07-04T12:15:00.000Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000002');
    const previewClient = createPreviewClient({
      fetchPreview: vi.fn().mockRejectedValue(new Error('Preview failed')),
    });
    const onChange = vi.fn();

    render(<LinkPreviewGrid {...createProps({ links: [], previewClient, onChange })} />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'https://fallback.example/path' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        {
          id: '00000000-0000-4000-8000-000000000002',
          title: 'fallback.example',
          url: 'https://fallback.example/path',
          domain: 'fallback.example',
          sortOrder: 0,
          previewFetchedAt: '2026-07-04T12:15:00.000Z',
        },
      ]),
    );
    expect(screen.getByLabelText('Add link URL')).toHaveValue('');
  });

  it('prevents duplicate submits while a preview fetch is pending', async () => {
    const previewRequest = deferred<Awaited<ReturnType<LinkPreviewClient['fetchPreview']>>>();
    const previewClient = createPreviewClient({
      fetchPreview: vi.fn().mockReturnValue(previewRequest.promise),
    });
    const onChange = vi.fn();

    render(<LinkPreviewGrid {...createProps({ previewClient, onChange })} />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'https://cafe.example/visit' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    expect(previewClient.fetchPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Add link URL')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Museum guide' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Train schedule up' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Museum guide/ }).closest('article')).toHaveAttribute(
      'draggable',
      'false',
    );

    await act(async () => {
      previewRequest.resolve({
        title: 'Fetched cafe',
        url: 'https://cafe.example/visit',
        domain: 'cafe.example',
      });
      await previewRequest.promise;
    });
  });

  it('does not resurrect a deleted link when a pending preview resolves', async () => {
    vi.setSystemTime(new Date('2026-07-04T12:30:00.000Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000003');
    const previewRequest = deferred<Awaited<ReturnType<LinkPreviewClient['fetchPreview']>>>();
    const previewClient = createPreviewClient({
      fetchPreview: vi.fn().mockReturnValue(previewRequest.promise),
    });

    function Harness() {
      const [links, setLinks] = useState([
        createResearchLink({ id: 'link-1', title: 'Museum guide', sortOrder: 0 }),
      ]);

      return (
        <>
          <button type="button" onClick={() => setLinks([])}>
            Parent delete Museum guide
          </button>
          <LinkPreviewGrid
            label="Research links"
            links={links}
            previewClient={previewClient}
            onChange={setLinks}
          />
        </>
      );
    }

    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'https://cafe.example/visit' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Parent delete Museum guide' }));

    expect(screen.queryByRole('link', { name: /Museum guide/ })).not.toBeInTheDocument();

    await act(async () => {
      previewRequest.resolve({
        title: 'Fetched cafe',
        url: 'https://cafe.example/visit',
        domain: 'cafe.example',
      });
      await previewRequest.promise;
    });

    expect(screen.queryByRole('link', { name: /Museum guide/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Fetched cafe/ })).toBeInTheDocument();
  });

  it('keeps add locked until async onChange settles before accepting another submit', async () => {
    vi.setSystemTime(new Date('2026-07-04T12:45:00.000Z'));
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005');
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const previewClient = createPreviewClient({
      fetchPreview: vi
        .fn()
        .mockResolvedValueOnce({
          title: 'First cafe',
          url: 'https://first.example/visit',
          domain: 'first.example',
        })
        .mockResolvedValueOnce({
          title: 'Second cafe',
          url: 'https://second.example/visit',
          domain: 'second.example',
        }),
    });
    const saveRequests: ResearchLink[][] = [];

    function Harness() {
      const [links, setLinks] = useState<ResearchLink[]>([]);

      return (
        <LinkPreviewGrid
          label="Research links"
          links={links}
          previewClient={previewClient}
          onChange={(nextLinks) => {
            saveRequests.push(nextLinks);
            const save = saveRequests.length === 1 ? firstSave : secondSave;

            return save.promise.then(() => setLinks(nextLinks));
          }}
        />
      );
    }

    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'https://first.example/visit' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() => expect(saveRequests).toHaveLength(1));
    expect(previewClient.fetchPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Add link URL')).toBeDisabled();

    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));
    expect(previewClient.fetchPreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });

    expect(screen.getByRole('link', { name: /First cafe/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'https://second.example/visit' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() => expect(saveRequests).toHaveLength(2));
    expect(previewClient.fetchPreview).toHaveBeenCalledTimes(2);
    expect(saveRequests[1]).toEqual([
      expect.objectContaining({ title: 'First cafe', sortOrder: 0 }),
      expect.objectContaining({ title: 'Second cafe', sortOrder: 1 }),
    ]);

    await act(async () => {
      secondSave.resolve();
      await secondSave.promise;
    });

    expect(screen.getByRole('link', { name: /First cafe/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Second cafe/ })).toBeInTheDocument();
  });

  it('shows an inline validation error for invalid URLs and does not call onChange', () => {
    const previewClient = createPreviewClient();
    const onChange = vi.fn();

    render(<LinkPreviewGrid {...createProps({ previewClient, onChange })} />);

    fireEvent.change(screen.getByLabelText('Add link URL'), {
      target: { value: 'ftp://example.com/guide' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Links must use http or https.');
    expect(previewClient.fetchPreview).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('deletes a link and reassigns dense sort orders', () => {
    const onChange = vi.fn();

    render(
      <LinkPreviewGrid
        {...createProps({
          links: [
            createResearchLink({ id: 'link-1', title: 'First', sortOrder: 0 }),
            createResearchLink({ id: 'link-2', title: 'Second', sortOrder: 1 }),
            createResearchLink({ id: 'link-3', title: 'Third', sortOrder: 2 }),
          ],
          onChange,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Second' }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'link-1', sortOrder: 0 }),
      expect.objectContaining({ id: 'link-3', sortOrder: 1 }),
    ]);
  });

  it('reorders links by dragging the tile itself', () => {
    const onChange = vi.fn();

    render(<LinkPreviewGrid {...createProps({ onChange })} />);

    const museumLink = screen.getByRole('link', { name: /Museum guide/ });
    const trainLink = screen.getByRole('link', { name: /Train schedule/ });

    vi.spyOn(trainLink, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      width: 200,
      height: 160,
      top: 0,
      right: 300,
      bottom: 160,
      left: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(museumLink);
    dragOver(trainLink, 280);
    drop(trainLink, 280);

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'link-2', sortOrder: 0 }),
      expect.objectContaining({ id: 'link-1', sortOrder: 1 }),
    ]);
  });
});
