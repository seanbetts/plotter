# Startup Status Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split startup messages with one centered app-owned status panel for loading, empty-trip, and error states.

**Architecture:** Add a small presentational `AppStatusPanel` component, then derive a status model in `App` and `TripWorkspace` from existing workspace and trip-data state. Remove the empty-app placeholder from `MapCanvas` so the app shell is the only owner of loading, empty, and error messaging.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, CSS in `src/styles.css`.

## Global Constraints

- Use `npm run dev` for normal development.
- Use `npm run test:e2e` for Playwright coverage; it owns a disposable Vite server on `127.0.0.1:5174`.
- Keep normal app storage and e2e storage separate.
- E2e runs must use `VITE_TRIP_STORAGE=e2e-local`.
- For UI issues, verify the rendered app in a browser before drawing conclusions from code alone.
- Do not change trip discovery, trip creation, Supabase storage architecture, or schema.
- Do not add an onboarding flow or landing page.
- Keep the normal map, toolbar, and panel layout unchanged after trip data has loaded.
- Loading copy is `Loading world tour` and `Preparing your trip map.`
- Loaded empty-trip copy is `No stops in this trip yet` and `Search for a destination or add a stop from the map.`
- Loading panel uses `role="status"` and `aria-live="polite"`.
- Empty panel uses `role="status"`.
- Error panel uses `role="alert"`.

---

## File Structure

- Create `src/components/AppStatusPanel.tsx`: presentational status panel with spinner, title, message, optional retry button, and accessible roles.
- Create `src/components/AppStatusPanel.test.tsx`: component-level tests for loading, empty, error, spinner, and optional retry.
- Modify `src/App.tsx`: import `AppStatusPanel`, render it during workspace loading/client readiness/bootstrap errors, and render it from `TripWorkspace` for trip-data loading, empty, and trip-data errors.
- Modify `src/App.test.tsx`: update startup and loading tests to use new copy, add empty-trip and active trip-data error coverage, and introduce a helper for waiting until startup loading clears.
- Modify `src/components/MapCanvas.tsx`: remove the `Blank planning map` placeholder.
- Modify `src/components/MapCanvas.test.tsx`: replace the old placeholder assertion with a negative assertion.
- Modify `src/styles.css`: replace `.map-empty-label`/`.app-status` badge styling with centered `.app-status-panel` styles and spinner styles.
- Modify `src/styles.test.ts`: lock centered panel width, spinner animation, and reduced-motion behavior.

---

### Task 1: Add AppStatusPanel Component

**Files:**
- Create: `src/components/AppStatusPanel.tsx`
- Create: `src/components/AppStatusPanel.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type AppStatusPanelStatus = 'loading' | 'empty' | 'error';

  export type AppStatusPanelProps = {
    status: AppStatusPanelStatus;
    title: string;
    message: string;
    onRetry?: () => void;
  };

  export function AppStatusPanel(props: AppStatusPanelProps): JSX.Element;
  ```
- Consumes: no app storage, map, or repository state.

- [ ] **Step 1: Write failing component tests**

Create `src/components/AppStatusPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppStatusPanel } from './AppStatusPanel';

describe('AppStatusPanel', () => {
  it('renders loading as a polite status with a hidden spinner', () => {
    const { container } = render(
      <AppStatusPanel
        status="loading"
        title="Loading world tour"
        message="Preparing your trip map."
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Loading world tour');
    expect(status).toHaveTextContent('Preparing your trip map.');
    expect(container.querySelector('.app-status-panel__spinner')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders loaded empty trip as a status without a spinner', () => {
    const { container } = render(
      <AppStatusPanel
        status="empty"
        title="No stops in this trip yet"
        message="Search for a destination or add a stop from the map."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No stops in this trip yet');
    expect(screen.getByRole('status')).toHaveTextContent('Search for a destination or add a stop from the map.');
    expect(container.querySelector('.app-status-panel__spinner')).not.toBeInTheDocument();
  });

  it('renders errors as alerts with an optional retry action', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <AppStatusPanel
        status="error"
        title="Unable to load trip data"
        message="Network unavailable."
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Unable to load trip data');
    expect(alert).toHaveTextContent('Network unavailable.');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run component test to verify it fails**

Run:

```bash
npm test -- src/components/AppStatusPanel.test.tsx
```

Expected: FAIL because `src/components/AppStatusPanel.tsx` does not exist.

- [ ] **Step 3: Implement the presentational component**

Create `src/components/AppStatusPanel.tsx`:

```tsx
import type { JSX } from 'react';

export type AppStatusPanelStatus = 'loading' | 'empty' | 'error';

export type AppStatusPanelProps = {
  status: AppStatusPanelStatus;
  title: string;
  message: string;
  onRetry?: () => void;
};

export function AppStatusPanel({
  status,
  title,
  message,
  onRetry,
}: AppStatusPanelProps): JSX.Element {
  const role = status === 'error' ? 'alert' : 'status';
  const ariaLive = status === 'loading' ? 'polite' : undefined;

  return (
    <div className={`app-status-panel app-status-panel--${status}`} role={role} aria-live={ariaLive}>
      {status === 'loading' ? <span className="app-status-panel__spinner" aria-hidden="true" /> : null}
      <div className="app-status-panel__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {status === 'error' && onRetry ? (
        <button type="button" className="app-status-panel__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run component test to verify it passes**

Run:

```bash
npm test -- src/components/AppStatusPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/AppStatusPanel.tsx src/components/AppStatusPanel.test.tsx
git commit -m "feat: add app status panel"
```

Expected: commit succeeds.

---

### Task 2: Wire App-Owned Loading, Empty, and Error States

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes from Task 1:
  ```ts
  import { AppStatusPanel } from './components/AppStatusPanel';
  ```
- Produces:
  - Workspace loading/client readiness/bootstrap errors render one centered panel.
  - Trip-data loading, empty, and error states render one centered panel.
  - `reload` from `useTripData` is used as the active trip-data error retry callback.

- [ ] **Step 1: Add failing app tests for the new state model**

In `src/App.test.tsx`, add this helper near the existing test helpers:

```tsx
async function waitForTripReady() {
  await waitFor(() => expect(screen.queryByText('Loading world tour')).not.toBeInTheDocument());
}
```

Then update the storage bootstrap error test so it asserts the centered panel class and no duplicate map placeholder:

```tsx
it('shows a centered storage bootstrap error when the app repository cannot be prepared', async () => {
  mockTripWorkspace({
    repository: null,
    error: {
      title: 'Trip storage unavailable',
      message: 'Unable to create an anonymous Supabase session.',
    },
  });

  render(<App />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveClass('app-status-panel', 'app-status-panel--error');
  expect(alert).toHaveTextContent('Trip storage unavailable');
  expect(alert).toHaveTextContent('Unable to create an anonymous Supabase session.');
  expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
});
```

Replace the existing old-name test or edit it in place so there is only one test for this behavior.

Add this test near the other startup tests:

```tsx
it('shows one centered loading panel while app clients and trip data load', async () => {
  const initialDestinations = createDeferred<Destination[]>();
  const initialRouteLegs = createDeferred<RouteLeg[]>();
  repositoryMock.initialDestinations = initialDestinations.promise;
  repositoryMock.initialRouteLegs = initialRouteLegs.promise;

  render(<App />);

  const status = screen.getByRole('status');
  expect(status).toHaveClass('app-status-panel', 'app-status-panel--loading');
  expect(status).toHaveTextContent('Loading world tour');
  expect(status).toHaveTextContent('Preparing your trip map.');
  expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument();
  expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();

  initialDestinations.resolve([]);
  initialRouteLegs.resolve([]);
  await waitForTripReady();
});
```

Add this test for loaded empty trips:

```tsx
it('shows an empty trip panel with normal add controls after an empty trip loads', async () => {
  repositoryMock.initialDestinations = Promise.resolve([]);
  repositoryMock.initialRouteLegs = Promise.resolve([]);

  render(<App />);

  expect(await screen.findByText('No stops in this trip yet')).toBeInTheDocument();
  const status = screen.getByRole('status');
  expect(status).toHaveClass('app-status-panel', 'app-status-panel--empty');
  expect(status).toHaveTextContent('Search for a destination or add a stop from the map.');
  expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
  expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
});
```

Add this test for active trip-data load errors:

```tsx
it('shows active trip data load errors in the centered status panel and retries with reload', async () => {
  repositoryMock.initialDestinations = Promise.reject(new Error('Trip rows unavailable.'));
  repositoryMock.initialRouteLegs = Promise.resolve([]);

  render(<App />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveClass('app-status-panel', 'app-status-panel--error');
  expect(alert).toHaveTextContent('Unable to load trip data');
  expect(alert).toHaveTextContent('Trip rows unavailable.');
  expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();

  repositoryMock.initialDestinations = Promise.resolve([]);
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('No stops in this trip yet')).toBeInTheDocument();
});
```

Finally, replace existing waits:

```tsx
await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
```

with:

```tsx
await waitForTripReady();
```

Replace the direct loading assertion in `keeps mutation actions unavailable while trip data is loading`:

```tsx
expect(screen.getByText('Loading trip data')).toBeInTheDocument();
```

with:

```tsx
expect(screen.getByRole('status')).toHaveTextContent('Loading world tour');
```

- [ ] **Step 2: Run app tests to verify they fail**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: FAIL because `App.tsx` still renders `Loading trip data`, old `.app-status` badges, no loaded-empty panel, and no active trip-data retry button.

- [ ] **Step 3: Wire `AppStatusPanel` in `App.tsx`**

Add the import near the other component imports:

```tsx
import { AppStatusPanel } from './components/AppStatusPanel';
```

In the early return for missing repository or app clients, replace the current `.app-status` block with:

```tsx
          <AppStatusPanel
            status={error ? 'error' : 'loading'}
            title={error?.title ?? 'Loading world tour'}
            message={error?.message ?? 'Preparing your trip map.'}
          />
```

Inside `TripWorkspace`, add this memoized status model after `selectedDestinationActivities` is defined and before the return:

```tsx
  const appStatusPanel = useMemo(() => {
    if (isInteractionLocked) {
      return {
        status: 'loading' as const,
        title: 'Loading world tour',
        message: 'Preparing your trip map.',
      };
    }

    if (error) {
      return {
        status: 'error' as const,
        title: 'Unable to load trip data',
        message: error,
        onRetry: reload,
      };
    }

    if (destinations.length === 0) {
      return {
        status: 'empty' as const,
        title: 'No stops in this trip yet',
        message: 'Search for a destination or add a stop from the map.',
      };
    }

    return null;
  }, [destinations.length, error, isInteractionLocked, reload]);
```

In the `TripWorkspace` JSX, remove the old blocks:

```tsx
        {isInteractionLocked ? (
          <div className="app-status" role="status">
            Loading trip data
          </div>
        ) : null}
        {error ? (
          <div className="app-status app-status-error" role="alert">
            {error}
          </div>
        ) : null}
```

Replace them with:

```tsx
        {appStatusPanel ? (
          <AppStatusPanel
            status={appStatusPanel.status}
            title={appStatusPanel.title}
            message={appStatusPanel.message}
            onRetry={'onRetry' in appStatusPanel ? appStatusPanel.onRetry : undefined}
          />
        ) : null}
```

Keep existing `!isInteractionLocked` gates around `TopToolbar`, `TripSelector`, overlays, profile panels, and preview modal. This preserves the current behavior where mutation controls are unavailable while loading and errors are blocking.

- [ ] **Step 4: Run app tests to verify they pass**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: centralize startup status states"
```

Expected: commit succeeds.

---

### Task 3: Remove Map-Owned Empty App Message

**Files:**
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/components/MapCanvas.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `TripWorkspace` owns empty-trip UI from Task 2.
- Produces: `MapCanvas` does not render `Blank planning map` for `destinations.length === 0`.

- [ ] **Step 1: Update map test to fail against current behavior**

In `src/components/MapCanvas.test.tsx`, replace the old test:

```tsx
it('renders the empty planning map label with no destinations', () => {
  render(
    <MapCanvas
      destinations={[]}
      routeLegs={[] as RouteLeg[]}
      selectedDestinationId={null}
      onSelectDestination={vi.fn()}
    />,
  );

  expect(screen.getByText('Blank planning map')).toHaveClass('map-empty-label', 'is-prominent');
});
```

with:

```tsx
it('leaves empty-trip messaging to the app shell', () => {
  render(
    <MapCanvas
      destinations={[]}
      routeLegs={[] as RouteLeg[]}
      selectedDestinationId={null}
      onSelectDestination={vi.fn()}
    />,
  );

  expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run map test to verify it fails**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx
```

Expected: FAIL because `MapCanvas` still renders `Blank planning map`.

- [ ] **Step 3: Remove the placeholder from `MapCanvas`**

In `src/components/MapCanvas.tsx`, delete this line from the returned JSX:

```tsx
      {destinations.length === 0 ? <div className="map-empty-label is-prominent">Blank planning map</div> : null}
```

In `src/styles.css`, delete the `.map-empty-label` rule because it is no longer used:

```css
.map-empty-label {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 168px;
  transform: translate(-50%, -50%);
  border: 1px solid rgb(var(--color-text-rgb) / 0.18);
  border-radius: var(--radius-panel);
  padding: 10px 14px;
  color: var(--color-text);
  background: var(--surface-overlay-menu);
  box-shadow: var(--shadow-panel);
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1.2;
  pointer-events: none;
  -webkit-backdrop-filter: blur(12px) saturate(1.18);
  backdrop-filter: blur(12px) saturate(1.18);
}
```

- [ ] **Step 4: Run map and app tests to verify they pass**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/styles.css
git commit -m "refactor: move empty map status to app shell"
```

Expected: commit succeeds.

---

### Task 4: Add Centered Panel Styling and Verification

**Files:**
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`

**Interfaces:**
- Consumes from Task 1:
  - `.app-status-panel`
  - `.app-status-panel--loading`
  - `.app-status-panel--empty`
  - `.app-status-panel--error`
  - `.app-status-panel__spinner`
  - `.app-status-panel__retry`
- Produces: centered responsive status panel with spinner and reduced-motion behavior.

- [ ] **Step 1: Write failing style tests**

In `src/styles.test.ts`, add this describe block after the web image or tag editor style tests:

```ts
describe('app status panel styles', () => {
  it('centers the app-owned startup panel over the map', () => {
    expect(styles).toMatch(/\.app-status-panel\s*{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;/s);
    expect(styles).toMatch(/\.app-status-panel\s*{[^}]*width:\s*min\(420px,\s*calc\(100vw - 32px\)\);/s);
    expect(styles).toMatch(/\.app-status-panel\s*{[^}]*transform:\s*translate\(-50%,\s*-50%\);/s);
    expect(styles).toMatch(/\.app-status-panel\s*{[^}]*border-radius:\s*var\(--radius-panel\);/s);
  });

  it('uses an animated spinner with reduced motion support', () => {
    expect(styles).toMatch(/\.app-status-panel__spinner\s*{[^}]*animation:\s*status-spin 900ms linear infinite;/s);
    expect(styles).toMatch(/@keyframes status-spin\s*{[^}]*to\s*{[^}]*transform:\s*rotate\(360deg\);[^}]*}/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*{[^}]*\.app-status-panel__spinner\s*{[^}]*animation:\s*none;/s);
  });

  it('styles status errors and retry actions with existing tokens', () => {
    expect(styles).toMatch(/\.app-status-panel--error\s*{[^}]*border-color:\s*var\(--border-danger\);/s);
    expect(styles).toMatch(/\.app-status-panel--error \.app-status-panel__copy strong\s*{[^}]*color:\s*var\(--color-danger\);/s);
    expect(styles).toMatch(/\.app-status-panel__retry\s*{[^}]*background:\s*var\(--color-accent\);/s);
  });
});
```

- [ ] **Step 2: Run style tests to verify they fail**

Run:

```bash
npm test -- src/styles.test.ts
```

Expected: FAIL because `.app-status-panel` styles and `status-spin` do not exist yet.

- [ ] **Step 3: Add status panel CSS**

In `src/styles.css`, replace the old `.app-status`, `.app-status strong`, `.app-status span`, `.app-status strong`, and `.app-status-error` rules with:

```css
.app-status-panel {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 13;
  display: grid;
  width: min(420px, calc(100vw - 32px));
  justify-items: center;
  gap: 14px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  padding: 22px 24px;
  color: var(--color-text);
  background: var(--surface-overlay-strong);
  box-shadow: var(--shadow-panel);
  text-align: center;
  -webkit-backdrop-filter: blur(var(--blur-overlay)) saturate(1.25);
  backdrop-filter: blur(var(--blur-overlay)) saturate(1.25);
}

.app-status-panel__spinner {
  width: 34px;
  height: 34px;
  border: 3px solid rgb(var(--color-text-rgb) / 0.16);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: status-spin 900ms linear infinite;
}

.app-status-panel__copy {
  display: grid;
  gap: 6px;
}

.app-status-panel__copy strong,
.app-status-panel__copy span {
  color: inherit;
}

.app-status-panel__copy strong {
  font-size: 1.08rem;
  font-weight: 800;
  line-height: 1.2;
}

.app-status-panel__copy span {
  color: var(--text-secondary);
  font-size: 0.92rem;
  line-height: 1.35;
}

.app-status-panel--error {
  border-color: var(--border-danger);
}

.app-status-panel--error .app-status-panel__copy strong {
  color: var(--color-danger);
}

.app-status-panel__retry {
  min-height: 36px;
  border: 0;
  border-radius: var(--radius-control);
  padding: 0 14px;
  color: white;
  background: var(--color-accent);
  font-weight: 800;
  cursor: pointer;
}

.app-status-panel__retry:hover,
.app-status-panel__retry:focus-visible {
  background: var(--color-accent-hover);
}

.app-status-panel__retry:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

@keyframes status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-status-panel__spinner {
    animation: none;
  }
}
```

Remove the mobile `.app-status` override inside `@media (max-width: 760px)`:

```css
  .app-status {
    top: 112px;
    right: 12px;
    left: 12px;
    max-width: none;
  }
```

No mobile replacement is needed because the centered panel already uses `width: min(420px, calc(100vw - 32px))`.

- [ ] **Step 4: Run style and targeted app tests**

Run:

```bash
npm test -- src/styles.test.ts src/components/AppStatusPanel.test.tsx src/App.test.tsx src/components/MapCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/styles.css src/styles.test.ts
git commit -m "style: center startup status panel"
```

Expected: commit succeeds.

---

### Task 5: Final Verification

**Files:**
- No new files expected.
- Modify only files needed to fix failures found by verification.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified startup status panel behavior and a clean working tree except intentional uncommitted fixes made during this task.

- [ ] **Step 1: Run full unit test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run e2e coverage**

Run:

```bash
npm run test:e2e
```

Expected: PASS. Playwright starts and stops its own disposable Vite server on `127.0.0.1:5174`.

- [ ] **Step 4: Verify rendered empty startup state in a browser**

Start the normal dev server:

```bash
npm run dev
```

Expected: Vite prints a local URL on the default app port.

Open the app in a browser and verify:

- Loading shows one centered `Loading world tour` panel with spinner.
- `Loading trip data` is not visible.
- `Blank planning map` is not visible.
- After an empty trip loads, the centered panel says `No stops in this trip yet`.
- The search toolbar and trip selector are visible after load.
- The panel stays centered at desktop and mobile viewport widths.

Stop the dev server after verification.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1-4 required code changes, run:

```bash
git status --short
git add src/components/AppStatusPanel.tsx src/components/AppStatusPanel.test.tsx src/App.tsx src/App.test.tsx src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/styles.css src/styles.test.ts
git commit -m "fix: verify startup status panel"
```

Expected: commit succeeds.

If Step 1-4 passed without code changes, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: Task 1 covers the presentational component and accessibility roles. Task 2 covers loading, empty, error, retry, and mutation-control gates. Task 3 removes `MapCanvas` ownership of `Blank planning map`. Task 4 covers centered visual styling, spinner, and reduced motion. Task 5 covers full verification and rendered browser behavior.
- Scope check: The plan does not change storage architecture, schema, onboarding, or normal loaded-trip layout.
- Type consistency: `AppStatusPanelStatus` is `loading | empty | error` in Task 1 and those exact values are used in Task 2 and Task 4.
