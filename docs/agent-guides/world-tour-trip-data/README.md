# World Tour Trip Data Agent Guide

Use this guide when an AI agent needs to read or modify trip data in this app through the trip CLI.

Run all commands from the repository root. Do not write Supabase rows directly.

## Core Rules

- Use `npm run trip -- ...` for all trip data reads and writes.
- Let the app calculate derived data: routes, geometry, normalized locations, link metadata, sort order, timestamps, and defaults.
- Never author route geometry or app-derived fields by hand.
- Treat overnight locations as stops.
- Treat non-overnight visits, tours, meals, viewpoints, walks, and events as activities under the nearest relevant stop.
- Put booking refs, costs, times, and source caveats in stop or activity `notes`; do not invent structured date/time fields.
- Preserve approved stop and activity `tags` from route research, including route-variant, access-constraint, theme, and practical-role tags. Tags should already come from the controlled route-research vocabulary.
- For both stops and activities, use source coordinates when present and otherwise provide a specific `place.query`.
- Do not write address fields directly. The app resolves address/location metadata from `place.query` or `place.coordinates`.
- Use `--summary` for large dry-runs to avoid huge route geometry output.
- Link-add commands are idempotent; retrying an existing URL should be safe.
- Image import/upload is not part of the CLI v1 surface.

## Workflow

1. Inspect the current trip list:

```bash
npm run trip -- list --pretty
```

2. Read the target trip before planning writes:

```bash
npm run trip -- get --trip-id <trip-id> --include-activities --include-links --summary --pretty
```

For detailed inspection, omit `--summary`.

3. Interpret the source material:

- ordered overnight stays -> ordered stop drafts
- accommodation/provider/map URLs for overnight places -> stop links
- day activities/tours/events between overnight stays -> activity drafts
- source venue names, addresses, or route-research `placeQuery` values -> stop or activity `place.query`
- source lat/lng values or route-research `coordinates` values -> stop or activity `place.coordinates`
- activity/provider/map URLs -> activity links
- booking references and uncertain source notes -> `notes`
- approved source or route-research `tags` -> stop or activity `tags`

4. Choose the least broad write:

- Empty or intentionally replaced trip: use `replace-stops`.
- Existing populated trip: prefer `insert-stop`, `update-stop`, `delete-stop`, `reorder-stops`, `create-activity`, `update-activity`, and link commands.
- Destructive commands and broad replacement require preview-first behavior.

5. Dry-run agent-authored writes first:

```bash
npm run trip -- replace-stops --trip-id <trip-id> --input /tmp/stops.json --dry-run --summary --pretty
```

6. Apply only after the user has approved the dry-run or the request clearly authorizes applying:

```bash
npm run trip -- replace-stops --trip-id <trip-id> --input /tmp/stops.json --yes --summary --pretty
```

7. Add activities and links with narrow commands. For activity details, create first, then update details, notes, and tags after the activity id exists.

8. Verify with a readback:

```bash
npm run trip -- get --trip-id <trip-id> --include-activities --include-links --summary --pretty
```

When useful, produce an ordered stop/activity/link summary for the user rather than pasting full JSON.

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
- If route calculation fails but stops are valid, report the route failure separately from stop creation.
- If link preview is slow or unavailable, the CLI should still be able to store a fallback link.
- If output is too large, rerun with `--summary`.
- If a batch has many commands, keep commands grouped and verify after each meaningful phase: stops, activities, links.
