# Trip Map Export Button Styling Design

## Purpose

Refine the trip-map export camera action so it feels intentionally integrated with the central destination search rather than appearing as a separate floating panel.

This is a visual-polish change only. It does not change export behavior, copy, icon choice, trip availability rules, error semantics, or generated map images.

## Visual Direction

Use one shared glass rail for the search field and camera action.

The toolbar rail owns the outer visual treatment:

- Translucent overlay background.
- Subtle border.
- Panel radius.
- Backdrop blur and saturation.
- Existing panel shadow.
- Eight-pixel internal padding.
- Eight-pixel gap between search and camera controls.

The destination search remains the dominant inner control. Remove the search group's duplicate outer background, border, shadow, blur, and padding when it appears inside the top toolbar. Keep the search input shell's existing border, background, focus treatment, and clear control.

## Camera Control

Keep Lucide's `Camera` icon and the accessible name `Download trip map`.

Within the shared rail, the camera action:

- Is exactly 42 by 42 pixels.
- Uses the control radius rather than the larger panel radius.
- Uses a subtle dark translucent action fill.
- Uses the subtle control border.
- Has no independent panel shadow or backdrop blur.
- Uses a 20-pixel camera icon with a visually lighter stroke.
- Does not shrink or grow between idle, disabled, loading, and error states.

The button remains visually secondary to search. It must not use the pink accent as its default fill.

## Interaction States

Idle:

- Subtle dark translucent fill and standard text color.
- Camera icon remains clear without dominating the toolbar.

Hover:

- Increase fill and border contrast using existing surface and border tokens.
- Do not change dimensions or add a floating shadow.

Keyboard focus:

- Preserve the hover contrast.
- Show the existing pink focus ring with sufficient offset to remain visible inside the rail.

Pressed:

- Move the control down by one pixel for tactile feedback.
- Return immediately when released.

Disabled:

- Preserve the 42-pixel geometry.
- Use disabled text color and reduced opacity.
- Do not apply hover or pressed treatments.

Loading:

- Replace the camera with the existing animated loader without resizing the control.
- Preserve reduced-motion behavior.
- Keep the button disabled until export settles.

Error:

- Keep the existing toolbar-level error message and copy.
- Anchor the message beneath the camera edge of the shared rail.
- Do not resize the rail or search field.

## Search Results

Anchor destination search status, errors, and results to the search group rather than the full toolbar rail. Results should match the search field width and should not extend under the camera action.

This positioning change is part of the toolbar integration because the camera now shares the toolbar's outer surface.

## Responsive Behavior

At desktop widths, retain the centered toolbar width and placement.

At widths up to 760 pixels:

- Keep search and camera on the same row inside the shared rail.
- Let search shrink with `min-width: 0` while the camera remains fixed at 42 pixels.
- Do not wrap the camera onto a separate row.
- Retain the existing 12-pixel left and right toolbar insets.
- Keep search results aligned to the search portion of the rail.

## Component Boundaries

No component-state or export-service changes are required. `TopToolbar` already renders the camera immediately after `SearchCombobox`, which is the correct semantic and keyboard order.

Implement the design with targeted toolbar CSS. Avoid changing generic panel input styling used by destination and activity panels. Scope search-group overrides through `.top-toolbar` so other `SearchCombobox` consumers remain unchanged.

## Testing and Verification

Extend style-source tests to cover:

- The shared outer toolbar border, background, padding, blur, and shadow.
- Removal of duplicate top-toolbar search-group chrome.
- The camera's 42-pixel dimensions, control radius, subtle fill, and lack of independent panel shadow.
- Keyboard focus ring and pressed treatment.
- Disabled and loading geometry stability.
- Mobile single-row layout and non-wrapping camera behavior.
- Search results being positioned relative to the search group.

Keep or extend `TopToolbar` component coverage to confirm the camera remains after search and retains its accessible idle and loading names.

Verify the rendered app in a browser at desktop and mobile widths. Inspect idle, hover, keyboard focus, disabled, loading, results-open, and export-error states. Confirm the search field does not resize or shift when the camera changes state.

Run focused toolbar/style tests, lint, the complete unit suite, and the production build.
