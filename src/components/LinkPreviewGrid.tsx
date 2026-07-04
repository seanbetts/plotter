import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import {
  createFallbackResearchLink,
  deriveLinkDomain,
  normalizeResearchLinkUrl,
  reorderResearchLinks,
  sortResearchLinks,
} from '../domain/researchLinks';
import type { ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';

export type LinkPreviewGridProps = {
  label: string;
  links: ResearchLink[];
  previewClient: LinkPreviewClient;
  onChange: (links: ResearchLink[]) => Promise<void> | void;
};

type DropSide = 'before' | 'after';

function denseSortOrders(links: ResearchLink[]) {
  return links.map((link, sortOrder) => ({
    ...link,
    sortOrder,
  }));
}

function getNextSortOrder(links: ResearchLink[]) {
  if (links.length === 0) return 0;

  return Math.max(...links.map((link) => link.sortOrder)) + 1;
}

function getDropSide(event: DragEvent<HTMLElement>): DropSide {
  const bounds = event.currentTarget.getBoundingClientRect();
  const midpoint = bounds.left + bounds.width / 2;

  return event.clientX < midpoint ? 'before' : 'after';
}

function orderAroundTarget(
  links: ResearchLink[],
  draggedLinkId: string,
  targetLinkId: string,
  side: DropSide,
) {
  if (draggedLinkId === targetLinkId) {
    return links.map((link) => link.id);
  }

  const withoutDragged = links.filter((link) => link.id !== draggedLinkId);
  const targetIndex = withoutDragged.findIndex((link) => link.id === targetLinkId);
  const draggedLink = links.find((link) => link.id === draggedLinkId);

  if (!draggedLink || targetIndex === -1) {
    return links.map((link) => link.id);
  }

  const insertionIndex = side === 'before' ? targetIndex : targetIndex + 1;

  return [
    ...withoutDragged.slice(0, insertionIndex).map((link) => link.id),
    draggedLink.id,
    ...withoutDragged.slice(insertionIndex).map((link) => link.id),
  ];
}

function fallbackInitial(link: ResearchLink) {
  return (link.title.trim() || link.domain || link.url).charAt(0).toUpperCase();
}

export function LinkPreviewGrid({ label, links, previewClient, onChange }: LinkPreviewGridProps) {
  const inputId = useId();
  const errorId = useId();
  const sortedLinks = useMemo(() => sortResearchLinks(links), [links]);
  const latestSortedLinksRef = useRef(sortedLinks);
  const isMutatingRef = useRef(false);
  const [linkInput, setLinkInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [draggedLinkId, setDraggedLinkId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ linkId: string; side: DropSide } | null>(null);

  useEffect(() => {
    latestSortedLinksRef.current = sortedLinks;
  }, [sortedLinks]);

  const commitLinks = async (nextLinks: ResearchLink[]) => {
    const previousLinks = latestSortedLinksRef.current;

    latestSortedLinksRef.current = nextLinks;

    try {
      await onChange(nextLinks);
    } catch (error) {
      latestSortedLinksRef.current = previousLinks;
      throw error;
    }
  };

  const runMutation = async (createNextLinks: () => ResearchLink[] | Promise<ResearchLink[]>) => {
    if (isMutatingRef.current) return;

    isMutatingRef.current = true;
    setIsMutating(true);

    try {
      await commitLinks(await createNextLinks());
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isMutatingRef.current) return;

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeResearchLinkUrl(linkInput);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Enter a valid URL.');
      return;
    }

    setError(null);

    void runMutation(async () => {
      let createNewLink: (sortOrder: number) => ResearchLink;

      try {
        const preview = await previewClient.fetchPreview(linkInput);
        const previewUrl = normalizeResearchLinkUrl(preview.url);
        const domain = preview.domain.trim() || deriveLinkDomain(previewUrl);
        const title = preview.title.trim() || domain;

        createNewLink = (sortOrder) => ({
          id: crypto.randomUUID(),
          title,
          url: previewUrl,
          domain,
          ...(preview.imageUrl ? { imageUrl: preview.imageUrl } : {}),
          sortOrder,
          previewFetchedAt: new Date().toISOString(),
        });
      } catch {
        createNewLink = (sortOrder) => createFallbackResearchLink(normalizedUrl, { sortOrder });
      }

      const currentLinks = latestSortedLinksRef.current;
      const newLink = createNewLink(getNextSortOrder(currentLinks));

      setLinkInput('');

      return [
        ...currentLinks,
        newLink,
      ];
    }).catch(() => undefined);
  };

  const deleteLink = (linkId: string) => {
    void runMutation(() => denseSortOrders(latestSortedLinksRef.current.filter((link) => link.id !== linkId))).catch(
      () => undefined,
    );
  };

  const moveLink = (linkId: string, direction: -1 | 1) => {
    void runMutation(() => {
      const currentLinks = latestSortedLinksRef.current;
      const linkIndex = currentLinks.findIndex((link) => link.id === linkId);
      const targetIndex = linkIndex + direction;

      if (linkIndex === -1 || targetIndex < 0 || targetIndex >= currentLinks.length) {
        return currentLinks;
      }

      const nextLinks = [...currentLinks];
      const [movedLink] = nextLinks.splice(linkIndex, 1);
      nextLinks.splice(targetIndex, 0, movedLink);
      return denseSortOrders(nextLinks);
    }).catch(() => undefined);
  };

  const canDropOnLink = (linkId: string) => Boolean(!isMutatingRef.current && draggedLinkId && draggedLinkId !== linkId);

  const handleDragStart = (event: DragEvent<HTMLElement>, linkId: string) => {
    if (isMutatingRef.current) {
      event.preventDefault();
      return;
    }

    setDraggedLinkId(linkId);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', linkId);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, linkId: string) => {
    if (!canDropOnLink(linkId)) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setDropTarget({ linkId, side: getDropSide(event) });
  };

  const handleDrop = (event: DragEvent<HTMLElement>, targetLinkId: string) => {
    if (!draggedLinkId || !canDropOnLink(targetLinkId)) {
      setDraggedLinkId(null);
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    const draggedId = draggedLinkId;
    const dropSide = getDropSide(event);
    setDraggedLinkId(null);
    setDropTarget(null);
    void runMutation(() => {
      const currentLinks = latestSortedLinksRef.current;
      const orderedIds = orderAroundTarget(currentLinks, draggedId, targetLinkId, dropSide);
      return reorderResearchLinks(currentLinks, orderedIds);
    }).catch(() => undefined);
  };

  return (
    <section className="link-preview-section" aria-label={label}>
      <form className="link-preview-add-form" aria-label="Add link" onSubmit={handleSubmit}>
        <label htmlFor={inputId}>Add link URL</label>
        <div className="link-preview-add-row">
          <input
            id={inputId}
            value={linkInput}
            onChange={(event) => setLinkInput(event.target.value)}
            placeholder="Add link"
            aria-describedby={error ? errorId : undefined}
            disabled={isMutating}
          />
          <button type="submit" disabled={isMutating}>
            <Plus size={16} aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>
        {error ? (
          <p className="link-preview-error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </form>

      <div className="link-preview-grid">
        {sortedLinks.map((link) => {
          const dropClass =
            dropTarget?.linkId === link.id ? ` is-drop-${dropTarget.side}` : '';

          return (
            <article
              className={`link-preview-card${draggedLinkId === link.id ? ' is-dragging' : ''}${dropClass}`}
              draggable={!isMutating}
              key={link.id}
              onDragStart={(event) => handleDragStart(event, link.id)}
              onDragEnd={() => {
                setDraggedLinkId(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => handleDragOver(event, link.id)}
              onDragLeave={() => setDropTarget((target) => (target?.linkId === link.id ? null : target))}
              onDrop={(event) => handleDrop(event, link.id)}
            >
              <a className="link-preview-card__link" href={link.url} target="_blank" rel="noreferrer">
                <span className="link-preview-card__media" aria-hidden={link.imageUrl ? undefined : 'true'}>
                  {link.imageUrl ? (
                    <img src={link.imageUrl} alt={`Preview for ${link.title}`} />
                  ) : (
                    <span className="link-preview-card__fallback-initial">{fallbackInitial(link)}</span>
                  )}
                </span>
                <span className="link-preview-card__body">
                  <span className="link-preview-card__title">{link.title}</span>
                  <span className="link-preview-card__domain">{link.domain}</span>
                </span>
              </a>
              <button
                className="link-preview-card__delete"
                type="button"
                aria-label={`Delete ${link.title}`}
                disabled={isMutating}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  deleteLink(link.id);
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
              <div className="link-preview-card__keyboard-actions">
                <button
                  type="button"
                  className="link-preview-card__move"
                  aria-label={`Move ${link.title} up`}
                  onClick={() => moveLink(link.id, -1)}
                  disabled={isMutating || sortedLinks[0]?.id === link.id}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="link-preview-card__move"
                  aria-label={`Move ${link.title} down`}
                  onClick={() => moveLink(link.id, 1)}
                  disabled={isMutating || sortedLinks.at(-1)?.id === link.id}
                >
                  Down
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
