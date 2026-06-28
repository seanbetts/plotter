# Auto Routing And Ordered Stops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ordered itinerary stops, automatic adjacent route legs, manual/shipping leg overrides, MapTiler road map styling, and OpenRouteService route calculation.

**Architecture:** The domain model owns ordered destinations and richer route-leg status. A provider-neutral routing adapter calculates road geometry. App-level route synchronization compares adjacent ordered stops with existing legs, creates/manualizes/calculates only changed legs, and persists results through the existing repository/hook pattern.

**Tech Stack:** React, TypeScript, MapLibre GL JS, Dexie, OpenRouteService Directions GeoJSON, MapTiler MapLibre styles, Vitest, Playwright.

---

## Task 1: Ordered Stops And Route Model

**Files:** `src/domain/types.ts`, `src/domain/destinations.ts`, `src/domain/routeLegs.ts`, `src/domain/*.test.ts`, `src/storage/tripDb.ts`, `src/storage/tripRepository.ts`

- [ ] Add `Destination.order`.
- [ ] Add route leg status/provider/profile/cache fields.
- [ ] Normalize old destination and route leg records on repository load.
- [ ] Add tests for ordered destination creation, route-key generation, and legacy normalization.

## Task 2: Routing Adapter

**Files:** `src/adapters/openRouteService.ts`, `src/adapters/openRouteService.test.ts`

- [ ] Create `calculateOpenRouteServiceRoute({ origin, target, apiKey })`.
- [ ] POST to `https://api.openrouteservice.org/v2/directions/driving-car/geojson`.
- [ ] Send coordinates as `[[lng, lat], [lng, lat]]`.
- [ ] Parse first feature `LineString`, summary distance in meters, and duration in seconds.
- [ ] Return distance in km, duration in hours, geometry, provider, and profile.
- [ ] Test request body, headers, success parsing, missing key, non-OK response, and missing route.

## Task 3: Trip Hook Route Actions

**Files:** `src/hooks/useTripData.ts`, `src/hooks/useTripData.test.tsx`

- [ ] Add `updateRouteLeg`, `replaceRouteLegs`, and `reorderDestinations`.
- [ ] Assign new destinations the next order.
- [ ] Persist destination order updates in one action.
- [ ] Test add order, reorder persistence, and route-leg update/replace behavior.

## Task 4: Automatic Route Sync

**Files:** `src/routing/routeSync.ts`, `src/routing/routeSync.test.ts`

- [ ] Build pure helper to derive adjacent route legs from ordered destinations and existing legs.
- [ ] Preserve manual/shipping mode for the same origin/target pair.
- [ ] Mark new driving legs as pending.
- [ ] Drop obsolete non-adjacent legs.
- [ ] Test add, delete, reorder, manual preservation, and cache-key reuse.

## Task 5: Itinerary UI

**Files:** `src/components/ItineraryPanel.tsx`, route/itinerary tests, `src/styles.css`

- [ ] Remove manual `RouteLegEditor` from the panel.
- [ ] Add drag handles and native drag/drop reorder callbacks.
- [ ] Render route rows between stops with mode select.
- [ ] Test drag reorder callback and mode-change callback.

## Task 6: App Integration And Map Style

**Files:** `src/App.tsx`, `src/App.test.tsx`, `src/components/MapCanvas.tsx`, `src/components/MapCanvas.test.tsx`, `src/styles.css`

- [ ] Use MapTiler style URL when `VITE_MAPTILER_API_KEY` exists, with a safe demo fallback.
- [ ] Add route sync effect after loading/importing.
- [ ] Calculate pending driving routes immediately using OpenRouteService.
- [ ] Update route rows/status as calculation progresses.
- [ ] Keep manual/shipping legs out of routing API calls.
- [ ] Test add two stops auto-routes, manual mode skips API, and reorder recalculates changed adjacent legs.

## Task 7: Browser Verification

**Files:** `tests/world-tour.spec.ts`

- [ ] Mock OpenRouteService and Nominatim in Playwright.
- [ ] Add two destinations and verify an automatic route appears.
- [ ] Change a route to shipping/manual and verify no routing API call is made for that leg.
- [ ] Reorder stops and verify route sequence updates.

