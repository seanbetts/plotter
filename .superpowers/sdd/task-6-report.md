# Task 6 Report: Extend Route Alternatives With Recovery Provenance

## RED/GREEN

RED 1:

```bash
npm test -- src/domain/routeOptions.test.ts src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx
```

Expected failure confirmed: route options did not yet expose `warnings` or `endpointAnchors`, dedupe kept the less-informative normal geometry, the panel did not render recovery copy, App did not pass current route/anchors into option calculation, and selected fallback warnings/anchors were not saved.

RED 2:

```bash
npm test -- src/adapters/openRouteService.test.ts src/hooks/useTripData.test.tsx
```

Expected failure confirmed: current recovered routes were dropped when provider options failed, recoverable 2009/2010 option failures did not enter recovery, and `applyValidatedRouteLegResult` saved only the route leg instead of endpoint anchors plus route result.

GREEN:

```bash
npm test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx src/hooks/useTripData.test.tsx
```

Result: passed, `5` files / `149` tests.

## Option and Dedupe Behavior

- `RouteOptionSource` now includes `adjusted-endpoint` and `profile-fallback`.
- `RouteOption` now carries `warnings` and `endpointAnchors`.
- Route option keys include recovery variant, warning codes, actual profile, and endpoint anchor coordinate snapshots so recovered options do not collide with strict-profile options.
- Dedupe keeps recovery provenance over identical less-informative geometry:
  - `profile-fallback` outranks `adjusted-endpoint`.
  - `adjusted-endpoint` outranks `recommended`.
  - Existing normal-option order is preserved when neither option carries recovery provenance.
- `calculateOpenRouteServiceRouteOptions` includes a supplied current ready provider route as the first option, including recovery warnings and saved endpoint anchors.
- If provider alternatives fail with recoverable ORS `2009`/`2010`, the adapter replays that initial error through the existing recovery policy and returns only provider-returned route geometry.
- If provider alternatives fail for another recoverable-hidden reason while a current route is available, the current route remains available rather than being dropped.

## Stale and Atomic Persistence Evidence

- App passes `currentRouteLeg`, `originAnchors`, and `targetAnchors` into option calculation.
- Selecting a recovery option builds a validated ready route with selected metrics, warnings, actual profile, and endpoint anchors.
- `applyValidatedRouteLegResult` now accepts `destinationUpdates` and saves endpoint anchors plus the selected route through the existing rollback-safe batch.
- The existing fingerprint guard still runs before persistence; if the route intent changes while the picker is open, neither the route nor endpoint anchors are saved and the existing `Route intent changed. Recalculate route options.` error remains.
- Hook coverage verifies destination anchor save order with the selected route result and rollback of endpoint anchors when route persistence fails.

## Files Changed

- `src/domain/routeOptions.ts`
- `src/domain/routeOptions.test.ts`
- `src/adapters/openRouteService.ts`
- `src/adapters/openRouteService.test.ts`
- `src/components/RouteAlternativesPanel.tsx`
- `src/components/RouteAlternativesPanel.test.tsx`
- `src/App.tsx`
- `src/App.test.tsx`
- `src/hooks/useTripData.ts`
- `src/hooks/useTripData.test.tsx`
- `.superpowers/sdd/task-6-report.md`

## Build and Full Suite

```bash
npm run build
```

Result: passed. Vite emitted the existing large chunk warning.

```bash
npm test
```

Result: passed, `62` files / `905` tests. Vitest emitted repeated Node `localStorage` experimental warnings; they did not affect the pass result.

## Concerns

- No functional concerns for Task 6.
- I did not implement itinerary-row warning behavior; Task 7 owns that.
- The working tree had pre-existing unrelated edits in `.superpowers/sdd/task-1-report.md` and `.superpowers/sdd/task-4-report.md`; I left them unstaged.

## Review Fix Addendum

### RED/GREEN

RED:

```bash
npm test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/App.test.tsx
```

Expected failures confirmed before implementation: duplicate `profile-fallback` ids selected the first matching option, current recovered routes recomputed `routeKey`, malformed persisted recovered routes could be offered, and async option results could publish after the route intent changed.

GREEN:

```bash
npm test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/App.test.tsx
```

Result: passed, `3` files / `94` tests.

Broader focused Task 6 verification:

```bash
npm test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx src/hooks/useTripData.test.tsx
```

Result: passed, `5` files / `153` tests.

### Option and Dedupe Behavior

- Every displayed/selectable route option is normalized through `ensureUniqueRouteOptionIds`, which keeps the first option's id stable and appends a stable route-key component only to later colliding ids.
- Recovered options now derive stable ids from their persisted/generated `routeKey`, so multiple adjusted-endpoint or profile-fallback geometries can coexist and selection maps back to the exact option.
- `routeOptionFromCurrentRoute` now preserves the persisted `routeKey`, warnings, endpoint anchors, source identity, actual provider, actual profile, and route geometry instead of rebuilding identity.
- Current-route normalization now rejects incomplete persisted recovered routes unless they have an existing `routeKey`, the ORS provider, a supported profile, finite metrics, non-empty sections, and valid renderable LineString geometry.
- Dedupe still prefers recovery provenance over identical less-informative geometry; unique id normalization happens after dedupe so provenance is not discarded to repair collisions.

### Stale and Atomic Persistence Evidence

- App coverage verifies that selecting the second of two duplicate-source fallback options persists that exact option's `routeKey`.
- Async option loading rechecks the current route fingerprint before publishing options. If route intent changes while loading, the panel reports `Route intent changed. Recalculate route options.` and does not show stale options.
- The existing confirm-time fingerprint guard remains in place for route and endpoint-anchor persistence, so stale saves continue to be blocked atomically.

### Build and Full Suite

```bash
npm run build
```

Result: passed. Vite emitted the existing large chunk warning.

```bash
npm test
```

Result: passed, `62` files / `909` tests. Vitest emitted repeated Node `localStorage` experimental warnings; they did not affect the pass result.

### Review Fix Files

- `src/domain/routeOptions.ts`
- `src/domain/routeOptions.test.ts`
- `src/adapters/openRouteService.ts`
- `src/adapters/openRouteService.test.ts`
- `src/App.tsx`
- `src/App.test.tsx`
- `.superpowers/sdd/task-6-report.md`

### Concerns

- No functional concerns for the review fixes.
- I did not implement itinerary-row warning behavior; Task 7 still owns that.
- Pre-existing unrelated edits in `.superpowers/sdd/task-1-report.md` and `.superpowers/sdd/task-4-report.md` remain unstaged.

## Final Catch-Path Fix Addendum

### RED/GREEN

RED:

```bash
npm test -- src/App.test.tsx
```

Expected failure confirmed: when route options were loading, changing the route intent, then rejecting the original options request surfaced `Provider unavailable for old route intent.` from the stale request instead of treating it as stale.

GREEN:

```bash
npm test -- src/App.test.tsx
```

Result: passed, `1` file / `62` tests.

Focused Task 6 verification:

```bash
npm test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx src/hooks/useTripData.test.tsx
```

Result: passed, `5` files / `154` tests.

### Stale Error Behavior

- `openRouteAlternatives` now applies the same route-leg id, expected fingerprint, and current fingerprint guard in the catch path before publishing an error.
- If an options request fails after the route intent has changed, the stale provider error is not shown; the panel is handled consistently with the stale success path and reports `Route intent changed. Recalculate route options.`
- Current-intent failures still publish the real provider/application error.

### Build and Full Suite

```bash
npm run build
```

Result: passed. Vite emitted the existing large chunk warning.

```bash
npm test
```

Result: passed, `62` files / `910` tests. Vitest emitted repeated Node `localStorage` experimental warnings; they did not affect the pass result.

### Final Fix Files

- `src/App.tsx`
- `src/App.test.tsx`
- `.superpowers/sdd/task-6-report.md`

### Concerns

- No functional concerns for the final catch-path fix.
- I did not implement itinerary-row warning behavior; Task 7 still owns that.
- Pre-existing unrelated edits in `.superpowers/sdd/task-1-report.md` and `.superpowers/sdd/task-4-report.md` remain unstaged.
