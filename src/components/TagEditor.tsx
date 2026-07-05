import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  addUniqueTags,
  filterTagSuggestions,
  listsMatch,
  splitTagInput,
} from './tagEditorModel';
import type { TagSuggestion } from './tagEditorModel';

type TagEditorProps = {
  label: string;
  tags: string[];
  suggestions: TagSuggestion[];
  emptyText?: string;
  onChange: (nextTags: string[]) => void;
};

export function TagEditor({
  label,
  tags,
  suggestions,
  emptyText = 'No tags yet',
  onChange,
}: TagEditorProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const editorRef = useRef<HTMLFieldSetElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const skipNextBlurCommitRef = useRef(false);
  const visibleSuggestions = useMemo(
    () => filterTagSuggestions(suggestions, tags, tagInput),
    [suggestions, tagInput, tags],
  );

  useEffect(() => {
    if (!isAdding) return;

    inputRef.current?.focus();
  }, [isAdding]);

  useEffect(() => {
    if (!isAdding) return;

    function handleDocumentPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (editorRef.current?.contains(event.target)) return;

      skipNextBlurCommitRef.current = true;
      setTagInput('');
      setActiveSuggestionIndex(null);
      setIsAdding(false);
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    };
  }, [isAdding]);

  function commitInput() {
    const nextTags = addUniqueTags(tags, splitTagInput(tagInput));
    setTagInput('');
    setActiveSuggestionIndex(null);

    if (!listsMatch(nextTags, tags)) {
      onChange(nextTags);
    }
  }

  function closeWithoutCommitting() {
    skipNextBlurCommitRef.current = true;
    setTagInput('');
    setActiveSuggestionIndex(null);
    setIsAdding(false);
    addButtonRef.current?.focus();
  }

  function addSuggestion(tag: string) {
    const nextTags = addUniqueTags(tags, [tag]);
    setTagInput('');
    setActiveSuggestionIndex(null);

    if (!listsMatch(nextTags, tags)) {
      onChange(nextTags);
    }
  }

  function removeTag(tagToRemove: string) {
    onChange(tags.filter((tag) => tag !== tagToRemove));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleSuggestions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setActiveSuggestionIndex((currentIndex) => {
        if (currentIndex === null) {
          return event.key === 'ArrowDown' ? 0 : visibleSuggestions.length - 1;
        }

        const direction = event.key === 'ArrowDown' ? 1 : -1;
        return (currentIndex + direction + visibleSuggestions.length) % visibleSuggestions.length;
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();

      const activeSuggestion =
        activeSuggestionIndex === null ? null : visibleSuggestions[activeSuggestionIndex];

      if (activeSuggestion) {
        addSuggestion(activeSuggestion.tag);
        return;
      }

      commitInput();
      return;
    }

    if (event.key === ',') {
      event.preventDefault();
      event.stopPropagation();
      commitInput();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeWithoutCommitting();
    }
  }

  function handleInputChange(value: string) {
    setTagInput(value);
    setActiveSuggestionIndex(null);
  }

  function handleInputBlur() {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }

    commitInput();
  }

  return (
    <fieldset ref={editorRef} className="tag-editor" aria-label={label}>
      <legend>{label}</legend>
      <div className="tag-pill-list">
        {tags.length === 0 ? <span className="tag-empty-state">{emptyText}</span> : null}
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="tag-pill"
            aria-label={`Remove tag ${tag}`}
            onClick={() => removeTag(tag)}
          >
            <span>{tag}</span>
            <X size={13} aria-hidden="true" />
          </button>
        ))}
        <button
          ref={addButtonRef}
          type="button"
          className="tag-add-button"
          aria-label="Add tag"
          title="Add tag"
          onClick={() => setIsAdding(true)}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      {isAdding ? (
        <div className="tag-add-popover">
          <input
            ref={inputRef}
            className="tag-popover-input"
            aria-label="Add tag"
            placeholder="Add tag"
            value={tagInput}
            onChange={(event) => handleInputChange(event.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
          />
          {visibleSuggestions.length > 0 ? (
            <div className="tag-suggestion-list" role="list" aria-label="Tag suggestions">
              {visibleSuggestions.map((suggestion, index) => (
                <div key={suggestion.tag} role="listitem">
                  <button
                    type="button"
                    className={`tag-suggestion${index === activeSuggestionIndex ? ' is-active' : ''}`}
                    aria-current={index === activeSuggestionIndex ? 'true' : undefined}
                    aria-label={`Add tag suggestion ${suggestion.tag}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                    onClick={() => addSuggestion(suggestion.tag)}
                  >
                    {suggestion.tag}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
