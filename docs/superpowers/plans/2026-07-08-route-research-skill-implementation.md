# Route Research Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable `world-tour-route-research` agent guide and local Codex skill that researches candidate routes without mutating app data.

**Architecture:** The repo keeps the portable guide, schema reference, and example output under `docs/agent-guides/world-tour-route-research/`. The local Codex skill at `~/.codex/skills/world-tour-route-research/` is a thin wrapper that points agents back to the repo guide and enforces the approval-gated handoff to `world-tour-trip-data`.

**Tech Stack:** Markdown documentation, Codex local skills, shell validation with `rg`, `sed`, and `uv run --with PyYAML`.

## Global Constraints

- Research first, write later.
- Keep route judgement separate from app mutation.
- Produce inspectable artifacts with source links and explicit confidence.
- Let the app calculate derived data such as routes, geometry, normalized locations, timestamps, link previews, and sort order.
- Treat overnight or base locations as candidate stops.
- Treat non-overnight sights, hikes, tours, food stops, viewpoints, and experiences as candidate activities under a nearby stop.
- Preserve uncertainty in notes rather than inventing structure.
- Prefer current, primary, official, or traveller-validated sources for facts that can change.
- Require user approval before handing the plan to the trip data CLI.
- Do not write Supabase rows directly.
- Generated route research outputs should not be committed by default.

---

## File Structure

- Create `docs/agent-guides/world-tour-route-research/README.md`: portable agent workflow, source hierarchy, route-shape rules, approval-gated handoff.
- Create `docs/agent-guides/world-tour-route-research/schema-reference.md`: stable route research plan schema, allowed values, and output tables.
- Create `docs/agent-guides/world-tour-route-research/examples/home-to-nordkapp-example.md`: compact example proving corridor comparison, candidate stops, activities, source evidence, and logistics gates.
- Create `~/.codex/skills/world-tour-route-research/SKILL.md`: local Codex trigger and instructions.
- Create `~/.codex/skills/world-tour-route-research/references/schema-reference.md`: local copy of the schema reference for offline skill use.
- Create `~/.codex/skills/world-tour-route-research/agents/openai.yaml`: local skill display metadata.

## Task 1: Portable Route Research Guide

**Files:**
- Create: `docs/agent-guides/world-tour-route-research/README.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-08-route-research-skill-design.md`
- Produces: Portable guide used by local skill wrappers and other agent environments.

- [ ] **Step 1: Create the guide directory**

Run:

```bash
mkdir -p docs/agent-guides/world-tour-route-research
```

Expected: directory exists.

- [ ] **Step 2: Create the README**

Create `docs/agent-guides/world-tour-route-research/README.md` with this content:

```markdown
# World Tour Route Research Agent Guide

Use this guide when an AI agent needs to research a potential overland route before any data is written to the world-tour app.

This guide is research-only. It produces a reviewable route research plan. It does not create, delete, or update trips. After the user approves a plan, use the `world-tour-trip-data` guide and `npm run trip -- ...` CLI commands to implement approved content.

## Core Rules

- Research first, write later.
- Do not mutate app data from this guide.
- Do not write Supabase rows directly.
- Do not author route geometry or app-derived fields.
- Re-check current ferry, road, border, weather, access, and seasonal restriction facts during each research run.
- Treat overnight or base locations as candidate stops.
- Treat non-overnight sights, hikes, tours, food stops, viewpoints, and experiences as candidate activities under a nearby candidate stop.
- Put caveats, scores, vehicle warnings, logistics gates, source conflicts, and open validation items in notes.
- Use source coordinates when available.
- Keep source links with each candidate.
- Require user approval before handing the plan to the trip data CLI.

## Workflow

1. Clarify the request:

- start and end locations
- intended season or timing, if known
- desired trip style: efficient, scenic, expedition, family, recovery-heavy, city-light, nature-heavy, or mixed
- approximate duration or desired stop count
- vehicle constraints, especially large expedition truck suitability
- output density: compressed, immersive, or exhaustive

2. Decide the route shape before selecting stops:

- Ambiguous point-to-point routes: compare broad corridors first.
- Official scenic routes: decide scope, direction, and density first.
- Mega-corridors: decompose into phases first.
- Region loops: choose loop direction, base regions, and density first.
- Open-ended route families: compare route concepts before ranking stops.

3. Build the candidate pool with three source layers:

- Route-defining sources: official tourism, road authorities, route guides, guidebooks, ferry or border authorities, national park authorities.
- Stop-discovery sources: iOverlander, park4night, Google Maps reviews and photos, AllTrails, Komoot, Wikiloc, UNESCO, official maps, high-quality blogs and trip reports.
- Validation sources: recent official pages, recent traveller reviews, recent iOverlander or park4night comments, recent YouTube or blog reports, satellite or Street View evidence, current access and restriction pages.

4. Score each candidate:

- 5: essential anchor
- 4: strong stop worth building around
- 3: good optional stop
- 2: practical or resupply stop
- 1: interesting but probably not worth pinning

5. Classify each candidate:

- anchor
- experience
- scenic transit
- practical
- buffer

6. Balance and prune:

- Avoid repeated versions of the same experience.
- Prefer a deliberate mix of iconic anchors, landscape, culture, wildlife, rest, resupply, scenic transit, and practical detours.
- For official scenic routes, choose base stops first and attach discovery points as activities.
- For mega-corridors, research each phase independently and do not produce one global ranked stop list.

7. Produce a route research plan using `schema-reference.md`.

8. Stop for user review. Do not implement until the user explicitly approves implementation.

## Route Shapes

### Ambiguous Point-To-Point

Example: home to Nordkapp.

Compare corridors before selecting stops. Preserve plausible alternatives and recommend one default corridor.

### Official Scenic Route

Example: Wild Atlantic Way.

Do not invent alternate corridors when the canonical route is already defined. Decide:

- full route or section
- direction
- compressed, immersive, or exhaustive density
- base stops versus nested activities

### Mega-Corridor

Example: Pan-American Highway from Alaska to Patagonia.

Decompose into phases before stop selection. Add logistics gates for route discontinuities, borders, vehicle shipping, import limits, permits, ferry constraints, and seasonal road constraints.

### Region Loop

Example: Morocco or Iceland.

Choose loop direction, major regions, and density first. Balance landscapes, towns, recovery stops, and logistics.

### Open-Ended Route Family

Example: best Patagonian overland route.

Compare route concepts before ranking stops. Make assumptions explicit.

## Source Weighting By Region

- North America: Overland Trail Guides, iOverlander, official park sources, Google Maps, recent trip reports.
- South America: iOverlander, official park pages, Google Maps, AllTrails or Komoot, Pan-American blogs.
- Europe: park4night, Google Maps, official tourism and park sites, Komoot, AllTrails, road-trip guides.
- Africa: Tracks4Africa, iOverlander, Bradt, national park sites, overlander blogs, Expedition Portal, Horizons Unlimited.
- Central Asia: Caravanistan-style route intelligence, iOverlander, traveller blogs, YouTube, Wikiloc, Google Maps where coverage is strong.
- Australia and New Zealand: Hema, Wikicamps Australia, iOverlander, national park sites, 4x4 forums, YouTube, official tourism pages.

## Approval-Gated Handoff

After user approval, switch to the trip data workflow:

1. Convert only approved route content to app data.
2. For mega-corridors, implement approved phases or phase subsets rather than flattening the whole speculative route.
3. Convert approved overnight or base candidates to trip stops.
4. Convert approved non-overnight candidates to activities.
5. Store source URLs as stop or activity links.
6. Put scores, vehicle warnings, caveats, timing, costs, logistics gates, and evidence notes into stop or activity notes.
7. Use source coordinates when available.
8. Let the app calculate routes and derived data.
9. Verify with `npm run trip -- get --include-activities --include-links --summary --pretty`.

## References

- See `schema-reference.md` for the plan schema and allowed values.
- See `examples/home-to-nordkapp-example.md` for a compact example output.
- See `../world-tour-trip-data/README.md` for the approved implementation workflow after user approval.
```

- [ ] **Step 3: Verify required sections exist**

Run:

```bash
rg -n "Core Rules|Workflow|Route Shapes|Mega-Corridor|Approval-Gated Handoff" docs/agent-guides/world-tour-route-research/README.md
```

Expected: output includes all five section names.

- [ ] **Step 4: Commit the guide**

Run:

```bash
git add docs/agent-guides/world-tour-route-research/README.md
git commit -m "docs: add route research agent guide"
```

Expected: commit succeeds.

## Task 2: Schema Reference And Example Output

**Files:**
- Create: `docs/agent-guides/world-tour-route-research/schema-reference.md`
- Create: `docs/agent-guides/world-tour-route-research/examples/home-to-nordkapp-example.md`

**Interfaces:**
- Consumes: `docs/agent-guides/world-tour-route-research/README.md`
- Produces: Stable plan schema and example output for local and external agentic environments.

- [ ] **Step 1: Create the examples directory**

Run:

```bash
mkdir -p docs/agent-guides/world-tour-route-research/examples
```

Expected: directory exists.

- [ ] **Step 2: Create the schema reference**

Create `docs/agent-guides/world-tour-route-research/schema-reference.md` with this content:

````markdown
# Route Research Schema Reference

Use this schema for route research plans. Markdown tables are acceptable for human-facing output, but field names should stay stable so another agent can implement the approved plan through the trip data CLI.

## RouteResearchPlan

```json
{
  "routeName": "Home to Nordkapp",
  "start": "Balcombe, West Sussex, UK",
  "end": "Nordkapp, Norway",
  "routeShape": "ambiguous-point-to-point",
  "assumptions": [],
  "corridors": [],
  "recommendedCorridorId": "hybrid-sweden-northern-norway",
  "scopeDecision": null,
  "phases": [],
  "logisticsGates": [],
  "stops": [],
  "openQuestions": [],
  "implementationNotes": []
}
```

## Allowed Values

`routeShape`:

- `ambiguous-point-to-point`
- `official-scenic-route`
- `mega-corridor`
- `region-loop`
- `open-ended-route-family`
- `regional-corridor`

`priority`:

- `must-do`
- `strong`
- `optional`
- `practical`

`classification`:

- `anchor`
- `experience`
- `scenic-transit`
- `practical`
- `buffer`

`vehicleConfidence`:

- `good`
- `check`
- `likely-difficult`

`evidenceLevel`:

- `high`
- `medium`
- `low`

`density`:

- `compressed`
- `immersive`
- `exhaustive`

## CorridorOption

```json
{
  "id": "hybrid-sweden-northern-norway",
  "name": "Hybrid Sweden northbound with scenic northern Norway",
  "summary": "Efficient southern transit, then scenic Arctic Norway.",
  "strengths": ["Fewer ferry dependencies"],
  "tradeoffs": ["Less fjord-heavy than the coast route"],
  "evidenceLevel": "medium",
  "sources": []
}
```

## ScopeDecision

```json
{
  "coverage": "full-route",
  "direction": "north-to-south",
  "density": "immersive",
  "rationale": "The canonical route is already defined, so stop selection should choose base stops along that route.",
  "sectionOptions": []
}
```

## RoutePhase

```json
{
  "id": "central-america",
  "name": "Central America",
  "summary": "Guatemala to Panama, with border and security validation before final routing.",
  "start": "Guatemala",
  "end": "Panama City, Panama",
  "routeShape": "regional-corridor",
  "density": "immersive",
  "corridorOptions": [],
  "logisticsGateIds": ["darien-gap-vehicle-shipping"],
  "candidateStops": [],
  "openQuestions": []
}
```

## LogisticsGate

```json
{
  "id": "darien-gap-vehicle-shipping",
  "name": "Darien Gap vehicle shipping",
  "type": "route-discontinuity",
  "between": ["Panama", "Colombia"],
  "impact": "Vehicle travel is not continuous; plan vehicle shipping and passenger transfer separately.",
  "requiredDecision": "Choose shipping method, ports, agent, and timing before implementing this phase.",
  "vehicleConfidence": "check",
  "evidenceLevel": "high",
  "sources": []
}
```

## CandidateStop

```json
{
  "name": "Alta",
  "countryRegion": "Finnmark, Norway",
  "stopType": ["town", "practical", "buffer"],
  "classification": ["practical", "buffer"],
  "priority": "strong",
  "score": 4,
  "suggestedStay": "1 night",
  "coordinates": { "lat": 69.9689, "lng": 23.2716 },
  "whyItMatters": "Useful Arctic base before Honningsvag and Nordkapp.",
  "vehicleConfidence": "good",
  "evidenceLevel": "medium",
  "notes": "Validate current road and weather conditions close to travel.",
  "sources": [],
  "activities": []
}
```

## CandidateActivity

```json
{
  "title": "North Cape Plateau",
  "activityType": ["landmark", "viewpoint"],
  "priority": "must-do",
  "score": 5,
  "coordinates": { "lat": 71.1695, "lng": 25.783 },
  "whyItMatters": "Symbolic destination at the end of the route.",
  "vehicleConfidence": "check",
  "evidenceLevel": "high",
  "notes": "Winter access may require convoy travel on the final E69 section.",
  "sources": []
}
```

## SourceEvidence

```json
{
  "title": "Visit Nordkapp practical information",
  "url": "https://www.nordkapp.no/practical-info/",
  "sourceType": "official",
  "usedFor": ["seasonal access", "vehicle confidence"],
  "retrievedAt": "2026-07-08",
  "confidence": "high"
}
```

## Implementation Mapping

- Approved `CandidateStop` records become stop drafts for the trip CLI.
- Approved `CandidateActivity` records become activities under the nearest approved stop.
- Candidate and activity `sources.url` values become stop or activity links.
- Scores, vehicle warnings, logistics gates, caveats, and evidence notes become notes.
- Coordinates are passed only when sourced.
- Route geometry is never authored.
````

- [ ] **Step 3: Create the compact Nordkapp example**

Create `docs/agent-guides/world-tour-route-research/examples/home-to-nordkapp-example.md` with this content:

```markdown
# Example Route Research Plan: Home To Nordkapp

This example is compact. It demonstrates structure, not complete research.

## Assumptions

- Home means Balcombe, West Sussex, UK.
- Default style is hybrid: efficient transit through southern Scandinavia, then scenic northern Norway.
- Output density is immersive.
- No app data is written by this plan.

## Route Shape

`ambiguous-point-to-point`

## Corridor Options

| ID | Name | Strengths | Tradeoffs | Evidence |
| --- | --- | --- | --- | --- |
| efficient-sweden-finland | Efficient Sweden and Finland transit | Fewer ferries, reliable long-distance roads | Less Norwegian coast scenery | medium |
| norway-heavy-coast | Norway-heavy scenic coast | Fjords, coastal towns, iconic Norwegian landscapes | More ferries and slower progress | medium |
| hybrid-sweden-northern-norway | Hybrid Sweden northbound with scenic northern Norway | Efficient south, scenic Arctic finish | Misses some fjord-heavy highlights | medium |

Recommended corridor: `hybrid-sweden-northern-norway`.

## Candidate Stops

| Order | Stop | Priority | Score | Stay | Vehicle | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Balcombe | practical | 2 | departure | good | high | Route anchor only. |
| 2 | Hamburg or Lubeck | practical | 2 | 1 night | good | medium | Breaks the long transit through northern Germany. |
| 3 | Copenhagen / Malmo | strong | 3 | 1 night | good | medium | Gateway into Sweden; choose exact base after parking/accommodation validation. |
| 4 | High Coast, Sweden | strong | 4 | 1-2 nights | good | medium | Distinct landscape break on the northbound transit. |
| 5 | Lulea | practical | 2 | 1 night | good | medium | Arctic Sweden resupply and buffer stop. |
| 6 | Rovaniemi | strong | 3 | 1 night | good | medium | Finland Arctic base; useful before the final northern push. |
| 7 | Inari / Saariselka | strong | 4 | 1-2 nights | check | medium | Northern Finland nature base; validate season and road/weather conditions. |
| 8 | Alta | strong | 4 | 1 night | good | medium | Practical Arctic Norway base before Honningsvag and Nordkapp. |
| 9 | Honningsvag | must-do | 4 | 1 night | check | high | Base for North Cape Plateau. Validate road/weather conditions near travel. |

## Candidate Activities

| Stop | Activity | Priority | Score | Vehicle | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Honningsvag | North Cape Plateau | must-do | 5 | check | high | Final destination activity. Winter access may require convoy travel. |

## Open Questions

- Exact travel season.
- Whether the trip should include Lofoten, Senja, or Tromso as a scenic northern Norway detour.
- Whether Copenhagen/Malmo should be a city stop or a practical overnight only.

## Implementation Mapping

- Approved overnight/base rows become trip stops.
- North Cape Plateau becomes an activity under Honningsvag.
- Current official road and access sources should be linked before implementation.
- Route geometry is left to the app.
```

- [ ] **Step 4: Verify references and required fields**

Run:

```bash
rg -n "RouteResearchPlan|RoutePhase|LogisticsGate|CandidateStop|CandidateActivity|SourceEvidence|Implementation Mapping" docs/agent-guides/world-tour-route-research/schema-reference.md
rg -n "Recommended corridor|Candidate Stops|Candidate Activities|Implementation Mapping" docs/agent-guides/world-tour-route-research/examples/home-to-nordkapp-example.md
```

Expected: both commands print the requested section names.

- [ ] **Step 5: Commit schema and example**

Run:

```bash
git add docs/agent-guides/world-tour-route-research/schema-reference.md docs/agent-guides/world-tour-route-research/examples/home-to-nordkapp-example.md
git commit -m "docs: add route research schema and example"
```

Expected: commit succeeds.

## Task 3: Local Codex Skill Wrapper

**Files:**
- Create: `~/.codex/skills/world-tour-route-research/SKILL.md`
- Create: `~/.codex/skills/world-tour-route-research/references/schema-reference.md`
- Create: `~/.codex/skills/world-tour-route-research/agents/openai.yaml`

**Interfaces:**
- Consumes: repo guide at `docs/agent-guides/world-tour-route-research/`
- Produces: local Codex skill discoverable as `world-tour-route-research`.

- [ ] **Step 1: Create local skill directories**

Run:

```bash
mkdir -p ~/.codex/skills/world-tour-route-research/references
mkdir -p ~/.codex/skills/world-tour-route-research/agents
```

Expected: directories exist.

- [ ] **Step 2: Create the local `SKILL.md`**

Create `~/.codex/skills/world-tour-route-research/SKILL.md` with this content:

````markdown
---
name: world-tour-route-research
description: Use when Codex needs to research a potential overland route for the . app before writing trip data, including choosing corridors, scoping official scenic routes, decomposing mega-corridors, scoring candidate stops, identifying activities, citing sources, and preparing an approval-gated route research plan. Use for requests mentioning route research, potential route planning, Nordkapp, Wild Atlantic Way, Pan-American Highway, Patagonia, overland corridors, or candidate stop discovery.
---

# World Tour Route Research

Use this skill to research potential overland routes before any data is written to the world-tour app.

Portable repo guide: `docs/agent-guides/world-tour-route-research/`.

## Core Rules

- Run repo-aware checks from `.` when reading app docs.
- Research first, write later.
- Do not mutate app data from this skill.
- Do not write Supabase rows directly.
- Do not author route geometry or app-derived fields.
- Re-check current ferry, road, border, weather, access, and seasonal restriction facts during each research run.
- Treat overnight or base locations as candidate stops.
- Treat non-overnight sights, hikes, tours, food stops, viewpoints, and experiences as candidate activities under a nearby candidate stop.
- Put caveats, scores, vehicle warnings, logistics gates, source conflicts, and open validation items in notes.
- Use source coordinates when available.
- Keep source links with each candidate.
- Require user approval before handing the plan to the trip data CLI.

## Workflow

1. Read the repo guide:

```bash
sed -n '1,260p' docs/agent-guides/world-tour-route-research/README.md
```

2. Read the schema reference when producing a plan:

```bash
sed -n '1,260p' docs/agent-guides/world-tour-route-research/schema-reference.md
```

3. Clarify the request only as much as needed. If context is missing, make conservative assumptions and list them.

4. Decide route shape before selecting stops:

- ambiguous point-to-point: compare corridors
- official scenic route: decide scope, direction, and density
- mega-corridor: decompose into phases and logistics gates
- region loop: choose loop direction, base regions, and density
- open-ended route family: compare route concepts

5. Research with current sources and cite every source used.

6. Produce a route research plan using the schema reference.

7. Stop for user review. Do not call `npm run trip -- ...` unless the user explicitly approves implementation.

8. After approval, switch to `world-tour-trip-data`.

## Reference

Read `references/schema-reference.md` if the repo guide is unavailable.

## Failure Handling

- If current sources disagree, record the conflict.
- If source quality is weak, mark evidence level `low`.
- If a route has a discontinuity or hard logistical constraint, add a logistics gate rather than pretending it is a normal stop.
- If the route is too broad, split it into corridors, sections, or phases before selecting final stops.
- If output would be too large, produce one phase or section first and ask for approval before expanding.
````

- [ ] **Step 3: Copy the schema reference into the local skill**

Run:

```bash
cp docs/agent-guides/world-tour-route-research/schema-reference.md ~/.codex/skills/world-tour-route-research/references/schema-reference.md
```

Expected: local reference exists.

- [ ] **Step 4: Create local skill display metadata**

Create `~/.codex/skills/world-tour-route-research/agents/openai.yaml` with this content:

```yaml
interface:
  display_name: "World Tour Route Research"
  short_description: "Research candidate overland routes before app writes"
  default_prompt: "Use $world-tour-route-research to research a possible world-tour route and produce an approval-gated stop plan."
```

- [ ] **Step 5: Validate local skill metadata**

Run:

```bash
uv run --with PyYAML python - <<'PY'
from pathlib import Path
import yaml

root = Path('~/.codex/skills/world-tour-route-research')
skill = root / 'SKILL.md'
agent = root / 'agents' / 'openai.yaml'
reference = root / 'references' / 'schema-reference.md'

assert skill.exists(), skill
assert agent.exists(), agent
assert reference.exists(), reference

text = skill.read_text()
assert text.startswith('---\n'), 'SKILL.md must start with YAML front matter'
frontmatter = text.split('---', 2)[1]
metadata = yaml.safe_load(frontmatter)
assert metadata['name'] == 'world-tour-route-research'
assert 'route' in metadata['description'].lower()
assert 'Do not mutate app data' in text

agent_data = yaml.safe_load(agent.read_text())
assert agent_data['interface']['display_name'] == 'World Tour Route Research'
print('world-tour-route-research skill metadata ok')
PY
```

Expected: prints `world-tour-route-research skill metadata ok`.

- [ ] **Step 6: Verify the skill appears in local file discovery**

Run:

```bash
find ~/.codex/skills/world-tour-route-research -maxdepth 3 -type f | sort
```

Expected output includes:

```text
~/.codex/skills/world-tour-route-research/SKILL.md
~/.codex/skills/world-tour-route-research/agents/openai.yaml
~/.codex/skills/world-tour-route-research/references/schema-reference.md
```

- [ ] **Step 7: Commit repo docs if they are not already committed**

Run:

```bash
git status --short
```

Expected: no local skill files appear because they live outside the repo. If repo guide files are uncommitted, run:

```bash
git add docs/agent-guides/world-tour-route-research
git commit -m "docs: add route research skill guide"
```

Expected: commit succeeds or no repo files remain to commit.

## Task 4: End-To-End Dry Run

**Files:**
- Read: `docs/agent-guides/world-tour-route-research/README.md`
- Read: `docs/agent-guides/world-tour-route-research/schema-reference.md`
- Read: `~/.codex/skills/world-tour-route-research/SKILL.md`

**Interfaces:**
- Consumes: repo guide, schema reference, local skill wrapper.
- Produces: proof that the guide and local skill support the expected workflow without app mutation.

- [ ] **Step 1: Verify route shape rules are present**

Run:

```bash
rg -n "Ambiguous Point-To-Point|Official Scenic Route|Mega-Corridor|Region Loop|Open-Ended Route Family" docs/agent-guides/world-tour-route-research/README.md
```

Expected: each route shape appears once.

- [ ] **Step 2: Verify approval-gated language appears in both repo and local skill**

Run:

```bash
rg -n "Do not mutate app data|Require user approval|After approval" docs/agent-guides/world-tour-route-research/README.md ~/.codex/skills/world-tour-route-research/SKILL.md
```

Expected: output includes both files.

- [ ] **Step 3: Verify example output stays research-only**

Run:

```bash
rg -n "No app data is written|Route geometry is left to the app|Implementation Mapping" docs/agent-guides/world-tour-route-research/examples/home-to-nordkapp-example.md
```

Expected: all three phrases appear.

- [ ] **Step 4: Verify repo status**

Run:

```bash
git status --short
```

Expected: clean worktree after committed repo docs.

- [ ] **Step 5: Report readiness**

In the final implementation response, report:

- repo guide path
- local skill path
- validation command result
- whether the repo worktree is clean
- that the skill is research-only and hands off to `world-tour-trip-data` after approval
