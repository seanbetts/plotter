# Task 8 Report: CLI Documentation And Skill Wrapper Guidance

## Implementation Summary

Created `docs/trip-cli.md` as the agent-facing documentation for the trip CLI. The doc covers:

- the full command list for trips, stops, links, activities, and activity links
- safe read / dry-run / apply workflow guidance
- JSON input shapes for trip, stop, place, activity, and reorder commands
- flag-based link inputs for `add-stop-link`, `delete-stop-link`, `add-activity-link`, and `delete-activity-link`
- the shared output envelope for success and failure responses
- what the service calculates versus what agents may author
- itinerary interpretation rules for stops, activities, and links
- realtime refresh behavior in the open app
- explicit v1 media exclusion and no-image-automation guidance for wrappers

I did not update the design spec because the implemented command names and contract matched the existing spec closely enough for documentation to be written directly against the current CLI behavior.

## Tests And Results

Ran:

- `npm test`
- `npm run build`

Results:

- `npm test`: passed, 50 test files and 581 tests passed
- `npm run build`: passed successfully

Build emitted an existing Vite chunk-size warning, but the build completed successfully.

## Files Changed

- `docs/trip-cli.md`
- `.superpowers/sdd/task-8-report.md`

## Self-Review Findings

- The doc uses the real CLI command names from `src/cli/trip.ts`, including `list`, `get`, `reorder-stops`, `list-activities`, and the link commands.
- The doc now reflects the real flag-based link command contract instead of implying a JSON `LinkDraft`.
- The dry-run guidance now states that every write command supports `--dry-run`, including create, update, link, delete, and reorder paths.
- The insert-stop examples now treat `--after-stop-id` and `--before-stop-id` as independent anchors.
- The doc documents the actual environment contract used by the CLI: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, plus optional MapTiler and OpenRouteService keys.
- The wrapper guidance explicitly tells future agents to manipulate stops and let the service derive routes, links, and defaults.
- The doc avoids introducing any markdown import convention, per the task brief.

## Concerns

- No contract corrections were required.
- The only notable warning was the pre-existing Vite chunk-size warning during build; it did not block completion.
