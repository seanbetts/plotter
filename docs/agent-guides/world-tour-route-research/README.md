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
