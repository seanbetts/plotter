# Stop Details And Activity Notes Design

## Goal

Add a compact stop-level details section to the stop profile and simplify the activity details surface.

The stop profile should expose a general notes field for the selected stop. The activity panel should keep notes as the editable planning field and stop showing the separate description field.

## User Experience

`DestinationProfile` will render a `{Stop} Details` section after `{Stop} Links` and before `{Stop} Activities`.

The section contains one textarea:

- Label: `{Stop} Notes`
- Value: `destination.research.notes`
- Save behavior: the existing destination autosave flow

`ActivityPanel` will keep the existing `{Activity} Details` section but remove the `{Activity} Description` textarea. The section will contain only `{Activity} Notes`.

The activity `description` value will remain in the domain model and persistence layer for now. Existing stored descriptions are preserved, but the current UI no longer edits them.

## Data Flow

Stop notes use the existing `Destination.research.notes` field. This avoids a new table column or migration and keeps general stop planning notes separate from route-specific context.

Destination autosave will include `research.notes` alongside the existing editable fields. Link edits must continue preserving the current notes value, and notes edits must continue preserving the current links and book references.

Activity notes continue using `Activity.notes`. Activity description remains untouched by UI edits unless another code path explicitly changes it.

## Component Boundaries

`DestinationProfile` owns the stop notes draft because it already owns the stop edit draft and autosave status.

`ActivityPanel` removes description from its local draft/edit revision tracking. It still tracks and saves title, notes, tags, links, and location.

No repository interface changes are needed.

## Error Handling

Stop notes use the existing destination autosave status: saving, saved, and unable to save.

Activity notes keep the existing field-level save behavior. Removing the description textarea must not affect notes save failures or draft preservation.

## Testing

Add or update component tests to cover:

- `DestinationProfile` renders `{Stop} Details` and `{Stop} Notes`.
- Editing stop notes autosaves `research.notes` while preserving `research.links` and `research.bookReferences`.
- `ActivityPanel` no longer renders `{Activity} Description`.
- `ActivityPanel` still renders and saves `{Activity} Notes`.
- Tag section ordering remains stable after the activity notes field.
