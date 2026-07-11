# Task 2 Report: Composite the Real Stop-Pill Overlay into the PNG

## Status

Complete.

## Implementation summary

- Reused `buildStopPillPresentations` for canonical stop-pill text and final-viewport projection.
- Reused `createStopPillElement` so exports render the same normal, unselected pill DOM used by the app.
- Removed the export-only MapLibre stop-number and stop-name symbol layers while preserving route and stop-point layers and their existing styling.
- Created the temporary `[data-trip-map-export-labels]` overlay only after the export map reached `idle`.
- Cloned the overlay, recursively inlined computed styles, serialized it into an SVG `foreignObject`, and loaded it as an image with browser primitives only.
- Composited pixels in the required order: MapLibre canvas, stop-pill image, source attribution, PNG conversion.
- Preserved the existing dimensions, fit behavior, map error monitoring, timeouts, filename/download flow, attribution rendering, and cleanup lifecycle.
- Added explicit cleanup for both the overlay and its temporary SVG object URL on success and failure.
- Added no dependency.

## TDD evidence

### RED

Command:

```text
npm test -- src/map/tripMapExport.test.ts
```

Result: exit 1; 1 test file failed, with 3 expected failures and 29 passing tests.

The failures demonstrated the missing behavior directly:

1. Feature labels were still `1 - Balcombe` and `2 - Paris` instead of `ST - Balcombe` and `02 - Paris`.
2. MapLibre still contained `trip-map-export-stop-numbers` and `trip-map-export-stop-names`.
3. The export overlay snapshot was empty instead of containing two normal, unselected app pills.

### GREEN

Command:

```text
npm test -- src/map/tripMapExport.test.ts
```

Result: exit 0; 1 test file passed, 33 tests passed.

The focused suite includes regressions for the real overlay DOM, map/overlay/attribution/toBlob ordering, rasterization rejection, overlay removal, and both SVG and PNG object-URL revocation.

## Verification

- `npm test -- src/map/tripMapExport.test.ts` — exit 0; 1 file passed, 33 tests passed.
- `npm test` — exit 0; 57 files passed, 708 tests passed.
- `npm run lint` — exit 0; no ESLint errors.
- `npm run build` — exit 0; TypeScript and Vite production build succeeded.
- `git diff --check` — exit 0; no whitespace errors.

The full test run emitted the repository's Node `localStorage` experimental warnings. The build emitted the existing large-chunk advisory for the 1,702.99 kB main bundle; neither command failed.

## Files changed

- `src/map/tripMapExport.ts`
- `src/map/tripMapExport.test.ts`
- `.superpowers/sdd/task-2-report.md`

The unrelated pre-existing modification to `.superpowers/sdd/task-1-report.md` was not edited or staged for this task.

## Self-review

- Confirmed the overlay is created after the final `idle` event, so `map.project` uses the fitted export viewport.
- Confirmed pills use `selectedDestinationId: null` and the shared element factory, yielding normal unselected app classes and canonical text.
- Confirmed MapLibre still owns the route and stop-point drawing, including the unchanged stop-point radius, colors, and stroke.
- Confirmed attribution statements were extracted without behavioral changes and still execute after both image draws.
- Confirmed SVG image-load errors remain observable and abort the download path.
- Confirmed the SVG URL is revoked in the rasterizer `finally`, and the overlay, PNG URL, anchor, map monitor, map, and container are cleaned up by the existing outer `finally` path.
- Confirmed the scoped diff adds no dependency and does not alter bounds, filename, timeout, download, or route behavior.

## Concerns

None blocking. Browser support for SVG `foreignObject` and computed-style inlining is the approach mandated by the task brief; failure is surfaced through the existing export error path rather than silently producing a label-free PNG.

## Review follow-up

### Fixes

- Passed the fitted `TripMapBounds` into the overlay helper and unwrapped every destination longitude with `unwrapLongitudeForBounds` before calling `map.project`. A dateline trip fitted to `[179, 181]` now projects the `-179` destination at `181`, matching its route and stop-source geometry.
- Changed `loadImage` to use one guarded settle path that clears both `onload` and `onerror` before resolving or rejecting.
- Captured the rasterized image in the test harness and proved that it is the second `drawImage` source after the MapLibre canvas.
- Made overlay and SVG resource cleanup independently observable: both success and failure assert the captured overlay's own `remove` spy, and the failure path explicitly asserts revocation of `blob:labels`.

### Follow-up TDD evidence

RED command:

```text
npm test -- src/map/tripMapExport.test.ts
```

RED result: exit 1; 1 test file failed, 3 tests failed and 30 passed.

The corrected regressions failed for the intended reasons:

1. The dateline overlay projected `-179` instead of the fitted-world longitude `181`.
2. The image `onload` handler remained attached after a rasterization failure.
3. The image `onload` handler remained attached after successful export rasterization.

GREEN command:

```text
npm test -- src/map/tripMapExport.test.ts
```

GREEN result: exit 0; 1 test file passed, 33 tests passed.

### Follow-up verification

- `npm test -- src/map/tripMapExport.test.ts` — exit 0; 1 file passed, 33 tests passed.
- `npm test` — exit 0; 57 files passed, 708 tests passed.
- `npm run lint` — exit 0; no ESLint errors.
- `npm run build` — exit 0; TypeScript and Vite production build succeeded.

The full suite again emitted Node's existing `localStorage` experimental warnings. The build again emitted Vite's existing large-chunk advisory; neither command failed.

### Follow-up concerns

None.

## Browser canvas-taint follow-up

### Browser RED

Exact command:

```text
npm run test:e2e -- --grep "downloads a map-only PNG"
```

Result: exit 1; 1 Chromium test failed after 30.0 seconds. Playwright timed out at `tests/world-tour.spec.ts:144` while `page.waitForEvent('download')` waited for a download that never arrived. The captured page state showed the toolbar alert `Couldn't export trip map. Try again.`

### Root cause evidence

The failure occurs after the rasterized SVG image is drawn into the PNG output canvas. A standalone real-Chromium comparison loaded the same SVG `foreignObject` through each candidate URL type and attempted a canvas export:

- `blob:` SVG image: `SecurityError: Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported.`
- Percent-encoded `data:image/svg+xml;charset=utf-8,` image: exported successfully.

This isolates the taint to the blob-backed SVG image URL, not the computed CSS, serialized `foreignObject`, MapLibre canvas, or PNG download URL.

The in-app Browser connection was unavailable (`No browser is available`), so the task-authorized repository Playwright workflow and standalone Playwright Chromium comparison were used.

### Fix

- Preserved the exact cloned DOM, recursively inlined computed styles, SVG dimensions, and `foreignObject` content.
- Replaced only the SVG image transport: the serialized SVG is now percent-encoded into a `data:image/svg+xml;charset=utf-8,` URL before `loadImage`.
- Removed the now-nonexistent SVG blob URL creation/revocation lifecycle.
- Preserved image success/failure handler cleanup, explicit overlay removal, and the final PNG blob URL creation/revocation lifecycle.
- Added a unit regression requiring a canvas-safe SVG data URL containing the serialized `foreignObject`; returning to a blob-backed raster image fails this test.
- Updated success/failure cleanup tests so failure creates/revokes no object URL and success creates/revokes only the final PNG URL.

### Unit RED/GREEN

RED command:

```text
npm test -- src/map/tripMapExport.test.ts
```

RED result: exit 1; 1 file failed, 3 tests failed and 31 passed. The raster image source was `blob:trip-map` instead of a data URL, the failure path still created one SVG object URL, and success still created two object URLs.

GREEN command:

```text
npm test -- src/map/tripMapExport.test.ts
```

GREEN result: exit 0; 1 file passed, 34 tests passed.

### Browser GREEN and final verification

- `npm run test:e2e -- --grep "downloads a map-only PNG"` — exit 0; 1 Chromium test passed in 11.2 seconds (`downloads a map-only PNG` completed in 10.5 seconds).
- `npm test -- src/map/tripMapExport.test.ts` — exit 0; 1 file passed, 34 tests passed.
- `npm test` — exit 0; 57 files passed, 709 tests passed.
- `npm run lint` — exit 0; no ESLint errors.
- `npm run build` — exit 0; TypeScript and Vite production build succeeded.

The full suite emitted Node's existing `localStorage` experimental warnings. The build emitted Vite's existing large-chunk advisory; neither command failed.

### Browser follow-up concerns

None. The authoritative Chromium export/download regression now passes. Other browser engines were not part of the requested e2e project.
