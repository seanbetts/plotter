# Tag Editor Suggestions Design

## Context

The stop and activity panels both have bottom-aligned tag sections. Tags currently use a large always-visible input inside the pill row. The next version makes the default state quieter, keeps panel layout stable, and encourages reuse of tags already used elsewhere in the trip.

This design applies to both stop tags and activity tags.

## Goals

- Show existing tags as removable pills without an always-visible text input.
- Add tags through a compact `+` control that opens a temporary input.
- Keep the bottom-aligned tag section from shifting when the add flow opens.
- Support individual tags and comma-separated tag entry.
- Suggest existing tags from both stops and activities so the app builds a consistent shared tag vocabulary.
- Present empty tag sections clearly without making them taller than populated sections.

## Non-Goals

- No global tag management screen.
- No automatic tag creation beyond what the user enters.
- No tag colors, categories, or metadata.
- No schema changes.

## Interaction Model

The resting tag section contains the section title, divider, existing tag pills, and a square `+` icon button. There is no visible text input in the resting state.

Clicking `+` opens a compact popover anchored to the add button. The popover floats upward over the content above the tag section. It must not consume layout space or move the bottom-aligned tag section.

The popover contains a single text input. Pressing `Enter`, typing a comma, or blurring the input commits the current text. Comma-separated text creates multiple tags. Empty values are ignored. Matching is case-insensitive for dedupe, while preserving the user's entered casing for new tags.

`Escape` closes the popover without committing the current input. Clicking a suggestion adds that tag immediately and keeps the popover open for additional tags.

Removing a tag remains a direct pill action.

## Empty State

An empty tag section still shows the `{Name} Tags` title and divider. The tag row shows muted `No tags yet` text on the left and the `+` button on the right.

The empty row has the same compact vertical footprint as a populated one-line tag row. This keeps the bottom of the panel visually stable whether tags exist or not.

When the user opens the add popover from an empty section, the input appears in the upward popover. If useful suggestions exist, they are shown immediately before the user types. If no useful suggestions exist, the popover shows only the input and does not render empty suggestion chrome.

## Suggestions

Suggestions are built from all tags already used across the app: stop tags and activity tags together. This shared vocabulary is intentional because stop and activity tags can overlap.

The current item's existing tags are excluded from suggestions.

Before typing, suggestions are shown only when useful. Useful suggestions are existing tags ranked by:

1. Frequency across all stops and activities.
2. Stable alphabetical ordering for ties.

After typing, suggestions filter case-insensitively against the query. Prefix matches rank before contains matches. Within those groups, frequency ranks first and alphabetical order breaks ties.

The suggestion list stays short enough to scan. The first implementation shows at most six suggestions.

## Component Shape

Extract the duplicated tag UI into a shared `TagEditor` component. It accepts:

- `label`: the visible and accessible section label, such as `Home Tags`.
- `tags`: the current item's tags.
- `suggestions`: the shared app-level tag vocabulary with frequency data.
- `emptyText`: defaulting to `No tags yet`.
- `onChange(nextTags)`: called when tags are added or removed.

Shared tag helpers handle splitting input, case-insensitive dedupe, suggestion filtering, and suggestion ranking. The stop and activity panels do not each maintain their own copies of that logic.

`App.tsx` computes the shared suggestions from currently loaded stops and activities, then passes the same suggestion list into both `DestinationProfile` and `ActivityPanel`.

## Persistence

Stop tags continue to use the stop panel's existing draft and autosave path. Adding or removing tags updates the stop form state and lets the existing autosave mechanism persist the change.

Activity tags continue to use the activity panel's immediate save path. Adding or removing tags updates the local activity draft and calls the existing tag save behavior.

The extracted `TagEditor` stays persistence-agnostic. It only emits `nextTags`; the owning panel decides how and when to persist.

## Accessibility

The tag fieldset remains labelled by the visible `{Name} Tags` legend.

The `+` button has an accessible label such as `Add tag`. The popover input also uses `Add tag`. Suggestion options are buttons so they can be reached and activated by keyboard.

Focus moves to the input when the popover opens. `Escape` closes the popover and returns focus to the `+` button. Removing a tag remains available through the tag pill's existing accessible remove label.

## Styling

The resting tag section keeps the existing title/divider treatment.

The tag row is compact and wraps pills when needed. The `+` button matches the existing square icon button language used elsewhere in the panels.

The add popover is absolutely positioned relative to the tag editor and opens upward. It visually reads as a temporary editing surface, with a subtle border, panel background, and small shadow. It must not alter normal document flow.

## Tests

Add or update component tests for both stop and activity panels:

- The resting state does not render the always-visible tag input.
- Empty sections show `No tags yet` and the `+` add button.
- Clicking `+` opens the input and focuses it.
- Comma-separated input adds multiple tags.
- Existing tags are deduped case-insensitively.
- Shared suggestions include tags from both stops and activities.
- Suggestions exclude tags already present on the current item.
- Empty sections show useful suggestions immediately when they exist.
- Typing filters suggestions with prefix matches before contains matches.
- Clicking a suggestion adds it and keeps the popover open.
- `Escape` closes the popover without committing typed text.
- Stop tags continue through autosave behavior.
- Activity tags continue through immediate save behavior.

Add style tests for the new tag editor styles:

- The resting tag section remains bottom-aligned.
- The popover is positioned as an overlay rather than a layout-expanding row.
- Empty and populated rows share a compact stable minimum height.
