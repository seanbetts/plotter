# Trip Delete Confirmation Design

## Goal

Make trip deletion feel like a third mode of the existing trip picker rather than a separate confirmation panel.

## Interaction

Opening delete confirmation closes the trip list and shows the existing picker dialog surface. The confirmation uses the same compact three-column row as create and rename:

- The selected trip name occupies the left field position in a read-only input, which receives focus when the confirmation opens.
- An X icon button cancels deletion.
- A Trash icon button confirms deletion.

The Trash action retains the accessible name `Delete <trip name>`. Escape and clicking outside cancel the confirmation, matching the existing picker modes. Pressing Enter from the focused read-only trip field submits the delete action through the same form behavior used by create and rename.

## Styling

Reuse the picker dialog, entry-row, icon-button, spacing, radius, hover, and focus styles already used by create and rename. Add only the minimal styling needed to make the non-editable trip name occupy the input position and to give the Trash action the existing danger color. No new modal or general-purpose button abstraction is needed.

## Failure Behavior

If deletion reports failure, keep the confirmation open and continue showing the existing action error. New async-state behavior is outside this styling change.

## Verification

- Component coverage verifies the compact shared row, X cancellation, Trash confirmation, Enter confirmation, and failure behavior.
- The rendered app is checked at desktop width to confirm alignment, hover/focus treatment, readable long trip names, and visual consistency with create and rename.
