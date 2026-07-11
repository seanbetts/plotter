# Integrated Trip Map Export Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the central search and trip-map export action as one shared glass rail with a compact integrated camera control.

**Architecture:** Keep the existing `TopToolbar` markup, semantic order, and export state unchanged. Move outer panel chrome from the toolbar's `.search-group` onto `.top-toolbar`, apply camera-specific control styling, and scope every search override through the toolbar so panel search components remain untouched.

**Tech Stack:** CSS, React 19, Lucide React, Vitest style-source tests, Testing Library, browser visual verification

## Global Constraints

- This is visual polish only; do not change export behavior, copy, icon choice, trip availability, error semantics, or generated images.
- The toolbar rail uses an overlay background, subtle border, panel radius, backdrop blur/saturation, existing panel shadow, 8px padding, and 8px control gap.
- The camera is exactly 42 x 42 pixels with the control radius, subtle action fill, subtle border, no independent shadow/blur, and a 20px lighter-stroke icon.
- Camera geometry remains unchanged in idle, disabled, loading, and error states.
- Keyboard focus uses the existing pink focus ring; pressed state moves down exactly 1px.
- Search results and search feedback align to the search portion and never extend beneath the camera.
- At widths up to 760px, search and camera stay on one row with 12px viewport insets; the camera never wraps.
- Scope search overrides through `.top-toolbar`; do not change generic panel input or other `SearchCombobox` consumers.
- Preserve unrelated working-tree edits and path-limit the implementation commit.

---

### Task 1: Integrate the Camera into the Shared Toolbar Rail

**Files:**
- Modify: `src/styles.css:413-490`
- Modify: `src/styles.css:2966-2986`
- Modify: `src/styles.test.ts:6-17`
- Test: `src/components/TopToolbar.test.tsx` (run unchanged semantic/state coverage)

**Interfaces:**
- Consumes: Existing `.top-toolbar`, `.search-group`, `.toolbar-icon-action`, `.trip-map-export-action`, `.trip-map-export-spinner`, `.trip-map-export-error`, and `.search-results` class names.
- Produces: A CSS-only shared rail; no new component props, functions, DOM wrappers, or state.
- Preserves: `TopToolbar` renders `SearchCombobox` before `TripMapExportAction`, and the export button retains `Download trip map` / `Generating trip map` accessible names.

- [ ] **Step 1: Add failing style-source tests for the shared rail**

Expand the existing `trip map export styles` block in `src/styles.test.ts` with exact assertions:

```ts
it('uses one shared glass rail for search and map export', () => {
  expect(styles).toMatch(
    /\.top-toolbar\s*{[^}]*padding:\s*8px;[^}]*border:\s*1px solid var\(--border-subtle\);[^}]*border-radius:\s*var\(--radius-panel\);[^}]*background:\s*var\(--surface-overlay\);[^}]*box-shadow:\s*var\(--shadow-panel\);/s,
  );
  expect(styles).toMatch(
    /\.top-toolbar \.search-group\s*{[^}]*position:\s*relative;[^}]*min-width:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
  );
});

it('renders a compact integrated camera with complete interaction states', () => {
  expect(styles).toMatch(
    /\.trip-map-export-action\s*{[^}]*width:\s*42px;[^}]*height:\s*42px;[^}]*border-radius:\s*var\(--radius-control\);[^}]*background:\s*var\(--surface-action-subtle\);[^}]*box-shadow:\s*none;/s,
  );
  expect(styles).toMatch(
    /\.trip-map-export-action svg\s*{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*stroke-width:\s*1\.8;/s,
  );
  expect(styles).toMatch(
    /\.trip-map-export-action:focus-visible\s*{[^}]*outline:\s*var\(--focus-ring\);[^}]*outline-offset:\s*2px;/s,
  );
  expect(styles).toMatch(
    /\.trip-map-export-action:active:not\(:disabled\)\s*{[^}]*transform:\s*translateY\(1px\);/s,
  );
});

it('keeps the integrated rail on one mobile row', () => {
  expect(styles).toMatch(
    /@media \(max-width:\s*760px\)\s*{[^}]*\.top-toolbar\s*{[^}]*right:\s*12px;[^}]*left:\s*12px;[^}]*flex-wrap:\s*nowrap;[^}]*}/s,
  );
  expect(styles).toMatch(
    /@media \(max-width:\s*760px\)\s*{[^}]*\.top-toolbar \.search-group\s*{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/s,
  );
});
```

Keep the existing spinner, error, and reduced-motion assertions.

- [ ] **Step 2: Run the focused style test and verify RED**

Run:

```bash
npm test -- src/styles.test.ts
```

Expected: FAIL because `.top-toolbar` does not own panel chrome, the camera is still 44 x 44 with panel radius/shadow, and mobile still uses `flex-wrap: wrap`.

- [ ] **Step 3: Move outer glass chrome onto the toolbar**

Replace the desktop toolbar/search chrome in `src/styles.css` with this structure while retaining the existing position, width, z-index, and centering:

```css
.top-toolbar {
  position: absolute;
  top: 16px;
  left: 50%;
  z-index: 16;
  display: flex;
  width: min(680px, calc(100vw - 32px));
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
  transform: translateX(-50%);
  -webkit-backdrop-filter: blur(var(--blur-overlay)) saturate(1.25);
  backdrop-filter: blur(var(--blur-overlay)) saturate(1.25);
}

.top-toolbar .search-group {
  position: relative;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
```

Leave the unscoped `.search-group` rule in place for other contexts. The toolbar-scoped rule must appear after it or have sufficient specificity to override it. Do not remove the search input shell's inner border/background/focus styles.

- [ ] **Step 4: Implement the integrated camera and feedback states**

Add camera-specific overrides after the generic `.toolbar-icon-action` rules:

```css
.trip-map-export-action {
  width: 42px;
  height: 42px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--surface-action-subtle);
  box-shadow: none;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    opacity 140ms ease,
    transform 90ms ease;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.trip-map-export-action svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.8;
}

.trip-map-export-action:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-control-hover);
}

.trip-map-export-action:focus-visible {
  border-color: var(--border-selected);
  background: var(--surface-control-hover);
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.trip-map-export-action:active:not(:disabled) {
  transform: translateY(1px);
}

.trip-map-export-action:disabled {
  width: 42px;
  height: 42px;
  color: var(--text-disabled);
  background: var(--surface-action-subtle);
  cursor: not-allowed;
  opacity: 0.52;
}

.trip-map-export-error {
  top: calc(100% + 8px);
  right: 8px;
}
```

Keep the existing spinner animation and reduced-motion rule. Ensure generic `.toolbar-icon-action:hover` cannot override the disabled or camera-specific treatments by placing these selectors afterward and using `:not(:disabled)`.

- [ ] **Step 5: Keep mobile search and camera on one row**

Update the existing `@media (max-width: 760px)` rules:

```css
.top-toolbar {
  right: 12px;
  left: 12px;
  width: auto;
  min-width: 0;
  flex-wrap: nowrap;
  transform: none;
}

.top-toolbar .search-group {
  flex: 1 1 auto;
  min-width: 0;
}

.top-toolbar .search-group input {
  width: 100%;
  min-width: 0;
}

.top-toolbar .search-results {
  width: 100%;
}
```

Remove the old toolbar search rule that forces `flex: 1 1 100%`. Keep the fixed camera width inherited from the desktop rule.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/styles.test.ts src/components/TopToolbar.test.tsx
```

Expected: PASS. Style tests confirm the rail/camera/mobile rules; unchanged toolbar tests confirm the camera remains after search, stays disabled without stops, and retains idle/loading labels.

- [ ] **Step 7: Run static and full regression gates**

Run:

```bash
npm run lint
npm test
npm run build
```

Expected: all commands exit 0. Existing Node localStorage and Vite chunk-size advisories may remain, but there must be no test, lint, or build failure.

- [ ] **Step 8: Verify the rendered toolbar at desktop and mobile widths**

Start the normal development server:

```bash
npm run dev
```

Inspect the app in the browser at approximately 1440 x 900 and 390 x 844:

- Idle: one shared rail; no separate camera panel shadow.
- Hover: only fill/border contrast changes.
- Keyboard focus: pink ring is fully visible inside the rail.
- Disabled: camera remains 42 x 42 and does not respond to hover.
- Loading: spinner replacement causes no search width or rail height shift.
- Results open: results match search width and stop before the camera column.
- Error: message anchors beneath the camera edge without resizing the rail.
- Mobile: search and camera remain on one row with 12px side insets.

Use browser screenshots to compare the final desktop toolbar with the approved integrated-glass mockup. Stop the development server after verification.

- [ ] **Step 9: Commit the styling slice**

```bash
git add src/styles.css src/styles.test.ts
git commit -m "style: integrate trip map export button"
```

Confirm `src/components/TopToolbar.tsx` and its test remain unchanged unless rendered verification proves a markup issue. If a markup change becomes necessary, stop and return to the design because the approved scope is CSS-only.
