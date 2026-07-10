# Route Planning Duration And Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Required domain skill:** Use superpowers:writing-skills while editing and validating the two installed skills.

**Goal:** Make route research recommend a naturally paced trip duration and hand an approved itinerary to the trip-data skill without allowing the writer to replan it or misclassify ordinary ferry-inclusive routes as manual shipping.

**Architecture:** `world-tour-route-research` remains the only planning and travel-judgement layer. Its portable guide, schema, and fixtures define duration recommendation, approved stay allocation, and route-leg semantics; `world-tour-trip-data` only translates, executes, and technically validates that handoff. The app continues to resolve places and calculate exact routes, geometry, distance, and duration.

**Tech Stack:** Markdown agent guides and fixtures, Codex local skills, shell contract checks with `rg` and `diff`, Python skill validation with `quick_validate.py`.

## Global Constraints

- The research skill owns route shape, stop selection, activities, pacing, stay allocation, and route semantics.
- The research skill recommends the route's natural duration; it does not ask for a duration merely to begin planning.
- A user-supplied duration is a preference unless the user clearly calls it fixed, exact, or a maximum.
- Shortening a route changes scope, corridor, activities, or trip character; it must not simply compress every stay.
- At `handoff-ready` depth, `plannedDurationDays` is exact and equals the sum of all stop `expectedStayDays` values.
- The trip-data skill may validate the handoff and report technical failures but must not change planning decisions.
- Ordinary roads, ferries, tunnels, bridges, and vehicle shuttles use automatic app routing.
- `shipping-manual` is only for a genuine route discontinuity or independent vehicle-shipping transfer that automatic driving routing cannot represent.
- The app owns route geometry, normalized locations, precise distance and duration, link metadata, sort order, timestamps, and persistence.
- Do not change app runtime code or add pacing intelligence to the app audit.
- Do not edit or stage unrelated worktree changes.

---

## File Structure

- Modify `docs/agent-guides/world-tour-route-research/README.md`: planning ownership, optimal-duration workflow, and route-leg defaults.
- Modify `docs/agent-guides/world-tour-route-research/schema-reference.md`: stable duration and handoff fields plus corrected manual-route semantics.
- Modify both files under `docs/agent-guides/world-tour-route-research/examples/`: user-facing recommendation and exact handoff fixtures.
- Modify `docs/agent-guides/world-tour-trip-data/README.md`: mechanical writer boundary and automatic-routing default.
- Modify `docs/agent-guides/world-tour-trip-data/cli-reference.md`: automatic ferry manifest example and genuine discontinuity example.
- Synchronize the active route-research and trip-data skills under `~/.codex/skills/`.

## Task 1: Research-Owned Duration And Pacing

**Files:**
- Modify: `docs/agent-guides/world-tour-route-research/README.md`
- Modify: `docs/agent-guides/world-tour-route-research/schema-reference.md`
- Modify: `docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-user-response-fixture.md`
- Modify: `docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-handoff-artifact-fixture.md`

**Interfaces:**
- Consumes: approved design in `docs/superpowers/specs/2026-07-08-route-research-skill-design.md`.
- Produces: `recommendedDuration`, `plannedDurationDays`, and exact `CandidateStop.expectedStayDays` semantics for the trip-data handoff.

- [ ] **Step 1: Run failing duration contract checks**

~~~bash
set -e
rg -n "recommend the route's natural duration" docs/agent-guides/world-tour-route-research/README.md
rg -n '"plannedDurationDays"' docs/agent-guides/world-tour-route-research/schema-reference.md
rg -n '"expectedStayDays"' docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-handoff-artifact-fixture.md
~~~

Expected: at least one command exits `1`, proving the current guide does not encode the approved contract.

- [ ] **Step 2: Update the research workflow and decision ownership**

Add these exact behavioural rules to the relevant `Core Rules`, `Workflow`, `Balance And Prune`, `Decision Ownership`, and approval-handoff sections of the portable README:

~~~markdown
- Recommend the route's natural duration after choosing and balancing its worthwhile content. Do not ask for a duration merely to begin planning.
- Treat a user-supplied duration as a preference unless the user clearly describes it as fixed, exact, or a maximum.
- If a preferred duration differs from the recommendation, explain the scope, pace, corridor, or activity trade-off before producing that variant.
- If a hard duration limit cannot hold the proposed route comfortably, reduce scope or explicitly make the trip transit-heavy; do not compress every stay silently.
- Treat one-day stops primarily as departure, arrival, transit, resupply, or buffer stops. Give activity bases enough time for their activities beyond the surrounding driving burden.
- At handoff-ready depth, choose exact expectedStayDays values whose sum equals plannedDurationDays.
~~~

Add a `Derive The Recommended Duration` workflow step after candidate balancing. It must derive time from realistic relocation days, activity bases, recovery/resupply, and material weather, ferry, border, or remote-road buffers. Keep estimated driving burden in research; leave precise route calculations to the app.

State in the handoff that trip data preserves approved stop order, activities, `plannedDurationDays`, and `expectedStayDays` without judging or changing them.

- [ ] **Step 3: Extend the route-research schema**

Add these fields to the top-level `RouteResearchPlan` example:

~~~json
"recommendedDuration": {
  "days": 15,
  "rangeDays": { "min": 13, "max": 17 },
  "rationale": "Balances efficient transit with meaningful scenic bases and a final access buffer."
},
"plannedDurationDays": 15,
~~~

Document:

~~~markdown
recommendedDuration.days is the research skill's naturally paced recommendation. rangeDays is optional and should be narrow enough to remain the same trip shape. plannedDurationDays is the exact duration of the currently approved itinerary; it may differ from the recommendation after user feedback.

At handoff-ready depth, plannedDurationDays is required and must equal the sum of every stop's positive integer expectedStayDays. This is an objective handoff consistency check, not permission for the trip-data skill or app audit to assess itinerary quality.
~~~

Add `"expectedStayDays": 2` to the `CandidateStop` example. Document that it is required at `handoff-ready` depth, while `suggestedStay` remains useful for human review at earlier depths.

- [ ] **Step 4: Rewrite the user-response fixture**

Replace the duration assumption with:

~~~markdown
Assumptions: one-way summer travel, a standard road vehicle, and a mixed scenic/practical pace. No duration limit was supplied.

Recommended duration: 15 days. A reasonable range is 13-17 days without materially changing the route; 15 days leaves enough time for the scenic bases and final access buffer rather than treating every base as a transit night.
~~~

End with:

~~~markdown
Does a 15-day version feel about right, or should I deliberately reshape it into a shorter or longer trip?
~~~

Do not expose schema field names in this user-facing fixture.

- [ ] **Step 5: Make the handoff fixture exact**

Update the handoff fixture so:

- the naturally paced recommendation and approved plan are both 15 days;
- the table and schema-native JSON use exact `expectedStayDays` values;
- `recommendedDuration` and `plannedDurationDays` are present;
- activities remain nested under bases with enough allocated time;
- `Implementation Mapping` tells trip data to copy the allocation without replanning.

Use this exact complete allocation:

~~~text
Home: 1
Continental gateway: 2
Inland regional base: 3
Landscape base: 4
Final resupply base: 2
Destination base: 3
Total: 15
~~~

- [ ] **Step 6: Run the duration contract checks**

~~~bash
set -e
rg -n "recommend the route's natural duration|user-supplied duration|plannedDurationDays|expectedStayDays" \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md
rg -n "Recommended duration: 15 days|shorter or longer trip" \
  docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-user-response-fixture.md
rg -n '"plannedDurationDays": 15|"expectedStayDays"|Total: 15' \
  docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-handoff-artifact-fixture.md
! rg -n "Assumptions: one-way travel, 12-15 days" \
  docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-user-response-fixture.md
git diff --check
~~~

Expected: new contracts are found, the obsolete assumption is absent, and formatting passes.

- [ ] **Step 7: Commit the research contract**

~~~bash
git add \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-user-response-fixture.md \
  docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-handoff-artifact-fixture.md
git commit -m "docs: make route research own trip duration"
~~~

Expected: only the four route-research guide files are committed.

## Task 2: Mechanical Trip-Data Handoff And Route Semantics

**Files:**
- Modify: `docs/agent-guides/world-tour-route-research/README.md`
- Modify: `docs/agent-guides/world-tour-route-research/schema-reference.md`
- Modify: `docs/agent-guides/world-tour-trip-data/README.md`
- Modify: `docs/agent-guides/world-tour-trip-data/cli-reference.md`

**Interfaces:**
- Consumes: approved `plannedDurationDays`, stop order, `expectedStayDays`, activities, place inputs, tags, links, and explicit discontinuity directives from Task 1.
- Produces: a writer contract that translates those fields into `manifestVersion: 1` and lets the app calculate every ordinary route.

- [ ] **Step 1: Run the failing obsolete-language check**

~~~bash
set -e
! rg -n "approved ferry or vehicle-shipping|manual ferry legs|every approved ferry" \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  docs/agent-guides/world-tour-trip-data/README.md \
  docs/agent-guides/world-tour-trip-data/cli-reference.md
~~~

Expected: exits `1` because obsolete broad manual-ferry language still exists.

- [ ] **Step 2: Correct route semantics in research**

Add to the route-research README:

~~~markdown
- Assume automatic driving routing between adjacent stops, including ordinary ferries, tunnels, bridges, and vehicle shuttles that a normal road route can contain.
- Emit shipping-manual only for a genuine physical discontinuity or independent vehicle-shipping transfer that automatic driving routing cannot represent.
~~~

Replace the `RouteLegDirective` introduction in the schema with:

~~~markdown
Ordered adjacent stops use automatic app routing by default. Do not emit a route directive merely because the route includes an ordinary ferry, tunnel, bridge, or vehicle shuttle. Keep operator, booking, and timetable information in links, notes, or logistics gates.

Emit shipping-manual only for an approved genuine route discontinuity or independent vehicle-shipping transfer that the app cannot represent as continuous driving. The directive is explicit because the trip-data skill must preserve research decisions rather than infer route mode from prose.
~~~

Replace the ordinary ferry directive example with:

~~~json
{
  "fromStopKey": "vehicle-shipping-origin",
  "toStopKey": "vehicle-shipping-destination",
  "type": "shipping-manual",
  "notes": "Approved vehicle-shipping transfer around a physical route discontinuity.",
  "sources": ["shipping-operator"]
}
~~~

- [ ] **Step 3: Make the trip-data guide explicitly mechanical**

Add to `docs/agent-guides/world-tour-trip-data/README.md`:

~~~markdown
- Translate the approved research handoff faithfully. Do not reconsider stop selection, order, activities, pacing, stay allocation, or route semantics.
- Preserve approved expectedStayDays; arithmetic validation is allowed, but itinerary-quality judgement belongs to route research.
- Omit route directives for ordinary adjacent driving legs, including normal ferry, tunnel, bridge, and vehicle-shuttle crossings, so the app calculates them automatically.
- Preserve shipping-manual only when the approved handoff explicitly marks a genuine route discontinuity or independent vehicle-shipping transfer. Never infer it from notes or links.
~~~

Change “manual ferry legs” in the full-manifest rule to “explicit route discontinuities”. Keep malformed-manifest, place-resolution, route-calculation, and semantic-audit failures as technical persistence blockers.

- [ ] **Step 4: Correct the CLI examples**

In `cli-reference.md`:

1. Keep the Larvik-Hirtshals example, set `"routeLegs": []`, and state that the app calculates this ordinary ferry-inclusive route.
2. Replace the broad ferry requirement with:

~~~markdown
- Omit route directives for ordinary adjacent driving legs, including normal ferry, tunnel, bridge, and vehicle-shuttle crossings.
- Use shipping-manual only for an approved genuine route discontinuity or independent vehicle-shipping transfer that automatic driving routing cannot represent.
~~~

3. Add this separate directive example:

~~~json
{
  "fromStopKey": "vehicle-shipping-origin",
  "toStopKey": "vehicle-shipping-destination",
  "type": "shipping-manual",
  "notes": "Approved vehicle-shipping transfer around a physical route discontinuity."
}
~~~

Do not modify the runtime manifest schema; optional `routeLegs` already supports both behaviours.

- [ ] **Step 5: Run cross-guide boundary checks**

~~~bash
set -e
rg -n "automatic.*ferr|ordinary.*ferr|genuine.*route discontinuity|Do not reconsider" \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  docs/agent-guides/world-tour-trip-data/README.md \
  docs/agent-guides/world-tour-trip-data/cli-reference.md
! rg -n "approved ferry or vehicle-shipping|manual ferry legs|every approved ferry" \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  docs/agent-guides/world-tour-trip-data/README.md \
  docs/agent-guides/world-tour-trip-data/cli-reference.md
git diff --check
~~~

Expected: both skills express one boundary, obsolete language is absent, and formatting passes.

- [ ] **Step 6: Commit the handoff boundary**

~~~bash
git add \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  docs/agent-guides/world-tour-trip-data/README.md \
  docs/agent-guides/world-tour-trip-data/cli-reference.md
git commit -m "docs: separate route planning from trip writes"
~~~

Expected: only the four portable guide files are committed.

## Task 3: Active Skill Synchronization And Validation

**Files:**
- Modify outside repo: `~/.codex/skills/world-tour-route-research/SKILL.md`
- Synchronize outside repo: `~/.codex/skills/world-tour-route-research/references/schema-reference.md`
- Modify outside repo: `~/.codex/skills/world-tour-trip-data/SKILL.md`
- Synchronize outside repo: `~/.codex/skills/world-tour-trip-data/references/cli-reference.md`

**Interfaces:**
- Consumes: portable contracts completed in Tasks 1 and 2.
- Produces: locally active Codex skills with the same planning/write boundary and reference content as the repo.

- [ ] **Step 1: Update the active route-research skill**

Add the exact Task 1 rules for natural-duration recommendation, preference versus hard-limit handling, exact handoff allocation, and activity-aware pacing to `Core Rules`. Add the Task 2 automatic-routing rule and restrict `shipping-manual` to genuine discontinuities.

Update `Workflow` so duration is derived after balancing candidates and before presenting the plan. State that the trip-data handoff executes rather than replans.

- [ ] **Step 2: Update the active trip-data skill**

Add:

~~~markdown
- Treat an approved route-research handoff as authoritative for stop order, activities, stay allocation, and route semantics. Translate and validate it; do not replan it.
- Omit route directives for ordinary adjacent driving legs, including normal ferry, tunnel, bridge, and vehicle-shuttle crossings.
- Preserve shipping-manual only for an explicit approved genuine route discontinuity or independent vehicle-shipping transfer. Never infer it from prose notes or links.
~~~

Keep atomic create, audit, diagnostic, and failed-route recovery instructions unchanged.

- [ ] **Step 3: Synchronize local references**

~~~bash
cp \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  ~/.codex/skills/world-tour-route-research/references/schema-reference.md
cp \
  docs/agent-guides/world-tour-trip-data/cli-reference.md \
  ~/.codex/skills/world-tour-trip-data/references/cli-reference.md
~~~

Expected: installed references exactly match their portable repo sources.

- [ ] **Step 4: Validate both installed skills**

~~~bash
set -e
uv run --with PyYAML \
  ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  ~/.codex/skills/world-tour-route-research
uv run --with PyYAML \
  ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  ~/.codex/skills/world-tour-trip-data
diff -u \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  ~/.codex/skills/world-tour-route-research/references/schema-reference.md
diff -u \
  docs/agent-guides/world-tour-trip-data/cli-reference.md \
  ~/.codex/skills/world-tour-trip-data/references/cli-reference.md
~~~

Expected: both validators print `Skill is valid!` and both diffs are empty.

- [ ] **Step 5: Run the final separation contract**

~~~bash
set -e
rg -n "natural duration|plannedDurationDays|expectedStayDays" \
  docs/agent-guides/world-tour-route-research/README.md \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  ~/.codex/skills/world-tour-route-research/SKILL.md
rg -n "do not replan|Do not reconsider|ordinary.*ferr|genuine.*route discontinuity" \
  docs/agent-guides/world-tour-trip-data/README.md \
  docs/agent-guides/world-tour-trip-data/cli-reference.md \
  ~/.codex/skills/world-tour-trip-data/SKILL.md
! rg -n "approved ferry or vehicle-shipping|manual ferry legs|every approved ferry" \
  docs/agent-guides/world-tour-route-research \
  docs/agent-guides/world-tour-trip-data \
  ~/.codex/skills/world-tour-route-research \
  ~/.codex/skills/world-tour-trip-data
git diff --check
git status --short
~~~

Expected: ownership rules are present, obsolete ferry rules are absent, formatting passes, and no files from this plan remain uncommitted. Pre-existing unrelated changes may remain and must not be staged or altered.

- [ ] **Step 6: Review against the approved design**

Confirm every statement has explicit, non-contradictory coverage:

~~~text
Research chooses route scope, stops, activities, natural duration, stay allocation, and route semantics.
User duration preferences receive an explicit trade-off; hard limits reshape the route.
Trip data translates and validates but does not replan.
Ordinary ferry-inclusive routes remain automatic.
Only genuine discontinuities use shipping-manual.
No app runtime or audit pacing logic was added.
~~~

Expected: all six statements map to the portable guides and active skills.
