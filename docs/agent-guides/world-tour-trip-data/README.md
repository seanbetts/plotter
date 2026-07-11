# World Tour Trip Data Agent Guide

Use this guide when an AI agent needs to read or modify trip data in this app through the trip CLI.

Run all commands from the repository root. Do not write Supabase rows directly.

## Core Rules

- Use `npm run trip -- ...` for all trip data reads and writes.
- Let the app calculate derived route fields: `type`, `status`, `geometry`, `distanceKm`, `travelTimeHours`, `provider`, `profile`, `routeKey`, `calculatedAt`, `sections`, `warnings`, and `error`.
- Never author route geometry or app-derived fields by hand.
- Treat overnight locations as stops.
- Treat non-overnight visits, tours, meals, viewpoints, walks, and events as activities under the nearest relevant stop.
- Put booking refs, costs, times, and source caveats in stop or activity `notes`; do not invent structured date/time fields.
- Preserve approved stop and activity `tags` from route research, including route-variant, access-constraint, theme, and practical-role tags. Tags should already come from the controlled route-research vocabulary.
- For both stops and activities, use source coordinates when present and otherwise provide a specific `place.query`.
- Do not write address fields directly. The app resolves address/location metadata from `place.query` or `place.coordinates`.
- Translate the approved research handoff faithfully. Do not reconsider stop selection, order, activities, pacing, stay allocation, or route semantics.
- Before manifest construction, verify the handoff `plannedDurationDays` equals the sum of every stop's `expectedStayDays`. If it differs, report the mismatch without replanning or changing the allocation. `plannedDurationDays` is handoff-only and is omitted from the CLI manifest because app duration is derived from stop stays.
- Omit route directives for ordinary adjacent `drive` + `automatic` legs, including normal ferry, tunnel, bridge, and vehicle-shuttle crossings, so the app applies `allow` and calculates them automatically.
- Copy only approved exceptional route intent: `movement`, `calculation`, `ferryPolicy`, ordered `waypoints`, and `notes`. Never infer it from prose, notes, or links.
- Preserve `vehicle-shipping` + `manual` only when the approved handoff explicitly marks a genuine route discontinuity or independent vehicle-shipping transfer.
- Use one `manifestVersion: 2` full manifest for agent-authored new trips so the vehicle preset, stops, activities, links, and exceptional route intent are written together.
- Give every full-manifest stop a unique key and explicit positive `expectedStayDays`; use `1` for departure and return anchors.
- Use `--summary` for large commands to avoid huge route geometry output.
- Link-add commands are idempotent; retrying an existing URL should be safe.
- Image import/upload is not part of the CLI v1 surface.

## Workflow Branches

### Approved New Trip

When the user has clearly authorized creating a new isolated trip:

1. Optionally inspect names and IDs to avoid an accidental duplicate:

```bash
npm run trip -- list --pretty
```

2. Build one `manifestVersion: 2` input using the full-manifest shape in the CLI reference, then create it once:

```bash
npm run trip -- create --input /tmp/trip-manifest.json --summary --pretty
```

3. Audit the persisted trip:

```bash
npm run trip -- audit --trip-id <trip-id> --pretty
```

Do not precede an explicitly authorized new-trip create with a dry-run. Do not generate a per-activity runner, loop through create/update/link commands, or inspect service source when this reference answers the command question. The full manifest resolves and enriches each value once, runs a semantic audit before persistence, and writes one repository snapshot.

### User Requests A Preview

Run one full-manifest preview and stop for review:

```bash
npm run trip -- create --input /tmp/trip-manifest.json --dry-run --summary --pretty
```

A later apply repeats place resolution, link enrichment, and route calculation. Do not apply immediately after a large preview; allow enough time to avoid route-provider limits.

### Existing Trip Amendment

Read the target before planning writes:

```bash
npm run trip -- get --trip-id <trip-id> --include-activities --include-links --summary --pretty
```

Use the least broad granular command: `insert-stop`, `update-stop`, `delete-stop`, `reorder-stops`, activity commands, or link commands. Existing destructive edits and broad stop replacement remain preview-first; apply only after approval with `--yes` where required.

Apply approved vehicle and exceptional route intent with these exact forms:

```bash
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck
npm run trip -- update-route-leg --trip-id trip-1 --route-leg-id leg-1 --input /tmp/route-intent.json
```

The route-intent input may contain only `movement`, `calculation`, `ferryPolicy`, ordered `waypoints`, and `notes`.

Use `recalculate-failed-routes` for persisted failed legs. Never use a no-op stop reorder to force route calculation.

## Source Mapping

Interpret source material as follows:

- ordered overnight stays -> ordered stop drafts
- accommodation/provider/map URLs for overnight places -> stop links
- day activities/tours/events between overnight stays -> activity drafts
- source venue names, addresses, or route-research `placeQuery` values -> stop or activity `place.query`
- source lat/lng values or route-research `coordinates` values -> stop or activity `place.coordinates`
- activity/provider/map URLs -> activity links
- booking references and uncertain source notes -> `notes`
- approved source or route-research `tags` -> stop or activity `tags`
- approved route-research `vehiclePreset` -> manifest `vehiclePreset` or existing-trip `set-vehicle --preset`
- approved exceptional route directive -> manifest V2 `routeLegs` entry or existing-trip `update-route-leg` input

Use source coordinates for short or ambiguous names, including single-letter places and named viewpoints. Otherwise provide a specific `place.query`. The app, not the agent, owns normalized addresses and location metadata.

## Portable Skill Setup

This folder is intentionally environment-agnostic. Agentic environments can either read this guide directly or copy it into their own skill/playbook system.

For Codex, the active local skill can live at:

```text
~/.codex/skills/world-tour-trip-data/
```

The Codex `SKILL.md` should keep trigger metadata and point to the same workflow and reference material in this guide.

## Reference

Read [cli-reference.md](./cli-reference.md) for exact command forms, writable JSON shapes, output contracts, and a verification snippet.

## Failure Handling

- If a write fails because a place cannot resolve, use source coordinates if available or ask for a more precise place query.
- Structural validation and activity-distance errors block persistence, so do not claim that a new trip exists. Inspect structured `destination`, `activity`, `origin`, and `target` contexts before correcting implicated source coordinates or queries.
- Automatic provider failures do not roll back an otherwise valid manifest. Preserve the trip and approved route intent, report failed or review-required legs, and run `audit` for exact diagnostics. Do not replan, change stops, weaken ferry intent, remove waypoints, switch to manual routing, or author substitute geometry after a provider failure.
- For a persisted trip with failed routes, run `recalculate-failed-routes`, then `audit`; preserve ready, review-required, and manual legs.
- If link preview is slow or unavailable, the CLI should still be able to store a fallback link.
- If output is too large, rerun with `--summary`.
- Do not replace a failed bulk create with a generated sequence of granular activity commands.
