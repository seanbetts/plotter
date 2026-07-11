# Final Review Fix Report

## Status

Complete. All four final-review findings are addressed and the required verification gates pass.

## Findings Addressed

1. MapLibre lifecycle errors now reject the export while waiting for either `load` or `idle`, and while PNG capture is pending. The persistent `error` listener is removed during cleanup. Regression tests prove that an error followed by `idle` performs no `toBlob()` call and no download click.
2. Trip bounds now use the smallest wrapped longitude interval. Stops and route geometry are unwrapped into that same interval before export, preventing dateline trips from framing nearly the whole world. Dateline and ordinary European cases cover bounds and exported source coordinates.
3. Export filenames now prefix Windows reserved device stems and cap the sanitized stem at 100 Unicode code points before adding `.png`.
4. The named browser test now hashes the live MapLibre canvas PNG pixels before and after export. Each sample is accepted only after five consecutive equal condition-polled hashes; there is no fixed sleep. The test then requires the stable before/after hashes to match.

## TDD Evidence

### RED

The final regression tests were applied to a detached worktree at baseline `b56b1a3` and run with:

```text
npm test -- src/map/tripRouteFeatures.test.ts src/map/tripMapExport.test.ts
```

Result: exit 1; 2 test files failed, 13 tests failed and 24 passed. The failures demonstrated:

- raw Windows device stems and the uncapped 180-character filename;
- wide `[-179, 179]` dateline bounds instead of `[179, 188]`;
- unwrapped export framing/source coordinates were absent;
- MapLibre errors during both `load` and `idle` resolved instead of rejecting.

The first strengthened browser run used condition-stabilized compositor screenshots. All three repeated runs failed the before/after equality assertion, proving compositor screenshots include noise unrelated to the live WebGL canvas. The test was corrected to hash `HTMLCanvasElement.toDataURL('image/png')`, directly measuring the live canvas pixels named by the requirement.

### GREEN

```text
npm test -- src/map/tripRouteFeatures.test.ts src/map/tripMapExport.test.ts
```

Result: exit 0; 2 test files and all 37 tests passed.

```text
npm run test:e2e -- --grep "downloads a map-only PNG" --repeat-each=3
```

Result: exit 0; all 3 Chromium repetitions passed with stable, identical pre/post live-canvas pixel hashes.

## Final Verification

- `npm run lint`: exit 0; no ESLint findings.
- `npm test`: exit 0; 56 files and 687 tests passed. Node emitted the existing experimental `localStorage` warnings.
- `npm run build`: exit 0; TypeScript and Vite production build completed. Vite emitted the existing large-chunk advisory.
- `npm run test:e2e -- --grep "downloads a map-only PNG" --repeat-each=3`: exit 0; 3 tests passed.
- `git diff --check`: exit 0.

An initial build run caught a cleanup-function inference mismatch (`() => boolean`/`() => void` versus `() => undefined`) in the new error monitor. The unsubscribe closure now has an explicit `() => void` contract and discards `Set.delete()`'s boolean result. Every verification command above was rerun after that correction.

## Files

- `src/map/tripMapExport.ts`
- `src/map/tripMapExport.test.ts`
- `src/map/tripRouteFeatures.ts`
- `src/map/tripRouteFeatures.test.ts`
- `tests/world-tour.spec.ts`
- `.superpowers/sdd/final-fix-report.md`

## Self-Review

- Error monitoring begins immediately after MapLibre construction, so style/load failures cannot be missed between construction and the first awaited event.
- Event waits unsubscribe their temporary error subscribers on every settle path; final cleanup removes the one persistent MapLibre listener before removing the map.
- Capture is guarded both while `toBlob()` is pending and immediately afterward, so a recorded resource failure cannot proceed to object-URL creation or anchor click.
- Longitude bounds are derived from the complement of the largest circular gap. The same chosen interval is reused for `fitBounds`, route GeoJSON, and stop GeoJSON.
- Ordinary non-wrapping trips keep their familiar signed longitude values.
- Filename truncation uses Unicode code points rather than UTF-16 code units and trims a trailing separator created by the cap.
- Browser verification compares the actual live map canvas pixels, not CSS dimensions, transforms, or the surrounding page compositor.
- The four inherited task-report modifications were preserved and deliberately excluded from this scoped fix commit.

## Concerns

- Full unit runs still print the repository's pre-existing Node experimental warning about `localStorage` configuration.
- The production build still prints the pre-existing Vite large-chunk advisory.
- The pixel-stability helper hashes PNG data rather than transferring full pixel buffers to Node; because the hash input is the canvas's own deterministic PNG encoding, any pixel change changes the compared digest without adding a PNG decoder dependency.
