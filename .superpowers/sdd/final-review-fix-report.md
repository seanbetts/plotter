## 2026-07-08 Final Review Fixes

- Fixed external zero-trip refresh by having `refreshTrips()` create and activate a replacement `World tour` trip instead of clearing the active repository.
- Fixed patch validation so clearable text fields preserve present empty strings for stop `notes` and activity `description`/`notes`, while stop `name` and activity `title` remain non-empty when provided.
- Implemented `getTrip({ includeLinks })` link omission/inclusion semantics for stop and activity links.
- Tightened `expectedStayDays` validation to reject decimal values instead of flooring them.

Regression coverage:
- `src/hooks/useTripWorkspace.test.tsx`: external refresh with zero trips creates and activates a replacement trip.
- `src/tripCommands/validation.test.ts`: clearing stop notes, clearing activity description/notes, and rejecting decimal expected stay days.
- `src/tripCommands/tripDataService.test.ts`: `getTrip` omits links by default and includes them only when `includeLinks` is true.

Verification:
- Red tests confirmed before production fixes.
- `npm test -- src/hooks/useTripWorkspace.test.tsx src/tripCommands/validation.test.ts src/tripCommands/tripDataService.test.ts` -> 3 files passed, 33 tests passed.
- `npm run build` -> passed.
- `npm run test:e2e` -> 7 passed.
- `npm test` -> final run passed, 50 files passed, 586 tests passed.

Notes:
- First full `npm test` run hit a timeout in `src/components/MapCanvas.test.tsx`; rerunning that file passed, and the final full suite passed.
