# Tag Editor Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible stop/activity tag input with a compact pill row, upward add popover, empty state, and shared stop/activity tag suggestions.

**Architecture:** Extract tag parsing, dedupe, ranking, and filtering into a focused model helper, then build a persistence-agnostic `TagEditor` component on top of it. `DestinationProfile` and `ActivityPanel` own persistence as they do today, while `App.tsx` computes one shared tag vocabulary from all loaded destinations and activities.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, lucide-react, existing CSS in `src/styles.css`.

---

## File Structure

- Create `src/components/tagEditorModel.ts`: pure helpers for tag splitting, case-insensitive dedupe, shared suggestion aggregation, and query filtering.
- Create `src/components/tagEditorModel.test.ts`: fast helper coverage for ranking and filtering.
- Create `src/components/TagEditor.tsx`: shared fieldset UI with resting pill row, empty state, upward popover, input handling, suggestion buttons, focus return, and `onChange(nextTags)`.
- Create `src/components/TagEditor.test.tsx`: component behavior tests independent of stop/activity persistence.
- Modify `src/components/DestinationProfile.tsx`: remove local tag helper/input state, accept `tagSuggestions`, render `TagEditor`, and route `onChange` through existing autosave form state.
- Modify `src/components/DestinationProfile.test.tsx`: update tag tests for the `+` popover flow and autosave.
- Modify `src/components/ActivityPanel.tsx`: remove local tag helpers/input state, accept `tagSuggestions`, render `TagEditor`, and route `onChange` through existing immediate save path.
- Modify `src/components/ActivityPanel.test.tsx`: update tag tests for the `+` popover flow and immediate save.
- Modify `src/App.tsx`: compute shared tag suggestions from `destinations` and all arrays in `activitiesByDestinationId`, then pass them to both panels.
- Modify `src/App.test.tsx`: add coverage proving stop and activity tags both feed suggestions.
- Modify `src/styles.css`: restyle `.tag-editor` children for compact resting rows and upward overlay popover.
- Modify `src/styles.test.ts`: lock the bottom alignment, overlay popover, and compact empty/populated row footprint.

Before implementation, run `git status --short`. This workspace may contain unrelated edits. Do not revert them. Stage only the files listed in the task being committed.

---

### Task 1: Add Tag Model Helpers

**Files:**
- Create: `src/components/tagEditorModel.ts`
- Create: `src/components/tagEditorModel.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `src/components/tagEditorModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addUniqueTags,
  buildTagSuggestions,
  filterTagSuggestions,
  splitTagInput,
} from './tagEditorModel';

describe('tag editor model', () => {
  it('splits comma-separated input into trimmed tags', () => {
    expect(splitTagInput(' food, garden , ,family ')).toEqual(['food', 'garden', 'family']);
  });

  it('adds tags case-insensitively without changing existing tags', () => {
    expect(addUniqueTags(['Food'], ['food', 'Garden'])).toEqual(['Food', 'Garden']);
  });

  it('builds shared suggestions from stop and activity tags by frequency then name', () => {
    expect(
      buildTagSuggestions([
        ['garden', 'family'],
        ['food'],
        ['Family', 'food'],
        ['architecture'],
      ]),
    ).toEqual([
      { tag: 'family', count: 2 },
      { tag: 'food', count: 2 },
      { tag: 'architecture', count: 1 },
      { tag: 'garden', count: 1 },
    ]);
  });

  it('filters suggestions by excluding current tags and ranking prefix matches before contains matches', () => {
    const suggestions = [
      { tag: 'street-food', count: 4 },
      { tag: 'food', count: 2 },
      { tag: 'seafood', count: 8 },
      { tag: 'family', count: 5 },
    ];

    expect(filterTagSuggestions(suggestions, ['food'], 'fo')).toEqual([
      { tag: 'street-food', count: 4 },
      { tag: 'seafood', count: 8 },
    ]);
  });

  it('returns top useful suggestions before typing', () => {
    const suggestions = [
      { tag: 'family', count: 5 },
      { tag: 'garden', count: 3 },
      { tag: 'food', count: 4 },
      { tag: 'museum', count: 2 },
      { tag: 'architecture', count: 1 },
      { tag: 'walk', count: 1 },
      { tag: 'market', count: 1 },
    ];

    expect(filterTagSuggestions(suggestions, ['garden'], '')).toEqual([
      { tag: 'family', count: 5 },
      { tag: 'food', count: 4 },
      { tag: 'museum', count: 2 },
      { tag: 'architecture', count: 1 },
      { tag: 'market', count: 1 },
      { tag: 'walk', count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/components/tagEditorModel.test.ts
```

Expected: FAIL because `src/components/tagEditorModel.ts` does not exist.

- [ ] **Step 3: Implement minimal model helpers**

Create `src/components/tagEditorModel.ts`:

```ts
export type TagSuggestion = {
  tag: string;
  count: number;
};

const maxSuggestions = 6;

export const tagKey = (tag: string) => tag.toLocaleLowerCase();

export const splitTagInput = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function addUniqueTags(currentTags: string[], newTags: string[]) {
  const existingTags = new Set(currentTags.map(tagKey));
  const additions = newTags.filter((tag) => {
    const key = tagKey(tag);
    if (existingTags.has(key)) return false;

    existingTags.add(key);
    return true;
  });

  return [...currentTags, ...additions];
}

export function listsMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function buildTagSuggestions(tagGroups: string[][]): TagSuggestion[] {
  const counts = new Map<string, TagSuggestion>();

  for (const tags of tagGroups) {
    for (const tag of tags) {
      const normalized = tag.trim();
      if (!normalized) continue;

      const key = tagKey(normalized);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { tag: normalized, count: 1 });
      }
    }
  }

  return [...counts.values()].sort(compareByFrequencyThenName);
}

export function filterTagSuggestions(
  suggestions: TagSuggestion[],
  currentTags: string[],
  query: string,
) {
  const currentKeys = new Set(currentTags.map(tagKey));
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return suggestions
    .filter((suggestion) => !currentKeys.has(tagKey(suggestion.tag)))
    .filter((suggestion) => {
      if (!normalizedQuery) return true;

      return tagKey(suggestion.tag).includes(normalizedQuery);
    })
    .sort((left, right) => compareByQuery(normalizedQuery, left, right))
    .slice(0, maxSuggestions);
}

function compareByQuery(query: string, left: TagSuggestion, right: TagSuggestion) {
  if (!query) return compareByFrequencyThenName(left, right);

  const leftKey = tagKey(left.tag);
  const rightKey = tagKey(right.tag);
  const leftIsPrefix = leftKey.startsWith(query);
  const rightIsPrefix = rightKey.startsWith(query);

  if (leftIsPrefix !== rightIsPrefix) return leftIsPrefix ? -1 : 1;

  return compareByFrequencyThenName(left, right);
}

function compareByFrequencyThenName(left: TagSuggestion, right: TagSuggestion) {
  if (left.count !== right.count) return right.count - left.count;

  return tagKey(left.tag).localeCompare(tagKey(right.tag));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/components/tagEditorModel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit model helpers**

Run:

```bash
git add src/components/tagEditorModel.ts src/components/tagEditorModel.test.ts
git commit -m "Add tag editor model helpers"
```

---

### Task 2: Build Shared TagEditor Component

**Files:**
- Create: `src/components/TagEditor.tsx`
- Create: `src/components/TagEditor.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `src/components/TagEditor.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagEditor } from './TagEditor';
import type { TagSuggestion } from './tagEditorModel';

const suggestions: TagSuggestion[] = [
  { tag: 'family', count: 3 },
  { tag: 'food', count: 2 },
  { tag: 'garden', count: 2 },
  { tag: 'architecture', count: 1 },
];

describe('TagEditor', () => {
  it('shows existing tags and no resting text input', () => {
    render(<TagEditor label="Home Tags" tags={['family']} suggestions={suggestions} onChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Home Tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag family' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add tag' })).not.toBeInTheDocument();
  });

  it('shows a compact empty state before adding tags', () => {
    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={vi.fn()} />);

    expect(screen.getByText('No tags yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
  });

  it('opens an upward add popover with useful suggestions before typing', async () => {
    const user = userEvent.setup();

    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('textbox', { name: 'Add tag' })).toHaveFocus();
    const list = screen.getByRole('listbox', { name: 'Tag suggestions' });
    expect(within(list).getByRole('button', { name: 'Add tag suggestion family' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Add tag suggestion food' })).toBeInTheDocument();
  });

  it('adds comma-separated tags and dedupes case-insensitively', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor label="Home Tags" tags={['Food']} suggestions={suggestions} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(screen.getByRole('textbox', { name: 'Add tag' }), 'food, garden{Enter}');

    expect(onChange).toHaveBeenCalledWith(['Food', 'garden']);
  });

  it('filters suggestions by typed query and excludes current tags', async () => {
    const user = userEvent.setup();

    render(<TagEditor label="Home Tags" tags={['food']} suggestions={suggestions} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(screen.getByRole('textbox', { name: 'Add tag' }), 'ar');

    const list = screen.getByRole('listbox', { name: 'Tag suggestions' });
    expect(within(list).getByRole('button', { name: 'Add tag suggestion architecture' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Add tag suggestion garden' })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Add tag suggestion food' })).not.toBeInTheDocument();
  });

  it('adds a clicked suggestion and keeps the popover open', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.click(screen.getByRole('button', { name: 'Add tag suggestion family' }));

    expect(onChange).toHaveBeenCalledWith(['family']);
    expect(screen.getByRole('textbox', { name: 'Add tag' })).toBeInTheDocument();
  });

  it('closes without committing typed text when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(screen.getByRole('textbox', { name: 'Add tag' }), 'draft');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tag' }), { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Add tag' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag' })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Add failing style tests**

In `src/styles.test.ts`, add these tests inside `describe('panel tag editor styles', () => { ... })`:

```ts
  it('uses an overlay popover for tag entry instead of expanding layout', () => {
    expect(styles).toMatch(/\.tag-editor\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(
      /\.tag-add-popover\s*{[^}]*position:\s*absolute;[^}]*bottom:\s*calc\(100% \+ 8px\);/s,
    );
  });

  it('keeps empty and populated tag rows compact', () => {
    expect(styles).toMatch(/\.tag-pill-list\s*{[^}]*min-height:\s*40px;/s);
    expect(styles).toMatch(/\.tag-empty-state\s*{[^}]*color:\s*var\(--text-muted\);/s);
    expect(styles).toMatch(/\.tag-add-button\s*{[^}]*width:\s*32px;[^}]*height:\s*32px;/s);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/components/TagEditor.test.tsx src/styles.test.ts -t "TagEditor|tag editor"
```

Expected: FAIL because `TagEditor.tsx` and the new styles do not exist.

- [ ] **Step 4: Implement the TagEditor component**

Create `src/components/TagEditor.tsx`:

```tsx
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

  function commitInput() {
    const nextTags = addUniqueTags(tags, splitTagInput(tagInput));
    setTagInput('');

    if (!listsMatch(nextTags, tags)) {
      onChange(nextTags);
    }
  }

  function closeWithoutCommitting() {
    skipNextBlurCommitRef.current = true;
    setTagInput('');
    setIsAdding(false);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function addSuggestion(tag: string) {
    const nextTags = addUniqueTags(tags, [tag]);
    setTagInput('');

    if (!listsMatch(nextTags, tags)) {
      onChange(nextTags);
    }
  }

  function removeTag(tagToRemove: string) {
    onChange(tags.filter((tag) => tag !== tagToRemove));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitInput();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeWithoutCommitting();
    }
  }

  function handleInputBlur() {
    if (skipNextBlurCommitRef.current) {
      skipNextBlurCommitRef.current = false;
      return;
    }

    commitInput();
  }

  return (
    <fieldset className="tag-editor" aria-label={label}>
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
            onChange={(event) => setTagInput(event.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
          />
          {visibleSuggestions.length > 0 ? (
            <div className="tag-suggestion-list" role="listbox" aria-label="Tag suggestions">
              {visibleSuggestions.map((suggestion) => (
                <button
                  key={suggestion.tag}
                  type="button"
                  className="tag-suggestion"
                  aria-label={`Add tag suggestion ${suggestion.tag}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addSuggestion(suggestion.tag)}
                >
                  {suggestion.tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
```

- [ ] **Step 5: Implement tag editor styles**

Update the existing tag editor block in `src/styles.css`:

```css
.tag-editor {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 0;
}

.tag-pill-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
  padding: 5px 6px;
  background: var(--surface-control);
}

.tag-empty-state {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-add-button {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
  color: var(--color-text);
  background: var(--surface-action-subtle);
  cursor: pointer;
}

.tag-add-button:hover,
.tag-add-button:focus-visible {
  border-color: var(--border-hover);
  background: var(--surface-control-hover);
}

.tag-add-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 4;
  display: grid;
  width: min(260px, 100%);
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--surface-overlay-profile);
  box-shadow: 0 12px 32px rgb(var(--color-text-rgb) / 0.14);
  -webkit-backdrop-filter: blur(16px) saturate(1.16);
  backdrop-filter: blur(16px) saturate(1.16);
}

.tag-popover-input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
  padding: 8px 9px;
  color: var(--color-text);
  background: var(--surface-control);
  outline: 0;
}

.tag-popover-input:focus-visible {
  border-color: var(--border-selected);
  box-shadow: 0 0 0 3px rgb(var(--color-accent-rgb) / 0.18);
}

.tag-suggestion-list {
  display: grid;
  gap: 4px;
}

.tag-suggestion {
  display: flex;
  min-height: 30px;
  align-items: center;
  border: 0;
  border-radius: var(--radius-control);
  padding: 6px 8px;
  color: var(--color-text);
  background: transparent;
  font-size: 0.78rem;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}

.tag-suggestion:hover,
.tag-suggestion:focus-visible {
  background: var(--surface-action-subtle);
}
```

Remove the old `.tag-editor .tag-pill-input` block because the resting input no longer exists.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm test -- src/components/TagEditor.test.tsx src/components/tagEditorModel.test.ts src/styles.test.ts -t "TagEditor|tag editor|tag editor model"
```

Expected: PASS.

- [ ] **Step 7: Commit shared component**

Run:

```bash
git add src/components/TagEditor.tsx src/components/TagEditor.test.tsx src/components/tagEditorModel.ts src/components/tagEditorModel.test.ts src/styles.css src/styles.test.ts
git commit -m "Add shared tag editor popover"
```

---

### Task 3: Wire DestinationProfile to TagEditor

**Files:**
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`

- [ ] **Step 1: Write failing destination profile tests**

In `src/components/DestinationProfile.test.tsx`, update `defaultMediaProps`:

```ts
const defaultMediaProps = {
  activities: [],
  selectedActivityId: null,
  tagSuggestions: [],
  onSelectActivity: vi.fn(),
  onCreateActivity: vi.fn(),
  searchActivities: vi.fn().mockResolvedValue([]),
  onDeleteActivity: vi.fn(),
  onReorderActivities: vi.fn(),
  mediaItems: [],
  isMediaLoading: false,
  isMediaUploading: false,
  mediaError: null,
  onUploadMedia: vi.fn(),
  onReorderMedia: vi.fn(),
  onOpenMediaPreview: vi.fn(),
};
```

Replace the existing `addTag` helper:

```ts
async function addTag(tag: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  await user.type(screen.getByRole('textbox', { name: 'Add tag' }), `${tag}{Enter}`);
}
```

Add this test near the existing tag tests:

```tsx
  it('shows an empty tag state and opens shared suggestions from the add button', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Valparaiso',
      countryRegion: 'Chile',
      coordinates: { lat: -33.0472, lng: -71.6127 },
    });

    render(
      <DestinationProfile
        {...defaultMediaProps}
        destination={destination}
        tagSuggestions={[
          { tag: 'food', count: 3 },
          { tag: 'street-art', count: 2 },
        ]}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('No tags yet')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add tag' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('textbox', { name: 'Add tag' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Add tag suggestion food' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag suggestion street-art' })).toBeInTheDocument();
  });
```

Update `renders tags as removable pills and deduplicates new tags` to await the helper:

```ts
    await addTag('Street-Art');
    await addTag('port-city');
```

Update `removes the last tag with backspace when the tag input is empty` because the resting input no longer handles backspace:

```ts
  it('removes tags through removable pills', async () => {
    setupAutosaveTimers();
    const destination = {
      ...createDestination({
        name: 'Kyoto',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      }),
      tags: ['temples', 'food'],
    };
    const onUpdate = vi.fn();

    render(<DestinationProfile {...defaultMediaProps} destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag food' }));
    await advanceAutosave();

    expect(screen.getByRole('button', { name: 'Remove tag temples' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag food' })).not.toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith(
      destination.id,
      expect.objectContaining({
        tags: ['temples'],
      }),
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx -t "tag|tags"
```

Expected: FAIL because `DestinationProfile` does not accept `tagSuggestions` or render `TagEditor`.

- [ ] **Step 3: Wire DestinationProfile to TagEditor**

In `src/components/DestinationProfile.tsx`, update imports:

```ts
import { TagEditor } from './TagEditor';
import type { TagSuggestion } from './tagEditorModel';
import { listsMatch } from './tagEditorModel';
```

Remove local `splitTagInput`, `tagKey`, and `addUniqueTags`.

Update `DestinationFormState`:

```ts
type DestinationFormState = {
  sourceKey: string;
  name: string;
  expectedStayDays: string;
  tags: string[];
};
```

Update `DestinationProfileProps`:

```ts
type DestinationProfileProps = {
  destination: Destination;
  activities: Activity[];
  selectedActivityId: string | null;
  stopNumber?: number;
  tagSuggestions: TagSuggestion[];
  mediaItems: MediaItem[];
  mediaRollupItems?: MediaRollupItem[];
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  mediaError: string | null;
  onSelectActivity: (activityId: string) => void;
  onCreateActivity: CreateActivityHandler;
  searchActivities?: (query: string) => Promise<PlaceSearchResult[]>;
  onDeleteActivity: (activityId: string) => Promise<void> | void;
  onReorderActivities: (
    destinationId: string,
    orderedActivityIds: string[],
  ) => Promise<unknown> | unknown;
  onUpdate: (destinationId: string, patch: DestinationPatch) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
  onClose: () => void;
};
```

Update `createFormState`:

```ts
const createFormState = (destination: Destination): DestinationFormState => ({
  sourceKey: destinationSourceKey(destination),
  name: destination.name,
  expectedStayDays: String(destination.timing.expectedStayDays),
  tags: destination.tags,
});
```

Destructure `tagSuggestions` in `DestinationProfileForm`.

Delete `updateTagInput` and `commitTagInput`.

Replace `removeTag` with:

```ts
  function updateTags(tags: string[]) {
    updateForm({ tags });
  }
```

Replace the tag fieldset JSX with:

```tsx
      <TagEditor
        label={tagsLabel}
        tags={form.tags}
        suggestions={tagSuggestions}
        onChange={updateTags}
      />
```

- [ ] **Step 4: Run destination profile tag tests**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx -t "tag|tags"
```

Expected: PASS.

- [ ] **Step 5: Commit destination profile wiring**

Run:

```bash
git add src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx
git commit -m "Use shared tag editor in stop panel"
```

---

### Task 4: Wire ActivityPanel to TagEditor

**Files:**
- Modify: `src/components/ActivityPanel.tsx`
- Modify: `src/components/ActivityPanel.test.tsx`

- [ ] **Step 1: Write failing activity panel tests**

In `src/components/ActivityPanel.test.tsx`, update `createProps` return value:

```ts
    tagSuggestions: [],
```

Replace the existing `addTag` helper:

```ts
async function addTag(tag: string) {
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  await user.type(screen.getByRole('textbox', { name: 'Add tag' }), `${tag}{Enter}`);
}
```

Add `userEvent` to imports:

```ts
import userEvent from '@testing-library/user-event';
```

Add this test near the tag tests:

```tsx
  it('shows shared tag suggestions from an empty activity tag section', async () => {
    const user = userEvent.setup();
    const props = createProps({
      activity: {
        ...createActivity({
          destinationId: 'destination-1',
          title: 'Louvre',
          order: 0,
        }),
        tags: [],
      },
      tagSuggestions: [
        { tag: 'museum', count: 3 },
        { tag: 'food', count: 2 },
      ],
    });

    render(<ActivityPanel {...props} />);

    expect(screen.getByText('No tags yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('button', { name: 'Add tag suggestion museum' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag suggestion food' })).toBeInTheDocument();
  });
```

Update `renders tags as removable pills and deduplicates new tags` to await the helper:

```ts
    await addTag('Museum');
    await addTag('art, morning');
```

Replace the backspace removal test with:

```ts
  it('removes activity tags through removable pills', () => {
    const activity = {
      ...createActivity({
        destinationId: 'destination-1',
        title: 'Louvre',
        order: 0,
      }),
      tags: ['museum', 'morning'],
    };
    const props = createProps({ activity });

    render(<ActivityPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag morning' }));

    expect(screen.getByRole('button', { name: 'Remove tag museum' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag morning' })).not.toBeInTheDocument();
    expect(props.onUpdateActivity).toHaveBeenCalledWith(activity.id, {
      tags: ['museum'],
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/components/ActivityPanel.test.tsx -t "tag|tags"
```

Expected: FAIL because `ActivityPanel` does not accept `tagSuggestions` or render `TagEditor`.

- [ ] **Step 3: Wire ActivityPanel to TagEditor**

In `src/components/ActivityPanel.tsx`, update imports:

```ts
import { TagEditor } from './TagEditor';
import type { TagSuggestion } from './tagEditorModel';
import { listsMatch } from './tagEditorModel';
```

Remove local `splitTagInput`, `tagKey`, and `addUniqueTags`.

Update `ActivityPanelProps`:

```ts
type ActivityPanelProps = {
  activity: Activity;
  stopName: string;
  tagSuggestions: TagSuggestion[];
  mediaItems: MediaItem[];
  mediaError: string | null;
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  onClose: () => void;
  onUpdateActivity: (
    activityId: string,
    patch: Partial<Pick<Activity, 'title' | 'description' | 'notes' | 'tags' | 'location'>>,
  ) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
};
```

Pass `tagSuggestions` from `ActivityPanel` into `ActivityPanelForm` and destructure it there.

Delete `const [tagInput, setTagInput] = useState('');`.

Delete `commitTagInput`.

Replace `removeTag` with:

```ts
  function updateTags(tags: string[]) {
    updateDraft('tags', tags);
    void commitDraft('tags');
  }
```

Replace the tag fieldset JSX with:

```tsx
      <TagEditor
        label={tagsLabel}
        tags={draft.tags}
        suggestions={tagSuggestions}
        onChange={updateTags}
      />
```

- [ ] **Step 4: Run activity panel tag tests**

Run:

```bash
npm test -- src/components/ActivityPanel.test.tsx -t "tag|tags"
```

Expected: PASS.

- [ ] **Step 5: Commit activity panel wiring**

Run:

```bash
git add src/components/ActivityPanel.tsx src/components/ActivityPanel.test.tsx
git commit -m "Use shared tag editor in activity panel"
```

---

### Task 5: Compute Shared Suggestions in App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write failing app-level suggestion test**

In `src/App.test.tsx`, add this test near the existing profile-opening tests:

```tsx
  it('suggests tags used by other stops and activities', async () => {
    const user = userEvent.setup();
    const home = {
      ...createDestination({
        name: 'Home',
        countryRegion: 'United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
      tags: [],
    };
    const brest = {
      ...createDestination({
        name: 'Brest',
        countryRegion: 'France',
        coordinates: { lat: 48.3904, lng: -4.4861 },
      }),
      tags: ['family'],
    };
    const activity = {
      ...createActivity({
        destinationId: home.id,
        title: 'Louvre',
        order: 0,
      }),
      tags: ['museum'],
    };
    repositoryMock.initialDestinations = Promise.resolve([home, brest]);
    repositoryMock.listActivities.mockImplementation(async (destinationId: string) =>
      destinationId === home.id ? [activity] : [],
    );

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Home, United Kingdom' }));
    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('button', { name: 'Add tag suggestion family' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag suggestion museum' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/App.test.tsx -t "tag suggestion"
```

Expected: FAIL because `App.tsx` does not compute or pass shared tag suggestions yet.

- [ ] **Step 3: Compute and pass shared suggestions**

In `src/App.tsx`, add import:

```ts
import { buildTagSuggestions } from './components/tagEditorModel';
```

Add this memo inside `TripWorkspace`, after `selectedDestinationActivities` or near other derived data:

```ts
  const tagSuggestions = useMemo(
    () =>
      buildTagSuggestions([
        ...destinations.map((destination) => destination.tags),
        ...Object.values(activitiesByDestinationId).flatMap((activities) =>
          activities.map((activity) => activity.tags),
        ),
      ]),
    [activitiesByDestinationId, destinations],
  );
```

Pass it into `ActivityPanel`:

```tsx
                tagSuggestions={tagSuggestions}
```

Pass it into `DestinationProfile`:

```tsx
              tagSuggestions={tagSuggestions}
```

- [ ] **Step 4: Run app suggestion test**

Run:

```bash
npm test -- src/App.test.tsx -t "tag suggestion"
```

Expected: PASS.

- [ ] **Step 5: Commit app wiring**

Run:

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "Surface shared tag suggestions"
```

---

### Task 6: Regression Pass and Rendered Verification

**Files:**
- Modify only if tests reveal issues in files from Tasks 1-5.

- [ ] **Step 1: Run focused component and style tests**

Run:

```bash
npm test -- src/components/tagEditorModel.test.ts src/components/TagEditor.test.tsx src/components/DestinationProfile.test.tsx src/components/ActivityPanel.test.tsx src/styles.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run app tests touched by suggestion wiring**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: PASS. If unrelated pre-existing App tests fail, capture the failing test names and inspect `git diff` before changing code.

- [ ] **Step 3: Run whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Verify rendered UI in browser**

Start a persistent dev server:

```bash
npm run dev -- --host 127.0.0.1
```

Open the reported localhost URL. In the stop panel:

1. Open a stop with tags and confirm only pills plus the `+` button are visible.
2. Open a stop with no tags and confirm `No tags yet` plus the `+` button are visible.
3. Click `+` and confirm the popover opens upward without moving the bottom-aligned tag section.
4. Confirm useful suggestions appear immediately when shared tags exist.
5. Type a query and confirm suggestions filter.
6. Add a comma-separated pair and confirm two pills appear.

Repeat the same add flow in the activity panel.

- [ ] **Step 5: Stop the dev server**

Stop the dev server with `Ctrl-C`.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intended files are modified. If unrelated files existed before this work, leave them unstaged and call them out.

- [ ] **Step 7: Commit verification fixes after failures**

If Step 1-4 required fixes, commit only those fixes:

```bash
git add src/components/TagEditor.tsx src/components/tagEditorModel.ts src/components/DestinationProfile.tsx src/components/ActivityPanel.tsx src/App.tsx src/styles.css src/styles.test.ts src/components/*.test.tsx src/App.test.tsx
git commit -m "Polish tag editor suggestions"
```

When Step 1-4 pass without code changes, leave this commit step unchecked and do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: Tasks 1-2 cover splitting, dedupe, suggestions, empty state, popover, focus, and accessibility. Tasks 3-4 cover stop/activity persistence behavior. Task 5 covers shared stop/activity vocabulary. Task 6 covers rendered bottom-aligned behavior.
- Scope check: This is one UI/data-flow feature with no schema changes and no global tag management.
- Dirty tree caution: The implementer must inspect `git status --short` before each commit because this workspace already had unrelated unstaged edits during planning.
