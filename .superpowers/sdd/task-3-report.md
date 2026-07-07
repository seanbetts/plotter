# Task 3 Report: Shared Route Orchestration

Status: DONE

## Implementation Summary

- Created `src/tripCommands/routeOrchestration.ts` with shared route orchestration helpers:
  - `hasPreservableDrivingRouteData`
  - `calculateDrivingRouteLegs`
  - `finalizeRouteLeg`
  - `reconcileAndSaveRouteLegs`
- Moved route calculation, preserved driving route checks, manual shipping finalization, and route reconciliation persistence out of `useTripData`.
- Updated `src/hooks/useTripData.ts` to delegate route orchestration to the shared command layer without changing the hook API.
- Preserved optimistic pending route publication during destination reorder by keeping the local reconciliation in the hook.
- Fixed a persistence edge discovered during self-review: reorder must pass the pre-optimistic route-leg snapshot into shared reconciliation so stale no-longer-adjacent route legs are deleted from storage.

## TDD RED/GREEN Evidence

### Route orchestration tests

RED:

```bash
npm test -- src/tripCommands/routeOrchestration.test.ts
```

Observed after temporarily hiding the new implementation file because Task 3 files already existed in the worktree at handoff:

```text
FAIL src/tripCommands/routeOrchestration.test.ts
Error: Failed to resolve import "./routeOrchestration" from "src/tripCommands/routeOrchestration.test.ts". Does the file exist?
```

GREEN:

```bash
npm test -- src/tripCommands/routeOrchestration.test.ts src/hooks/useTripData.test.tsx
```

Result:

```text
Test Files  2 passed (2)
Tests  29 passed (29)
```

### Reorder persistence regression

During self-review, I added a hook regression test for persisted route legs after reorder.

RED:

```bash
npm test -- src/hooks/useTripData.test.tsx
```

Result before the fix:

```text
FAIL src/hooks/useTripData.test.tsx > useTripData > deletes route legs that no longer match adjacent destinations after reorder
AssertionError: expected ... to deeply equal ...
```

The persisted route-leg list still contained the stale previous adjacent pair.

GREEN:

```bash
npm test -- src/hooks/useTripData.test.tsx
```

Result after snapshotting `previousRouteLegs` before optimistic publication:

```text
Test Files  1 passed (1)
Tests  27 passed (27)
```

## Tests And Results

- `npm test -- src/tripCommands/routeOrchestration.test.ts src/hooks/useTripData.test.tsx`
  - PASS: 2 files, 29 tests.
- `npm test`
  - PASS: 46 files, 549 tests.
  - Node emitted existing experimental localStorage warnings during the full run.
- `npm run build`
  - PASS: TypeScript build and Vite production build completed.
  - Vite emitted the existing chunk-size warning for the large app bundle.

## Files Changed

- `src/tripCommands/routeOrchestration.ts`
  - New shared command-layer route orchestration module.
- `src/tripCommands/routeOrchestration.test.ts`
  - New tests for creating/calculating adjacent driving route legs and preserving ready route legs.
- `src/hooks/useTripData.ts`
  - Removed local route helper implementations.
  - Delegates route calculation/finalization/reconciliation to `routeOrchestration`.
  - Keeps reorder optimistic pending state while preserving stale-leg deletion.
- `src/hooks/useTripData.test.tsx`
  - Added regression coverage for deleting persisted no-longer-adjacent route legs after reorder.

## Self-Review Findings

- Found and fixed one subtle regression introduced by the delegation refactor:
  - Publishing optimistic reconciled route legs before calling shared reconciliation caused the shared helper to lose sight of removed route-leg IDs.
  - Fix: snapshot `previousRouteLegs` before optimistic publication and pass that snapshot to `reconcileAndSaveRouteLegs`.
- Confirmed preserved ready route behavior remains covered by both the new command tests and existing hook tests.
- Confirmed manual shipping finalization behavior remains delegated through `finalizeRouteLeg` and existing hook coverage still passes.
- Confirmed the hook public API did not change.

## Concerns

- The worktree already contained Task 3-looking uncommitted files when I began (`routeOrchestration.ts`, `routeOrchestration.test.ts`, and `useTripData.ts` edits). I treated them as peer/user work, inspected them, and completed/fixed them rather than reverting.
- Full test run passes, but it still prints Node experimental localStorage warnings unrelated to this task.
