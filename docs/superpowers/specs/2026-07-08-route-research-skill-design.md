# Route Research Skill Design

Date: 2026-07-08

## Goal

Create a repeatable AI-agent workflow for researching potential overland routes before they are written into the world-tour app.

The new route research skill turns a route idea, region, or corridor into a structured candidate stop plan. It does not mutate app data directly. After the user approves the plan, the existing trip data skill and CLI can create or amend the app trip.

## Design Principles

- Research first, write later.
- Keep route judgement separate from app mutation.
- Produce inspectable artifacts with source links and explicit confidence.
- Let the app calculate derived data such as routes, geometry, normalized locations, timestamps, link previews, and sort order.
- Treat overnight or base locations as candidate stops.
- Treat non-overnight sights, hikes, tours, food stops, viewpoints, and experiences as candidate activities under a nearby stop.
- Preserve uncertainty in notes rather than inventing structure.
- Prefer current, primary, official, or traveller-validated sources for facts that can change.
- Require user approval before handing the plan to the trip data CLI.

## Skill Boundary

The route research skill owns:

- clarifying the route goal and constraints
- choosing or comparing broad route corridors
- finding candidate stops and activities
- scoring, classifying, pruning, and balancing candidates
- citing sources and marking evidence quality
- producing an implementation-ready route research plan

The route research skill does not own:

- creating, deleting, or updating trips in Supabase
- writing route geometry
- deciding final route alternatives for individual app route legs
- uploading images or media
- bypassing the trip CLI

When the user approves an implementation-ready plan, the agent should switch to the existing `world-tour-trip-data` workflow and use `npm run trip -- ...` commands.

## Workflow

### 1. Clarify The Request

Capture the minimum context needed to research the route:

- start and end locations
- intended season or timing, if known
- desired trip style: efficient, scenic, expedition, family, recovery-heavy, city-light, nature-heavy, or mixed
- approximate duration or desired stop count
- vehicle constraints, especially large expedition truck suitability
- whether the output should be compressed, immersive, or exhaustive

If some context is missing, use conservative defaults and call them out in the plan.

### 2. Decide The Route Corridor

For long, cross-border, or ambiguous trips, compare corridors before selecting stops.

Example: a home-to-Nordkapp request should not immediately produce one stop list. It should first compare corridors such as:

- efficient Nordic transit through Germany, Denmark, Sweden, Finland, and northern Norway
- Norway-heavy scenic route using Denmark-Norway ferries and the Norwegian coast
- hybrid route using efficient transit for the south and scenic northern Norway for the final third

The skill should recommend one corridor by default and preserve plausible alternatives in the plan. Short or obvious routes may skip this phase.

### 3. Build The Candidate Pool

Use three source layers.

Route-defining sources identify the canonical shape:

- official tourism and road authority pages
- route guides and guidebooks
- well-known overland route sources
- ferry, border, or national park authorities
- region-specific authorities such as Visit Norway, National Park Service, Parks Canada, Hema, Tracks4Africa, Bradt, or Caravanistan-style resources

Stop-discovery sources find places worth pinning:

- iOverlander
- park4night
- Google Maps reviews and photos
- AllTrails, Komoot, Wikiloc, and similar outdoor sources
- UNESCO and official heritage or park maps
- high-quality blogs, trip reports, and regional guides

Validation sources reduce bad candidates:

- recent official pages
- recent traveller reviews and photos
- recent iOverlander or park4night comments
- recent YouTube or blog trip reports
- satellite, Street View, or mapping evidence
- local restrictions, seasonal access, ferry schedules, or road condition pages

Use source weighting by region. For example:

- North America: Overland Trail Guides, iOverlander, official park sources, Google Maps, recent trip reports.
- South America: iOverlander, official park pages, Google Maps, AllTrails or Komoot, Pan-American blogs.
- Europe: park4night, Google Maps, official tourism and park sites, Komoot, AllTrails, road-trip guides.
- Africa: Tracks4Africa, iOverlander, Bradt, national park sites, overlander blogs, Expedition Portal, Horizons Unlimited.
- Central Asia: Caravanistan-style route intelligence, iOverlander, traveller blogs, YouTube, Wikiloc, Google Maps where coverage is strong.
- Australia and New Zealand: Hema, Wikicamps Australia, iOverlander, national park sites, 4x4 forums, YouTube, official tourism pages.

### 4. Score And Classify Candidates

Each candidate should be scored across:

- iconic value
- landscape or experience value
- route usefulness
- overlander evidence
- vehicle confidence
- redundancy or variety

Use a simple five-point score:

- 5: essential anchor
- 4: strong stop worth building around
- 3: good optional stop
- 2: practical or resupply stop
- 1: interesting but probably not worth pinning

Classify each candidate as one or more of:

- anchor
- experience
- scenic transit
- practical
- buffer

Also capture:

- stop type, such as landscape, town, national park, resupply, cultural, wildlife, scenic road, ferry, border, or recovery stop
- priority: must-do, strong, optional, or practical
- suggested stay: half day, 1 night, 2 to 3 nights, 1 week, or another plain-language duration
- vehicle confidence: good, check, or likely difficult
- evidence level: high, medium, or low
- rationale
- sources

### 5. Balance And Prune

Before producing the final route plan, remove duplicates and balance the route.

The plan should avoid over-representing repeated versions of the same experience. If a corridor has five similar lake stops, keep the strongest two and downgrade or omit the rest.

The final route should usually include a deliberate mix of:

- iconic route anchors
- memorable landscapes
- towns and culture
- wildlife or nature
- water, coast, mountains, desert, or forest, depending on region
- rest and resupply
- scenic transit sections
- unusual but practical detours

### 6. Produce The Route Research Plan

The skill outputs a structured route research plan for user review.

The plan should include:

- route name
- assumptions
- corridor options considered
- recommended corridor
- rejected or alternate corridors
- ordered candidate stops
- candidate activities grouped under stops
- source evidence
- open questions
- implementation mapping for the trip CLI

The plan must be usable by an agent without rereading every source. It should include enough citations, notes, coordinates, and caveats to support review.

### 7. Approval-Gated Handoff

The skill stops after presenting the route research plan.

If the user approves implementation, the agent should use the existing trip data skill:

1. Convert approved overnight/base candidates to trip stops.
2. Convert approved non-overnight candidates to activities.
3. Store source URLs as stop or activity links.
4. Put scores, vehicle warnings, caveats, timing, costs, and evidence notes into stop or activity notes.
5. Use source coordinates when available.
6. Let the app calculate routes and derived data.
7. Verify with `npm run trip -- get --include-activities --include-links --summary --pretty`.

## Output Schema

The route research plan can be written in Markdown for human review, with embedded JSON-like structures or tables. The implementation mapping should use stable field names.

### RouteResearchPlan

```json
{
  "routeName": "Home to Nordkapp",
  "start": "Balcombe, West Sussex, UK",
  "end": "Nordkapp, Norway",
  "assumptions": [
    "Home means Balcombe.",
    "Default style is hybrid: efficient transit plus scenic northern Norway."
  ],
  "corridors": [],
  "recommendedCorridorId": "hybrid-sweden-northern-norway",
  "stops": [],
  "openQuestions": [],
  "implementationNotes": []
}
```

### CorridorOption

```json
{
  "id": "hybrid-sweden-northern-norway",
  "name": "Hybrid Sweden northbound with scenic northern Norway",
  "summary": "Efficient southern transit, then scenic Arctic Norway.",
  "strengths": ["Fewer ferry dependencies", "Good Arctic highlights"],
  "tradeoffs": ["Less fjord-heavy than the coast route"],
  "evidenceLevel": "medium",
  "sources": []
}
```

### CandidateStop

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

### CandidateActivity

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

### SourceEvidence

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

## Artifact Locations

The repo should keep portable instructions in:

```text
docs/agent-guides/world-tour-route-research/
```

That guide should be usable by any agentic environment.

The local Codex skill may live at:

```text
~/.codex/skills/world-tour-route-research/
```

The local skill should point back to the repo guide, just as the trip data skill does.

Generated route research outputs should not be committed by default. They can live in `/tmp`, an Obsidian note, or a user-chosen planning folder unless the user explicitly asks to keep them in the repo.

## Error Handling And Quality Rules

- Re-check current ferry, road, border, weather, access, and seasonal restriction facts during each research run.
- If source quality is weak, mark the candidate low confidence.
- If coordinates conflict, prefer official coordinates or map coordinates from the most specific source and record the conflict.
- If a route depends on ferries, seasonal roads, borders, or convoys, mark that as a validation item.
- If a stop sounds good but lacks recent validation, do not promote it to must-do.
- If a candidate is unsuitable for a large vehicle, keep it only if there is a realistic parking/base alternative.
- If research sources disagree, do not smooth over the conflict; record it in notes.
- If the route is too broad, split it into corridors or phases before selecting final stops.

## Stress Test Expectations

The design should handle these route shapes:

- single-corridor scenic road, such as the North Coast 500
- long point-to-point expedition route, such as home to Nordkapp
- multi-country overland corridor, such as Europe to Central Asia
- region loop, such as Morocco or Iceland
- open-ended route family, such as "best Patagonian overland route"

For long or ambiguous examples, the skill must make corridor selection explicit before stop selection.

## Future App Opportunities

This skill is intentionally outside the app for v1, but it creates useful future paths:

- an in-app "research this route" chat flow
- route research plan import previews
- candidate stop staging before writing to the real trip
- source/evidence display inside stop notes or a dedicated research panel
- separate validation passes for ferries, borders, seasons, and vehicle restrictions

Those are not required for v1.

## Testing The Skill

Initial verification should be example-driven:

1. Ask the skill for a home-to-Nordkapp route.
2. Confirm it compares corridors before stop selection.
3. Confirm it produces candidate stops, activities, scores, evidence, and links.
4. Confirm it does not write app data.
5. Approve a small subset and verify the existing trip data skill can implement it through the CLI.

The first implementation should include at least one saved example output in the skill or guide documentation so future agents can see the expected standard.
