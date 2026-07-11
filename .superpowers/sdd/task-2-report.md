# Task 2 Report: Preserve Provider Errors and Schedule Directions Requests

## Files

- Created `src/adapters/openRouteServiceScheduler.ts`
- Created `src/adapters/openRouteServiceScheduler.test.ts`
- Modified `src/adapters/openRouteService.ts`
- Modified `src/adapters/openRouteService.test.ts`

## Implementation

### Structured OpenRouteService errors

- Replaced the old status-only route calculation error with exported `OpenRouteServiceError`.
- Exported `isOpenRouteServiceError(error)` for later recovery/auth handling.
- Preserved provider details on non-OK responses:
  - `status`
  - `code`
  - `providerMessage`
  - `coordinateIndex` parsed from `specified coordinate N`
  - `profile`
  - `retryAfterMs` parsed from `Retry-After` seconds or HTTP-date headers
- Error parsing now reads provider bodies safely from either `text()` or `json()`-style responses and keeps malformed non-JSON bodies readable.

### Shared directions scheduler

- Added `createOpenRouteServiceScheduler({ maxRequests, windowMs, now, sleep })`.
- Added the shared production instance:
  - `openRouteServiceDirectionsScheduler = createOpenRouteServiceScheduler({ maxRequests: 40, windowMs: 60_000 })`
- Wrapped every directions fetch inside `postDirections()` with `openRouteServiceDirectionsScheduler.schedule(...)`.
- Because every normal route, provider alternative, and avoid-feature supplemental request already flows through `postDirections()`, they now all share the same admission budget.
- Added one retry for `OpenRouteServiceError` status `429`, delayed by `max(retryAfterMs, nextWindowDelay)`.

## RED Evidence

Command:

```bash
npm test -- src/adapters/openRouteServiceScheduler.test.ts src/adapters/openRouteService.test.ts
```

Observed failure before implementation:

- `src/adapters/openRouteServiceScheduler.test.ts` failed to resolve `./openRouteServiceScheduler`
- `src/adapters/openRouteService.test.ts` failed because the adapter still threw `OpenRouteServiceRouteCalculationError` with only `status`, not the structured `OpenRouteServiceError` fields

## GREEN Evidence

Command:

```bash
npm test -- src/adapters/openRouteServiceScheduler.test.ts src/adapters/openRouteService.test.ts
```

Result:

- `2` test files passed
- `24` tests passed

## Full-Suite Evidence

Command:

```bash
npm test
```

Result:

- `61` test files passed
- `862` tests passed

## Concurrency Reasoning

- The scheduler keeps a shared ordered list of request start timestamps.
- Admission is serialized through a single `admissionQueue` promise chain.
- Each caller must acquire that admission lock before it can inspect or mutate the start list.
- While holding the lock, the scheduler:
  - prunes timestamps at or before `now - windowMs`
  - starts immediately only if fewer than `maxRequests` timestamps remain
  - otherwise sleeps until the oldest timestamp ages out, then re-checks before admitting
- Because start-time reservation is serialized, simultaneous `schedule()` callers cannot observe the same free slot and over-admit. That is the key guard against exceeding `40` starts in any rolling `60`-second window.
- The 429 retry path does not bypass admission. It waits for `max(retryAfterMs, nextWindowDelay)` and then re-enters `schedule(...)`, so the retry is still counted against the same sliding-window budget.

## Self-Review

- Verified the red/green cycle with the focused ORS tests.
- Verified the full suite after implementation.
- Reviewed the Task 2 diff directly and checked `git diff --check` for whitespace/patch issues.
- Confirmed the scheduler is wired at `postDirections()`, which is the shared entry point for normal directions, provider alternatives, and supplemental avoid-feature requests.
- Left unrelated worktree changes untouched.

## Concerns

- No functional concerns from this task.
- The repo still has an unrelated modified `.superpowers/sdd/task-1-report.md`; it was intentionally left alone and not part of Task 2.

## Fix Pass Addendum

### Blocking finding addressed

- `calculateOpenRouteServiceRouteOptions()` now rethrows post-retry `OpenRouteServiceError` status `429` from both the provider-alternatives path and the supplemental path.
- This prevents persistent quota exhaustion from being swallowed into an empty options list and stops supplemental requests from being attempted after quota exhaustion remains in effect.
- Existing behavior for ordinary non-auth, non-quota provider failures is unchanged: those still stay hidden so supplementals can continue.

### Coverage finding addressed

- Added a scheduler test proving one scheduled operation may reject and a later operation is still admitted and resolves.
- This protects the `reserveStartTime()` `finally` release behavior on the admission queue.

### Exact commands and results

1. RED verification:

```bash
npm test -- src/adapters/openRouteServiceScheduler.test.ts src/adapters/openRouteService.test.ts
```

Result:

- Failed as expected.
- New regression `rethrows persistent quota failures from provider alternatives without attempting supplementals` resolved `[]` instead of rejecting, proving persistent 429s were still being swallowed after the scheduler retry.

2. GREEN verification:

```bash
npm test -- src/adapters/openRouteServiceScheduler.test.ts src/adapters/openRouteService.test.ts
```

Result:

- `2` test files passed
- `26` tests passed

3. Full-suite verification:

```bash
npm test
```

Result:

- `61` test files passed
- `864` tests passed

### Fix-pass self-review

- Reviewed the two route-options catch blocks and kept the fix minimal by extending only the existing rethrow gate.
- Confirmed the 429 regression checks both behavior and fetch count, so supplementals are not attempted after persistent quota exhaustion.
- Confirmed the new scheduler regression stays narrowly focused on admission recovery after a rejection and does not broaden scheduler behavior beyond the review request.
- Left unrelated worktree changes untouched.
