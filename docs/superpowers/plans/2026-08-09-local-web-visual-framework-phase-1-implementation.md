# Plotter Local-Web Visual Framework Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Plotter with the shared local-web edge-to-edge shell, universal navigation, colour-mode system, typography, tokens, and map-stage geometry while preserving every existing Plotter control, workflow, map semantic, and storage path.

**Architecture:** Keep the generated platform contract authoritative and add one thin app-owned `PlotterAppShell` around all application states. Load the public package stylesheet and Vite integration, translate Plotter's generic visual aliases onto public `--lwp-*` tokens, and retain an explicit map/domain colour namespace. Make the existing workspace consume the shell's remaining grid track and calculate pointer overlays from map-stage dimensions; no shared control primitives migrate in this phase.

**Tech Stack:** React 19, TypeScript 6, Vite 8, `@local-web/ui` 0.5.2, MapLibre GL 5, Vitest, Testing Library, Playwright, Dexie e2e storage, Supabase production storage.

## Global Constraints

- Use the generated contract already committed in `2f0906c`: platform contract 1, template 1, `@local-web/ui` 0.5.2, digest `47101a066ece3447c14956d959df3986df7c647d9bccaf0eb2023a99856bdcf0`, and capability `supabase`.
- Plotter identity remains `id: 'plotter'`, `name: 'Plotter'`, icon `route`, and canonical accent `#D9467A`.
- `AppShell` must use `contentMode="edge-to-edge"` with no `navigation` or `actions` props; the platform shell owns the only `main` landmark.
- Do not copy platform templates, fallback CSS, theme controls, bootstrap scripts, or provenance into app source. Future platform refreshes use `local-web app update`, never manual edits to platform-managed files.
- Do not add a content container, maximum-width wrapper, bordered map card, duplicate Plotter heading, platform side rail, or app-local universal navigation.
- Preserve all current controls, labels, action ordering, panels, z-index hierarchy, focus flows, and workflow sequencing.
- Do not migrate buttons, inputs, selects, dialogs, menus, notices, feedback states, or icons to shared primitives in Phase 1.
- Keep MapTiler styling, route colours and semantics, map export, stop/activity labels, shipping legs, border crossings, selected-stop presentation, and native MapLibre paint app-owned and stable across colour modes.
- Do not modify Supabase schemas, repositories, realtime subscriptions, credentials, storage selection, Dexie data, migrations, routing providers, request construction, trip CLI behavior, or domain mutation paths.
- E2E tests must run with the existing `VITE_TRIP_STORAGE=e2e-local` Playwright server and must not touch personal Supabase data.
- Do not modify or stage `.superpowers/sdd/task-1-report.md`, `task-4-report.md`, `task-7-report.md`, or `task-8-report.md`.
- Execute on an isolated `codex/` topic worktree. The repository's managed post-commit hook deploys only commits made on `main`; do not invoke registration or deployment commands during this plan.
- Treat any inability of the public edge-to-edge shell to supply the required geometry as a platform capability gap. Stop and report it instead of overriding shared shell internals or adding a private shell substitute.
- Required rendered viewports are desktop, 390 px wide, and 320 px wide in light and dark modes.
- Do not weaken lint rules, test assertions, the `check` script, or the platform verification matrix.

---

## File Structure

**Create:**

- `src/config/appIdentity.ts` — typed, app-owned identity consumed by the shell and checked against `local-web.json`.
- `src/components/PlotterAppShell.tsx` — the only adapter around public `AppShell`.
- `src/components/PlotterAppShell.test.tsx` — shell identity, navigation, theme, edge-to-edge, and landmark tests.
- `src/map/overlayGeometry.ts` — pure map-relative overlay clamping and available-height functions.
- `src/map/overlayGeometry.test.ts` — boundary coverage independent of the DOM.
- `tests/platform-shell.spec.ts` — live fallback theme, colour persistence, full-bleed sizing, responsive layout, and overflow acceptance.

**Modify:**

- `src/main.tsx` — import the public package stylesheet before Plotter styles load.
- `vite.config.ts` — install `localWebApp()` with the normalized public base path.
- `src/App.tsx` — wrap startup and ready states once, remove nested `main`, size the map workspace, and clamp the confirmation to the map stage.
- `src/App.test.tsx` — verify shell presence in startup/ready states and map-relative confirmation geometry.
- `src/styles.css` — map generic aliases to public tokens, preserve map/domain colours, and fill the shell content track.
- `src/styles.test.ts` — enforce token use, domain-colour allowlisting, typography, motion, and non-viewport workspace sizing.
- `src/map/mapPresentation.ts` and `src/map/mapPresentation.test.ts` — read stable map-only colour tokens rather than interface aliases.
- `src/components/MapCanvas.tsx` and `src/components/MapCanvas.test.tsx` — use shared overlay geometry and resize MapLibre when its container changes.
- `src/config/appIdentity.test.ts` — prove app identity remains aligned with the generated manifest.
- `src/hooks/useTripData.ts` and `src/hooks/useTripData.test.tsx` — clear the existing lint baseline without changing repository-generation behavior.
- `tests/plotter.spec.ts` — make the existing IndexedDB persistence poll retry absence instead of throwing early.
- `docs/superpowers/specs/2026-08-09-local-web-visual-framework-phase-1-design.md` — record implementation completion only after the entire matrix is green.

---

### Task 1: Restore the Aggregate Lint Baseline Without Changing Trip Behavior

**Files:**
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`

**Interfaces:**
- Preserves: `useTripData(repository, options)` and its complete return type.
- Preserves: repository-generation invalidation, stale-result rejection, loading state, pending topology state, and mutation errors.
- Produces: a clean ESLint result for both recorded baseline errors.

- [ ] **Step 1: Reproduce the two lint failures and establish behavior coverage**

Run:

```bash
npm run lint
npm test -- src/hooks/useTripData.test.tsx
```

Expected: lint reports `prefer-const` at `useTripData.test.tsx:77` and `react-hooks/set-state-in-effect` at `useTripData.ts:358`; the hook tests pass, including the repository-switch and stale-generation cases.

- [ ] **Step 2: Make the fixture binding immutable**

Change only the binding; the array remains intentionally mutable:

```ts
const storedDestinations = [origin, target];
let storedRoutes = [readyRoute];
```

- [ ] **Step 3: Move repository-reset state publication out of the layout-effect body**

Keep ref invalidation synchronous, then publish the same React state in a guarded microtask so an obsolete generation cannot reset the current one:

```ts
useLayoutEffect(() => {
  let isCancelled = false;

  activeRepositoryTokenRef.current = repositoryToken;
  reloadSequenceRef.current += 1;
  pendingTopologyMutationsRef.current = [];
  deferredReloadRef.current = false;
  hasCompletedInitialLoadRef.current = false;

  queueMicrotask(() => {
    if (isCancelled || activeRepositoryTokenRef.current !== repositoryToken) return;

    setPendingTopologyMutationCount(0);
    setIsLoading(true);
    setMutationError(null);
  });

  return () => {
    isCancelled = true;
    if (activeRepositoryTokenRef.current === repositoryToken) {
      activeRepositoryTokenRef.current = null;
      reloadSequenceRef.current += 1;
    }
  };
}, [repositoryToken]);
```

Do not change `startReload`, queue ownership, repository tokens, mutation recipes, or action implementations.

- [ ] **Step 4: Verify lint and repository-generation regressions**

Run:

```bash
npm run lint
npm test -- src/hooks/useTripData.test.tsx
```

Expected: both commands pass. The repository-switch tests still prove old reloads, recalculations, destination writes, and activity writes cannot publish into a new repository generation.

- [ ] **Step 5: Commit only the lint-baseline files**

```bash
git add src/hooks/useTripData.ts src/hooks/useTripData.test.tsx
git commit -m "fix: preserve trip generation resets without effect state writes"
```

---

### Task 2: Stabilize the Existing Nordkapp Persistence Poll

**Files:**
- Modify: `tests/plotter.spec.ts`

**Interfaces:**
- Preserves: the Nordkapp insertion workflow and all assertions about both adjacent persisted route legs.
- Produces: `readInsertedStopLegs(): Promise<InsertedStopLeg[]>`, where `InsertedStopLeg` retains origin/target ids and names, movement, calculation, status, and provider, and returns an empty list while the IndexedDB destination write is still pending.

- [ ] **Step 1: Reproduce the timing-sensitive test repeatedly**

Run:

```bash
npx playwright test tests/plotter.spec.ts --grep "preserves Nordkapp routing intent" --repeat-each=10 --workers=1
```

Expected: record whether the current helper intermittently throws `Expected persisted Aalborg stop.` before `expect.poll` can retry. Continue with the fix even if all ten repetitions happen to pass, because the failure was captured during design verification.

- [ ] **Step 2: Make absence retryable without weakening final assertions**

Replace the early exception inside `readInsertedStopLegs`:

```ts
const aalborg = destinations.find((destination) => destination.name === 'Aalborg');
if (!aalborg?.entityId) return [];
```

Keep the existing two-leg filter, `toHaveLength(2)`, origin/target names, movement, calculation, status, and provider assertions unchanged.

- [ ] **Step 3: Verify the targeted test and complete suite**

Run:

```bash
npx playwright test tests/plotter.spec.ts --grep "preserves Nordkapp routing intent" --repeat-each=10 --workers=1
npm run test:e2e
```

Expected: 10/10 targeted repetitions pass and the complete ten-test suite passes. MapTiler glyph warnings are non-fatal; any assertion failure is not.

- [ ] **Step 4: Commit only the polling change**

```bash
git add tests/plotter.spec.ts
git commit -m "test: wait for persisted map stop legs"
```

---

### Task 3: Add the Public Platform Bootstrap and One Edge-to-Edge Shell

**Files:**
- Create: `src/config/appIdentity.ts`
- Create: `src/components/PlotterAppShell.tsx`
- Create: `src/components/PlotterAppShell.test.tsx`
- Modify: `src/config/appIdentity.test.ts`
- Modify: `src/main.tsx`
- Modify: `vite.config.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: `plotterAppIdentity: AppIdentity`.
- Produces: `PlotterAppShell({ children }: PropsWithChildren): JSX.Element`.
- Consumes: `AppShell`, `AppIdentity`, and `localWebApp` only from public `@local-web/ui` exports.
- Preserves: every `TripWorkspace` prop and all application state/data ownership.

- [ ] **Step 1: Write failing identity and shell tests**

Create `src/config/appIdentity.ts` only after first updating `src/config/appIdentity.test.ts` to import `plotterAppIdentity` and assert both the typed constant and generated manifest agree:

```ts
expect(plotterAppIdentity).toEqual({
  id: manifest.id,
  name: manifest.title,
  icon: manifest.home.icon,
  accent: manifest.home.accent,
});
expect(plotterAppIdentity.accent).toBe('#D9467A');
```

Create `src/components/PlotterAppShell.test.tsx` with these assertions:

```tsx
render(
  <PlotterAppShell>
    <section aria-label="Plotter test content" />
  </PlotterAppShell>,
);

const locationNavigation = screen.getByRole('navigation', { name: 'Location' });
expect(within(locationNavigation).getByText('Local')).toBeInTheDocument();
expect(within(locationNavigation).getByRole('link', { name: 'System Index' })).toHaveAttribute('href', '/');
expect(within(locationNavigation).getByText('Plotter')).toHaveAttribute('aria-current', 'page');
expect(screen.getByRole('group', { name: 'Colour mode' })).toBeInTheDocument();
expect(screen.getAllByRole('main')).toHaveLength(1);
expect(screen.getByRole('main')).toHaveClass('lwp-platform-shell__main--edge-to-edge');
expect(screen.getByRole('region', { name: 'Plotter test content' })).toBeInTheDocument();
```

In `src/App.test.tsx`, add one startup-state case and one ready-state case that render `<App />` and assert exactly one `main`, one `Location` navigation, and one `Plotter map workspace` region.

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npm test -- src/config/appIdentity.test.ts src/components/PlotterAppShell.test.tsx src/App.test.tsx
```

Expected: FAIL because the identity and shell modules do not exist and `App` still owns a `main` element.

- [ ] **Step 3: Implement the typed identity and thin shell**

Create `src/config/appIdentity.ts`:

```ts
import type { AppIdentity } from '@local-web/ui';

export const plotterAppIdentity = {
  id: 'plotter',
  name: 'Plotter',
  icon: 'route',
  accent: '#D9467A',
} satisfies AppIdentity;
```

Create `src/components/PlotterAppShell.tsx`:

```tsx
import { AppShell } from '@local-web/ui';
import type { PropsWithChildren } from 'react';
import { plotterAppIdentity } from '../config/appIdentity';

export function PlotterAppShell({ children }: PropsWithChildren) {
  return (
    <AppShell app={plotterAppIdentity} contentMode="edge-to-edge">
      {children}
    </AppShell>
  );
}
```

Do not pass legacy `navigation` or `actions`; their presence selects the deprecated shell.

- [ ] **Step 4: Install the public stylesheet and Vite integration**

Make the public package stylesheet the first application style import in `src/main.tsx`:

```ts
import '@local-web/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
```

Update `vite.config.ts` to normalize the base once and let the public plugin own both Vite base configuration and fallback-theme/bootstrap behavior:

```ts
import { localWebApp } from '@local-web/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { plotterAppIdentity } from './src/config/appIdentity';
import { normalizePublicBasePath } from './src/config/publicBasePath';

const basePath = normalizePublicBasePath(process.env.VITE_PUBLIC_BASE_PATH);

export default defineConfig({
  plugins: [
    localWebApp({ appId: plotterAppIdentity.id, basePath }),
    react(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

Do not add app-local fallback-theme middleware or bootstrap markup.

- [ ] **Step 5: Wrap every App state once and remove nested landmarks**

Import `PlotterAppShell` into `src/App.tsx`. Replace each `<main className="app-shell">` with `<div className="app-shell">`, and structure the top-level return so both startup and ready content are children of one shell:

```tsx
const workspace = !repository || !linkPreviewClient || !webImageSearchClient ? (
  <div className="app-shell">
    <style>{blockingStatusMapStyles}</style>
    <section className="map-stage map-stage--blocking-status" aria-label="Plotter map workspace">
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={() => undefined}
      />
      <AppStatusPanel
        status={error ? 'error' : 'loading'}
        title={error?.title ?? 'Loading Plotter'}
        message={error?.message ?? 'Preparing your trip map.'}
      />
    </section>
  </div>
) : (
  <TripWorkspace
    key={activeTrip?.id}
    repository={repository}
    linkPreviewClient={linkPreviewClient}
    webImageSearchClient={webImageSearchClient}
    trips={trips}
    activeTrip={activeTrip}
    tripActionError={actionError}
    onSelectTrip={selectTrip}
    onCreateTrip={createTrip}
    onUpdateTrip={updateTrip}
    onDeleteTrip={deleteTrip}
    isTripWorkspaceLoading={isLoading}
    realtime={realtime}
  />
);

return <PlotterAppShell>{workspace}</PlotterAppShell>;
```

Change the `TripWorkspace` root to `<div className="app-shell">`. Keep the labelled map stage as a `section` region and leave all child ordering unchanged.

- [ ] **Step 6: Verify focused tests, bootstrap injection, and base-path build**

Run:

```bash
npm test -- src/config/appIdentity.test.ts src/components/PlotterAppShell.test.tsx src/App.test.tsx src/config/publicBasePath.test.ts
npm run build
VITE_PUBLIC_BASE_PATH=/plotter/ npm run build
rg -n "local-web:colour-mode|/_local-web/platform/theme.css|/plotter/assets/" dist/index.html
```

Expected: tests and both builds pass; built HTML contains the package bootstrap before application assets, retains the reserved live-theme URL, and uses `/plotter/assets/` URLs for the hosted build.

- [ ] **Step 7: Commit the platform bootstrap and shell**

```bash
git add src/config/appIdentity.ts src/config/appIdentity.test.ts src/components/PlotterAppShell.tsx src/components/PlotterAppShell.test.tsx src/main.tsx vite.config.ts src/App.tsx src/App.test.tsx
git commit -m "feat: add Plotter edge-to-edge platform shell"
```

---

### Task 4: Map Plotter's Generic Visual Language onto Shared Tokens

**Files:**
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`
- Modify: `src/map/mapPresentation.ts`
- Modify: `src/map/mapPresentation.test.ts`

**Interfaces:**
- Produces: Plotter compatibility aliases sourced from public `--lwp-*` tokens.
- Produces: explicit `--map-colour-*` domain tokens that do not change with interface colour mode.
- Preserves: `readMapLayerColors(): MapLayerColors` and all returned semantic fields.

- [ ] **Step 1: Write failing token-contract tests**

Add a `platform token contract` block to `src/styles.test.ts` that reads `src/styles.css` and asserts:

```ts
expect(styles).toContain('--color-bg: var(--lwp-colour-canvas);');
expect(styles).toContain('--color-text: var(--lwp-colour-text);');
expect(styles).toContain('--color-accent: var(--lwp-app-accent);');
expect(styles).toContain('--color-danger: var(--lwp-colour-danger);');
expect(styles).toContain('--radius-control: var(--lwp-radius-control);');
expect(styles).toContain('--radius-panel: var(--lwp-radius-surface);');
expect(styles).toContain('--focus-ring: var(--lwp-focus-width) solid var(--lwp-colour-focus);');
expect(styles).toContain('font-family: var(--lwp-font-sans);');
expect(styles).toContain('font-family: var(--lwp-font-mono);');
expect(styles).not.toMatch(/var\(--color-(?:text|text-inverse|accent|danger)-rgb\)/);
```

Add an explicit domain allowlist assertion for these stable values:

```ts
expect(styles).toMatch(/--map-colour-background:\s*#14201a;/i);
expect(styles).toMatch(/--map-colour-accent:\s*#d9467a;/i);
expect(styles).toMatch(/--map-colour-shipping:\s*#7ec8e3;/i);
expect(styles).toMatch(/--map-colour-border-crossing:\s*#6fcf97;/i);
expect(styles).toMatch(/--map-colour-selected:\s*#f7f0d0;/i);
```

Extend `src/map/mapPresentation.test.ts` by mocking `getComputedStyle` and asserting interface tokens are ignored while `--map-colour-*` values populate `MapLayerColors`.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- src/styles.test.ts src/map/mapPresentation.test.ts
```

Expected: FAIL because generic colours, typography, radii, focus, shadows, and motion are still locally fixed and map presentation reads interface aliases.

- [ ] **Step 3: Define shared compatibility aliases and stable map tokens**

Replace the opening token block in `src/styles.css` with two ownership layers:

```css
:root {
  --map-colour-background: #14201a;
  --map-colour-accent: #d9467a;
  --map-colour-accent-rgb: 217 70 122;
  --map-colour-selected: #f7f0d0;
  --map-colour-shipping: #7ec8e3;
  --map-colour-border-crossing: #6fcf97;
  --map-colour-text: #17201c;
  --map-colour-text-rgb: 23 32 28;
  --map-colour-text-inverse: #111814;
  --map-colour-text-inverse-rgb: 17 24 20;
}

.lwp-app-shell[data-lwp-app-id='plotter'] .lwp-platform-shell {
  --color-bg: var(--lwp-colour-canvas);
  --color-text: var(--lwp-colour-text);
  --color-text-inverse: var(--lwp-colour-accent-contrast);
  --color-accent: var(--lwp-app-accent);
  --color-accent-hover: color-mix(in srgb, var(--lwp-app-accent) 84%, var(--lwp-colour-text));
  --color-danger: var(--lwp-colour-danger);
  --color-warning: var(--lwp-colour-warning);
  --color-success: var(--lwp-colour-success);
  --color-map-bg: var(--map-colour-background);
  --color-map-selected: var(--map-colour-selected);
  --color-route-shipping: var(--map-colour-shipping);
  --color-route-border-crossing: var(--map-colour-border-crossing);

  --radius-control: var(--lwp-radius-control);
  --radius-panel: var(--lwp-radius-surface);
  --radius-pill: 999px;
  --focus-ring: var(--lwp-focus-width) solid var(--lwp-colour-focus);
  --motion-fast: var(--lwp-motion-duration-fast);
  --motion-easing: var(--lwp-motion-easing-standard);
  --shadow-panel: var(--lwp-shadow);
  --shadow-profile: var(--lwp-shadow);
}
```

The aliases belong on the nested platform shell because that is where `AppShell` publishes the derived light/dark `--lwp-app-accent`; do not place accent-dependent aliases on the outer wrapper.

Retain Plotter's blur strengths as app-owned composition values. Add the complete generic surface, border, and text compatibility set to the same selector:

```css
--surface-control: color-mix(in srgb, var(--lwp-colour-surface) 56%, transparent);
--surface-control-hover: color-mix(in srgb, var(--lwp-colour-surface) 72%, transparent);
--surface-control-focus: color-mix(in srgb, var(--lwp-colour-surface) 82%, transparent);
--surface-overlay: color-mix(in srgb, var(--lwp-colour-surface) 68%, transparent);
--surface-overlay-strong: color-mix(in srgb, var(--lwp-colour-surface) 82%, transparent);
--surface-overlay-panel: color-mix(in srgb, var(--lwp-colour-surface) 72%, transparent);
--surface-overlay-profile: color-mix(in srgb, var(--lwp-colour-surface) 84%, transparent);
--surface-overlay-menu: color-mix(in srgb, var(--lwp-colour-surface) 86%, transparent);
--surface-action-subtle: color-mix(in srgb, var(--color-text) 7%, transparent);
--surface-row: color-mix(in srgb, var(--lwp-colour-surface) 46%, transparent);
--surface-badge: color-mix(in srgb, var(--lwp-colour-surface) 62%, transparent);
--surface-selected: color-mix(in srgb, var(--color-accent) 12%, transparent);
--surface-drop-target: color-mix(in srgb, var(--color-accent) 8%, transparent);
--surface-drag-preview: color-mix(in srgb, var(--lwp-colour-surface) 90%, transparent);
--surface-danger-subtle: color-mix(in srgb, var(--color-danger) 10%, transparent);

--border-subtle: color-mix(in srgb, var(--lwp-colour-line) 34%, transparent);
--border-control: color-mix(in srgb, var(--lwp-colour-line) 42%, transparent);
--border-strong: color-mix(in srgb, var(--lwp-colour-line) 55%, transparent);
--border-row: color-mix(in srgb, var(--lwp-colour-line) 30%, transparent);
--border-divider: color-mix(in srgb, var(--lwp-colour-line) 28%, transparent);
--border-hover: color-mix(in srgb, var(--lwp-colour-line) 75%, transparent);
--border-selected: color-mix(in srgb, var(--color-accent) 72%, transparent);
--border-dragging: color-mix(in srgb, var(--color-accent) 42%, transparent);
--border-drop-target: color-mix(in srgb, var(--color-accent) 50%, transparent);
--border-drag-preview: color-mix(in srgb, var(--color-accent) 55%, transparent);
--border-danger: color-mix(in srgb, var(--color-danger) 30%, transparent);

--text-secondary: color-mix(in srgb, var(--color-text) 74%, transparent);
--text-muted: color-mix(in srgb, var(--color-text) 60%, transparent);
--text-faint: color-mix(in srgb, var(--color-text) 50%, transparent);
--text-soft: color-mix(in srgb, var(--color-text) 68%, transparent);
--text-disabled: color-mix(in srgb, var(--color-text) 38%, transparent);
```

Do not introduce separate light/dark selector blocks.

- [ ] **Step 4: Replace generic RGB-channel and fixed typography usage**

Apply these exact semantic conversions throughout `src/styles.css`, retaining each existing percentage:

```text
rgb(var(--color-text-rgb) / A)         -> color-mix(in srgb, var(--color-text) A%, transparent)
rgb(var(--color-text-inverse-rgb) / A) -> color-mix(in srgb, var(--color-text-inverse) A%, transparent)
rgb(var(--color-accent-rgb) / A)       -> color-mix(in srgb, var(--color-accent) A%, transparent)
rgb(var(--color-danger-rgb) / A)       -> color-mix(in srgb, var(--color-danger) A%, transparent)
```

Replace the body font stack with `var(--lwp-font-sans)` and all explicit `ui-monospace` stacks with `var(--lwp-font-mono)`. Replace generic 4/8/12/16/24/32 px composition spacing with `--lwp-space-1/2/3/4/6/8` where the computed value is unchanged. Replace hard-coded generic transition durations/easing with `--motion-fast` and `--motion-easing`; preserve map animation durations and reduced-motion rules.

Add `--map-colour-label-surface`, `--map-colour-label-surface-selected`, and `--map-colour-label-surface-hover` with the current white translucent values. Use those plus `--map-colour-accent` and `--map-colour-selected` in `.map-destination-label` selectors so interface colour changes do not recolour map labels or exported stop pills.

- [ ] **Step 5: Decouple native map paint from interface aliases**

Change `mapColorTokenFallbacks` and `readMapLayerColors()` in `src/map/mapPresentation.ts` to read only this namespace:

```ts
const mapColorTokenFallbacks = {
  '--map-colour-accent': '#d9467a',
  '--map-colour-accent-rgb': '217 70 122',
  '--map-colour-selected': '#f7f0d0',
  '--map-colour-shipping': '#7ec8e3',
  '--map-colour-text': '#17201c',
  '--map-colour-text-rgb': '23 32 28',
  '--map-colour-text-inverse': '#111814',
  '--map-colour-text-inverse-rgb': '17 24 20',
} as const;
```

Keep the returned `MapLayerColors` object shape unchanged. Do not make MapLibre repaint when the shared theme changes.

- [ ] **Step 6: Verify token and existing visual contracts**

```bash
npm test -- src/styles.test.ts src/map/mapPresentation.test.ts src/map/tripMapExport.test.ts
npm run lint
```

Expected: all tests and lint pass. Existing toolbar, panel, itinerary, preview, route-warning, drag/drop, and map-export style assertions remain present and green.

- [ ] **Step 7: Commit only token and map-colour files**

```bash
git add src/styles.css src/styles.test.ts src/map/mapPresentation.ts src/map/mapPresentation.test.ts
git commit -m "style: adopt shared Plotter visual tokens"
```

---

### Task 5: Fill the Shell Track and Make Map Overlays Stage-Relative

**Files:**
- Create: `src/map/overlayGeometry.ts`
- Create: `src/map/overlayGeometry.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/components/MapCanvas.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`

**Interfaces:**
- Produces: `OverlayPoint`, `OverlaySize`, `OverlayViewport`.
- Produces: `clampOverlayPosition(position, size, viewport, padding?): OverlayPoint`.
- Produces: `getAvailableOverlayHeight(position, viewport, padding?): number`.
- Preserves: `MapAddStopRequest.screenPosition` as coordinates relative to the map stage.

- [ ] **Step 1: Write failing pure geometry tests**

Create `src/map/overlayGeometry.test.ts`:

```ts
import { clampOverlayPosition, getAvailableOverlayHeight } from './overlayGeometry';

describe('map overlay geometry', () => {
  it('clamps to the map stage rather than browser height', () => {
    expect(clampOverlayPosition(
      { x: 990, y: 690 },
      { width: 320, height: 260 },
      { width: 1000, height: 700 },
    )).toEqual({ x: 664, y: 424 });
  });

  it('reports space below the clamped stage-relative top edge', () => {
    expect(getAvailableOverlayHeight(
      { x: 664, y: 424 },
      { width: 1000, height: 700 },
    )).toBe(260);
  });

  it('keeps the minimum padding when the overlay exceeds the stage', () => {
    expect(clampOverlayPosition(
      { x: 40, y: 40 },
      { width: 500, height: 500 },
      { width: 320, height: 240 },
    )).toEqual({ x: 16, y: 16 });
  });
});
```

- [ ] **Step 2: Add failing component geometry and resize tests**

In `src/App.test.tsx`, mock the `Plotter map workspace` region at `{ left: 0, top: 80, width: 1000, height: 700 }`, request a stop at `{ x: 990, y: 690 }`, and assert the confirmation uses `left: 664px`, `top: 424px`, and `max-height: 260px`. Do not use `window.innerHeight` in the expectation.

In `src/components/MapCanvas.test.tsx`, add `resize` to `MockMap`, install a controllable `ResizeObserver` mock, invoke its callback after render, and assert `map.resize()` is called. Extend the menu edge test so a 1000 x 700 map clamps independently of a larger `window.innerHeight`.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npm test -- src/map/overlayGeometry.test.ts src/components/MapCanvas.test.tsx src/App.test.tsx
```

Expected: FAIL because the helper does not exist, both components still use browser dimensions, and MapLibre is not explicitly observing its container.

- [ ] **Step 4: Implement the pure map geometry contract**

Create `src/map/overlayGeometry.ts`:

```ts
export type OverlayPoint = { x: number; y: number };
export type OverlaySize = { width: number; height: number };
export type OverlayViewport = { width: number; height: number };

const defaultPadding = 16;

export function clampOverlayPosition(
  position: OverlayPoint,
  size: OverlaySize,
  viewport: OverlayViewport,
  padding = defaultPadding,
): OverlayPoint {
  return {
    x: Math.min(
      Math.max(padding, position.x),
      Math.max(padding, viewport.width - size.width - padding),
    ),
    y: Math.min(
      Math.max(padding, position.y),
      Math.max(padding, viewport.height - size.height - padding),
    ),
  };
}

export function getAvailableOverlayHeight(
  position: OverlayPoint,
  viewport: OverlayViewport,
  padding = defaultPadding,
): number {
  return Math.max(padding, viewport.height - position.y - padding);
}
```

- [ ] **Step 5: Use map-stage dimensions in App and MapCanvas**

In `src/App.tsx`, attach `mapStageRef` to the `Plotter map workspace` section. When `pendingMapStop` exists, read its bounding rectangle and pass `{ width, height }` to the pure helper. Format the numeric available height as pixels only at the JSX style boundary. Remove the window-based helper functions from `App.tsx`.

In `src/components/MapCanvas.tsx`, calculate `addStopMenuPosition` from `mapContainerRef.current.getBoundingClientRect()` and the same pure helper. Remove its duplicate window-based clamping function. Continue emitting map-relative `screenPosition` from MapLibre events, captured context menus, and long presses.

- [ ] **Step 6: Observe the MapLibre container**

After map construction, observe the map container and forward geometry changes to MapLibre:

```ts
useEffect(() => {
  const container = mapContainerRef.current;
  const map = mapRef.current;
  if (!container || !map || typeof ResizeObserver === 'undefined') return undefined;

  const observer = new ResizeObserver(() => map.resize());
  observer.observe(container);
  return () => observer.disconnect();
}, []);
```

Keep MapLibre's existing `resize` event listener so projected destination and activity labels update after `map.resize()`.

- [ ] **Step 7: Replace viewport-minimum workspace sizing with shell-track sizing**

Update only application-shell geometry in `src/styles.css`:

```css
.app-shell {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--color-bg);
}

.map-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.empty-map-state {
  min-height: 100%;
}
```

Remove the `100vh` minimums from `.map-stage` and `.empty-map-state`. Change the map-owned `.map-add-stop-menu` and `.map-stop-confirmation` maximum dimensions from viewport percentages to containing-stage percentages. Do not add a guessed header subtraction or override `.lwp-platform-shell` internals.

Add style tests asserting `.app-shell` and `.map-stage` use `height: 100%` plus `min-height: 0`, and asserting neither selector contains `100vh` or `100dvh`.

- [ ] **Step 8: Verify focused component and style tests**

```bash
npm test -- src/map/overlayGeometry.test.ts src/components/MapCanvas.test.tsx src/App.test.tsx src/styles.test.ts
```

Expected: all tests pass, including context menu, long press, focus, map export, itinerary, panel, and existing stop-addition behavior.

- [ ] **Step 9: Commit the map-stage integration**

```bash
git add src/map/overlayGeometry.ts src/map/overlayGeometry.test.ts src/App.tsx src/App.test.tsx src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/styles.css src/styles.test.ts
git commit -m "fix: size Plotter within the platform map stage"
```

---

### Task 6: Prove Theme, Responsive, Domain, and Platform Acceptance

**Files:**
- Create: `tests/platform-shell.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-09-local-web-visual-framework-phase-1-design.md`

**Interfaces:**
- Produces: browser coverage for the public fallback theme, one universal shell, colour persistence, full-bleed map geometry, required responsive viewports, and existing control hierarchy.
- Preserves: all existing ten browser workflows as independent regression coverage.

- [ ] **Step 1: Add fallback-theme and colour-mode browser coverage**

Create `tests/platform-shell.spec.ts` with a test that:

```ts
test('serves the shared fallback theme and persists colour mode without changing the trip', async ({ page, request }) => {
  const themeResponse = await request.get('/_local-web/platform/theme.css');
  expect(themeResponse.status()).toBe(200);
  expect(await themeResponse.text()).toContain('--lwp-colour-canvas');

  await page.goto('/');
  await expect(page.getByLabel('Search for a destination')).toBeVisible();
  const currentTripName = await page.getByRole('button', { name: /current trip:/i }).textContent();

  await page.getByRole('button', { name: 'Dark colour mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'dark');
  await expect(page.getByRole('button', { name: /current trip:/i })).toHaveText(currentTripName ?? '');

  await page.getByRole('button', { name: 'Light colour mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'light');

  await page.getByRole('button', { name: 'System colour mode' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-lwp-colour-mode');
});
```

Also assert one `main`, one `Location` navigation, one `Colour mode` group, and no second Plotter page heading.

- [ ] **Step 2: Add full-bleed geometry coverage at all required widths**

For `{ width: 1280, height: 800 }`, `{ width: 390, height: 844 }`, and `{ width: 320, height: 568 }`, set the viewport, load the app, wait for the search toolbar, and compare bounding boxes:

```ts
const mainBox = await page.locator('#lwp-main').boundingBox();
const stageBox = await page.getByRole('region', { name: 'Plotter map workspace' }).boundingBox();
expect(mainBox).not.toBeNull();
expect(stageBox).not.toBeNull();
expect(Math.abs(stageBox!.x - mainBox!.x)).toBeLessThanOrEqual(1);
expect(Math.abs(stageBox!.y - mainBox!.y)).toBeLessThanOrEqual(1);
expect(Math.abs(stageBox!.width - mainBox!.width)).toBeLessThanOrEqual(1);
expect(Math.abs(stageBox!.height - mainBox!.height)).toBeLessThanOrEqual(1);
```

At each size assert search, current trip, itinerary, and MapLibre zoom controls remain visible. Evaluate `document.documentElement.scrollWidth/clientWidth` and `scrollHeight/clientHeight`; each overflow delta must be at most one pixel.

- [ ] **Step 3: Run the new acceptance file in both interface modes**

```bash
npx playwright test tests/platform-shell.spec.ts
```

Expected: fallback theme, dark persistence, system reset, shell landmarks, all three viewport geometries, control visibility, and overflow checks pass.

- [ ] **Step 4: Run source and domain regression suites**

```bash
npm run check
npm run test:e2e
npx playwright test tests/plotter.spec.ts --grep "preserves Nordkapp routing intent" --repeat-each=5 --workers=1
```

Expected: lint, all unit tests, TypeScript build, the original ten browser workflows plus the new platform tests, and all five Nordkapp repetitions pass. Do not accept retries configured at the Playwright runner level as evidence.

- [ ] **Step 5: Perform rendered visual review**

Start the isolated app only for inspection:

```bash
npm run dev:e2e
```

Using browser automation, capture and inspect desktop 1280 x 800, mobile 390 x 844, and narrow 320 x 568 in light and dark modes. Confirm:

- the universal header is the only page navigation row;
- the map touches every edge of the content track;
- search/export, trip selector, itinerary, right panels, route alternatives, map controls, and media preview retain their original hierarchy;
- text, focus rings, translucent panels, errors, warnings, and disabled controls are legible over the map;
- no map colours, routes, stop pills, export appearance, or saved data change with interface mode; and
- no page-level scrollbar or clipped control appears.

Stop the inspection server when finished. If the shared shell itself prevents a required result, record the exact viewport and selector as a platform capability gap and stop this plan without adding app-local shell CSS.

- [ ] **Step 6: Run the complete local-web matrix**

```bash
local-web app doctor --repository .
npm run check
npm run test:e2e
local-web app check --repository .
git diff --check
git status --short
```

Expected: every command exits zero. `git status --short` may show only the four pre-existing `.superpowers/sdd/task-*-report.md` changes in the original main worktree; the implementation worktree must not contain or stage them.

- [ ] **Step 7: Record completion and commit acceptance coverage**

Change the design status to `Implemented and verified` only after Step 6 is green. Commit the acceptance test and status update:

```bash
git add tests/platform-shell.spec.ts docs/superpowers/specs/2026-08-09-local-web-visual-framework-phase-1-design.md
git commit -m "test: verify Plotter platform shell acceptance"
```

Do not merge to `main`, register, or deploy as part of this task. Present the topic branch, complete verification evidence, rendered screenshots, and deferred primitive catalogue for user review.
