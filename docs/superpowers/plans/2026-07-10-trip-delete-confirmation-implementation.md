# Trip Delete Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trip deletion use the same compact, keyboard-operable row as the trip picker's create and rename modes.

**Architecture:** Keep the interaction inside `TripSelector`: render delete as a form containing a focused read-only trip-name input plus the existing icon-button pattern. Reuse current dialog tokens and add only a danger-color modifier for the Trash action; the existing delete callback and error flow remain unchanged.

**Tech Stack:** React 19, TypeScript, Lucide React, Vitest, Testing Library, CSS

## Global Constraints

- Reuse the existing picker dialog, entry-row, icon-button, spacing, radius, hover, and focus styles.
- Use an X icon to cancel and a Trash icon to confirm.
- Keep `Delete <trip name>` as the confirmation button's accessible name.
- Escape and outside-click cancel; Enter from the focused read-only trip field confirms.
- Keep the dialog open and retain the existing action error when deletion fails.
- Add no new modal, general-purpose button abstraction, dependency, or async-state behavior.

---

### Task 1: Compact Delete Mode

**Files:**
- Modify: `src/components/TripSelector.test.tsx`
- Modify: `src/components/TripSelector.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: existing `TripSelectorProps.onDeleteTrip(tripId: string): Promise<boolean | void> | boolean | void`, `targetTrip: TripSummary | null`, and the `trip-selector__dialog-entry` / `trip-selector__dialog-icon-button` styles.
- Produces: delete-mode markup with a read-only `Trip to delete` input, `Cancel` icon button, `Delete <trip name>` submit icon button, and `trip-selector__dialog-icon-button--danger` styling.

- [ ] **Step 1: Write failing component tests for the compact delete row**

Replace the current `requires delete confirmation that names the trip` test and add focused tests with the following assertions:

```tsx
it('renders delete as the same compact icon-button row as the other modes', async () => {
  renderSelector();

  await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));

  const dialog = screen.getByRole('dialog', { name: 'Delete trip' });
  const tripField = screen.getByLabelText('Trip to delete');
  const cancelButton = screen.getByRole('button', { name: 'Cancel' });
  const deleteButton = screen.getByRole('button', { name: 'Delete Japan winter' });

  expect(dialog.querySelector('.trip-selector__dialog-entry')).toContainElement(tripField);
  expect(tripField).toHaveValue('Japan winter');
  expect(tripField).toHaveAttribute('readonly');
  expect(tripField).toHaveFocus();
  expect(cancelButton).toHaveTextContent('');
  expect(deleteButton).toHaveTextContent('');
  expect(deleteButton).toHaveClass('trip-selector__dialog-icon-button--danger');
});

it('cancels delete from the compact icon button', async () => {
  const props = renderSelector();

  await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(props.onDeleteTrip).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Delete trip' })).not.toBeInTheDocument();
});

it('confirms delete with Enter from the focused trip field', async () => {
  const props = renderSelector();

  await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
  await userEvent.keyboard('{Enter}');

  expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-two');
});

it('confirms delete from the compact Trash button', async () => {
  const props = renderSelector();

  await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete Japan winter' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete Japan winter' }));

  expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-two');
});
```

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

```bash
npm test -- src/components/TripSelector.test.tsx
```

Expected: FAIL because delete mode has no `Trip to delete` field, compact icon-button classes, or Enter submission path.

- [ ] **Step 3: Render delete mode through the shared form and entry-row structure**

In `src/components/TripSelector.tsx`, allow the existing field ref to focus for every non-null dialog mode:

```tsx
useEffect(() => {
  if (!dialogMode) return;

  nameInputRef.current?.focus();
}, [dialogMode]);
```

Replace the delete dialog contents with the shared structure:

```tsx
{dialogMode === 'delete' && targetTrip ? (
  <section className="trip-selector__dialog" role="dialog" aria-modal="true" aria-label="Delete trip">
    <form
      className="trip-selector__dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        void confirmDelete();
      }}
    >
      <label htmlFor="trip-selector-delete-name">Delete trip?</label>
      <div className="trip-selector__dialog-entry">
        <input
          id="trip-selector-delete-name"
          ref={nameInputRef}
          aria-label="Trip to delete"
          value={targetTrip.name}
          readOnly
        />
        <button
          type="button"
          className="trip-selector__dialog-icon-button"
          aria-label="Cancel"
          onClick={closeDialog}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <button
          type="submit"
          className="trip-selector__dialog-icon-button trip-selector__dialog-icon-button--danger"
          aria-label={`Delete ${targetTrip.name}`}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  </section>
) : null}
```

Keep `confirmDelete`, the current `false` result handling, Escape handling, outside-click handling, and error rendering unchanged.

- [ ] **Step 4: Remove obsolete stacked-action selectors and add the danger modifier**

In `src/styles.css`, make the list rule stand alone because delete mode no longer uses `trip-selector__dialog-actions`:

```css
.trip-selector__list {
  display: grid;
  gap: 4px;
}

.trip-selector__list button {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  color: var(--color-text);
  background: transparent;
  text-align: left;
}
```

Add the destructive color after the base icon-button rule:

```css
.trip-selector__dialog-icon-button--danger {
  color: var(--color-danger);
}
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
npm test -- src/components/TripSelector.test.tsx
```

Expected: all `TripSelector` tests PASS, including compact layout, X cancellation, Trash confirmation, Enter confirmation, Escape/outside cancellation, and failure retention.

- [ ] **Step 6: Run static and full component verification**

Run:

```bash
npm run lint
npm test
```

Expected: both commands exit 0 with no new errors.

- [ ] **Step 7: Verify the rendered picker at desktop width**

Run `npm run dev`, open the normal app, and inspect create, rename, and delete modes in the browser. Confirm:

- Delete uses the same dialog width, label spacing, input height, three-column alignment, and icon-button dimensions as create/rename.
- The trip name remains readable and clipped safely when long.
- X and Trash hover/focus treatments match the existing icon buttons; Trash remains danger-colored.
- Enter from the focused read-only field opens the real delete callback path, but do not complete a destructive live-data check; use the component test for confirmation behavior.
- Escape and outside click close the dialog without deleting.
- Browser console contains no new errors.

- [ ] **Step 8: Commit the scoped implementation**

```bash
git add src/components/TripSelector.test.tsx src/components/TripSelector.tsx src/styles.css docs/superpowers/plans/2026-07-10-trip-delete-confirmation-implementation.md
git commit -m "fix: align trip delete confirmation"
```
