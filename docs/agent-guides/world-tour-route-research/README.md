# World Tour Route Research Agent Guide

Use this guide when an AI agent needs to research a potential overland route before any data is written to the world-tour app.

This guide is research-only. It produces a reviewable route research plan. It does not create, delete, or update trips. After the user approves a plan, use the `world-tour-trip-data` guide and `npm run trip -- ...` CLI commands to implement approved content.

## Core Rules

- Research first, write later.
- Do not mutate app data from this guide.
- Do not write Supabase rows directly.
- Do not author route geometry or app-derived fields.
- Assume automatic driving routing between adjacent stops, including ordinary ferries, tunnels, bridges, and vehicle shuttles that a normal road route can contain.
- Emit shipping-manual only for a genuine physical discontinuity or independent vehicle-shipping transfer that automatic driving routing cannot represent.
- Re-check current ferry, road, border, weather, access, and seasonal restriction facts during each research run.
- Treat overnight or base locations as candidate stops.
- Treat non-overnight sights, hikes, tours, food stops, viewpoints, and experiences as candidate activities under a nearby candidate stop.
- Put caveats, scores, vehicle warnings, logistics gates, source conflicts, and open validation items in notes.
- Recommend stop and activity tags only from the controlled tag vocabulary, preserving approved route variants, constraints, themes, and practical roles for handoff without over-tagging.
- Use source coordinates when available.
- Keep source links with each candidate.
- Keep source evidence internally even when the user-facing answer only shows compact citations.
- Keep the rich schema as the agent handoff artifact. The default user-facing output should be decision-oriented, not a schema dump.
- Recommend the route's natural duration after choosing and balancing its worthwhile content. Do not ask for a duration merely to begin planning.
- Treat a user-supplied duration as a preference unless the user clearly describes it as fixed, exact, or a maximum.
- If a preferred duration differs from the recommendation, explain the scope, pace, corridor, or activity trade-off before producing that variant.
- If a hard duration limit cannot hold the proposed route comfortably, reduce scope or explicitly make the trip transit-heavy; do not compress every stay silently.
- Use the smallest research depth that answers the request. Explicit depth requests or clear itinerary wording set the target depth. An unresolved high-consequence corridor or hard feasibility decision may temporarily cap the response at `sketch`; ordinary agent-owned choices such as loop direction, base regions, and density do not. Route-shape defaults apply only when the prompt does not otherwise establish depth.
- Ask the user only for high-consequence decisions. Make conservative agent-owned decisions explicit in assumptions.
- Treat this guide as the domain-specific brainstorming workflow for live route planning. Do not layer a generic brainstorming or one-question-at-a-time discovery workflow on top of it.
- Give the user a useful route recommendation after at most one compact clarification round. Ask a second follow-up only when one unresolved answer would make every plausible route unsafe or non-viable.
- When the user asks the agent to recommend a parameter such as duration, pace, direction, or density, recommend a default and continue instead of returning the decision as another prerequisite question.
- Treat dimensions, booking details, tyre rules, timetables, and similar operational details as explicit assumptions or scoped validation items unless the missing fact could invalidate the recommended corridor. Resolve a corridor-invalidating fact before presenting a detailed candidate plan; a light sketch may show what remains viable while asking one focused question.
- Give an approximate driving-intensity summary for a candidate itinerary: estimated total distance or range when useful, the overall driving-day pattern, and the longest or most ambitious legs. Label estimates as provisional because the app calculates routes precisely at implementation time.
- Do not inspect route-specific examples or prior route outputs while answering a live request. Files under `examples/` are synthetic validation fixtures for skill development, not planning context or research evidence.
- Do not search memory, prior task transcripts, or previous route plans for destination-specific facts, assumptions, or recommendations unless the user explicitly asks to continue or review that work. If the host requires a memory pass, query only app and workflow conventions; do not include destination names, countries, route names, or prior itinerary terms in the memory query. Current route claims must come from the user's request and fresh research.
- In a recommended spine, choose a single default base or phase for each position. Keep meaningful route variants in the alternatives section instead of leaving ordinary stop choices as slash-separated or "A or B" options.
- Keep the recommended spine to overnight bases or route phases. If the endpoint or sight is not an overnight location, nest it as an activity under the final base rather than promoting it to a stop.
- Require user approval before handing the plan to the trip data CLI.

## Workflow

1. Clarify the request only as much as needed. Use one compact clarification round before the first useful route output. A second follow-up is allowed only when one unresolved answer would make every plausible route unsafe or non-viable:

- start and end locations
- intended season or timing, if known
- desired trip style: efficient, scenic, expedition, family, recovery-heavy, city-light, nature-heavy, or mixed
- any fixed, exact, or maximum duration the user has already specified
- vehicle constraints, especially large expedition truck suitability
- desired research depth, if the user has a preference

Do not ask for every item in this list. Ask only for missing information that materially changes feasibility or the recommended corridor. If an unanswered fact could invalidate the recommended corridor, keep the response at a useful sketch and ask one focused question before producing a detailed candidate plan. If the user asks what duration, pace, direction, or density you recommend, choose a conservative default and proceed. Preserve non-blocking operational unknowns as assumptions or scoped validation items.

2. Choose the smallest useful research depth:

- `sketch`: route shape, recommended direction or corridor, key alternatives, hard blockers, and a small candidate spine.
- `candidate-plan`: enough stops, activities, tags, sources, and logistics notes for the user to review the proposed trip.
- `handoff-ready`: the approved research artifact with stable fields, source links, `placeQuery` or sourced coordinates, and notes ready for trip data review. This is not permission to write app data.

Choose the target depth from an explicit depth request or clear itinerary wording first. Use route-shape defaults only when the request does not otherwise establish depth. An unresolved high-consequence corridor, hard feasibility question, or expedition viability decision may temporarily cap the current response at `sketch`, even when the target is deeper; explain what must be approved or resolved before expanding. Do not cap the target depth merely to make ordinary agent-owned choices such as loop direction, base regions, density, or practical overnight bases. Use `handoff-ready` only after the route direction is approved or the user explicitly asks for handoff detail. Do not switch to the trip data guide or run the trip CLI until the user gives a separate final approval such as "implement this approved plan."

Older references to `implementation-ready` mean `handoff-ready`. Do not emit `implementation-ready` in new route research plans.

| Depth | Use When | User-Facing Size | Sources | Stops And Activities |
| --- | --- | --- | --- | --- |
| `sketch` | The route is broad, ambiguous, or early-stage. | Recommendation, 1-3 alternatives, blockers, and next decision. | Cite route-defining, advisory, operator, and blocker sources that are named in the answer. No full source table by default. | About 3-7 spine stops or phases. Activities only if they change the route decision. |
| `candidate-plan` | The user wants a reviewable trip plan. | Recommendation, material variants, compact stop/activity preview, and approval question. | Cite key route, stop, and validation sources. Full source table can stay in the handoff artifact. | Enough ordered stops for the proposed route or phase. Activities should be selective and nested under stops. |
| `handoff-ready` | Direction is approved or the user asks to prepare a handoff artifact. | Short summary plus any remaining approval questions. | Stable source IDs, source URLs, `placeQuery` or sourced coordinates, and notes ready for review. | Ordered stops and nested activities that can be converted by the trip data guide after final write approval. |

Route shape defaults:

| Route Shape | Default Depth | Expected Output |
| --- | --- | --- |
| Ambiguous point-to-point | `sketch` until corridor approval | Compare corridors, recommend one default, and show a light single-choice spine; expand the approved corridor to `candidate-plan`. |
| Simple scenic road trip | `sketch` | Short recommendation, light stop spine, and routine validations unless the prompt asks for a reviewable itinerary. |
| Official scenic route | `candidate-plan` | Scope, direction, phases if long, base stops, selective nested activities. |
| Mega-corridor or blocked corridor | `sketch` | Phase or corridor viability, blockers, restart options; no stops for blocked phases. |
| Region loop | `sketch` | When no depth is implied, choose loop direction, base regions, and density in a light sketch. For a requested itinerary, make those agent-owned choices inside the `candidate-plan`. |
| Regional corridor | `sketch` | Compare practical alignments, borders or access constraints, and anchors before detailed stop selection. |
| Open-ended route family | `sketch` | Route concepts and corridor viability before stop ranking. |
| Remote expedition track | `sketch` | Expedition viability first; stops only after logistics are researchable. |

Depth requirements:

| Depth | Required Fields Or Sections |
| --- | --- |
| `sketch` | Recommendation, material alternatives, blockers or validations, next decision, and about 3-7 spine stops, phases, or corridor options when useful. Full source tables, scoring, and tags are optional. |
| `candidate-plan` | Ordered candidate stops or phases, selective nested activities, approved tag suggestions, key source IDs or links, logistics gates with severity and scope, and open questions. Default to one phase or about 8-15 stops unless the user asks for exhaustive detail. |
| `handoff-ready` | Everything needed for trip-data review: canonical stop order, parent activity mapping, stable `sourceEvidence`, `placeQuery` or sourced coordinates where available, source IDs, logistics gate scope, notes, unsupported data, and implementation notes. |

Implicit depth consent:

- "Give me options", "which route would you take", or "is this viable?" means `sketch`.
- "Plan a route", "make me a 10-day trip", or "build a reviewable itinerary" sets a `candidate-plan` target. If a corridor or hard feasibility choice is unresolved, answer first at `sketch` and state what unlocks the target depth.
- "Prepare this for handoff", "make this import-ready", or "turn the approved plan into trip data inputs" means `handoff-ready`, but still requires separate final approval before app writes.

3. Decide the route shape before selecting stops:

- Ambiguous point-to-point routes: compare broad corridors first.
- Official scenic routes: decide scope, direction, and density first.
- Mega-corridors: decompose into phases first.
- Region loops: choose loop direction, base regions, and density first.
- Open-ended route families: compare route concepts and corridor viability before ranking stops.
- Remote expedition tracks: prove logistics viability before candidate stop selection.

4. Build the candidate pool with three source layers:

- Route-defining sources: official tourism, road authorities, route guides, guidebooks, ferry or border authorities, national park authorities.
- Stop-discovery sources: iOverlander, park4night, Google Maps reviews and photos, AllTrails, Komoot, Wikiloc, UNESCO, official maps, high-quality blogs and trip reports.
- Validation sources: recent official pages, recent traveller reviews, recent iOverlander or park4night comments, recent YouTube or blog reports, satellite or Street View evidence, current access and restriction pages.

Maintain source-backed candidates and gates even when the visible response stays compact. In `sketch` and `candidate-plan`, route-defining claims, safety or advisory claims, operator/logistics claims, anchor stops, material activities, and validation gates should be traceable to source IDs or links. The full `sourceEvidence` table can remain in the handoff artifact unless the user asks to inspect it.

Do not name a specific external authority, advisory, ferry, shipper, operator, permit body, or official route source in the user-facing answer unless the visible answer includes a link or the handoff artifact records a matching `sourceEvidence` entry.

5. Score each candidate:

- 5: essential anchor
- 4: strong stop worth building around
- 3: good optional stop
- 2: practical or resupply stop
- 1: interesting but probably not worth pinning

6. Classify each candidate:

- anchor
- experience
- scenic transit
- practical
- buffer

7. Recommend tags for each candidate from the controlled vocabulary:

- Route variants: `official-route`, `practical-route`, `adventure-variant`, `optional-detour`.
- Access and logistics: `road-status-check`, `seasonal-access`, `permit-or-booking`, `border-crossing`, `high-clearance-4wd`.
- Stop roles: `resupply`, `recovery-stop`, `buffer-stop`.
- Experience themes: `history`, `nature`, `coast`, `mountains`, `gorge`, `caves`, `wildlife`, `culture`, `food`, `walk`, `viewpoint`.

Use the fewest tags that materially help routing, filtering, UI badges, or handoff. Do not apply broad experience tags to every stop on a route just because the whole route has that theme. For official scenic routes, `official-route` may be common across base stops, but experience tags should describe what makes the specific stop or activity distinctive. Prefer activity-level tags when the theme belongs to a sight, walk, meal, or viewpoint rather than the overnight base.

Do not invent new tags during research. If a useful detail does not fit the controlled vocabulary, put it in `notes`, `logisticsGates`, or `openQuestions`.

If the same missing concept appears repeatedly across routes, add it to `implementationNotes` as a proposed tag addition. Do not use proposed tags in candidate `tags` until the controlled vocabulary is explicitly updated.

Candidate future tags backlog: `city`, `scenic-drive`, `ferry`, `camping`, `lake`, `desert`, and `beach`. These are not part of the controlled vocabulary until explicitly promoted.

8. Balance and prune:

- Avoid repeated versions of the same experience.
- Prefer a deliberate mix of iconic anchors, landscape, culture, wildlife, rest, resupply, scenic transit, and practical detours.
- For official scenic routes, choose base stops first and attach discovery points as activities.
- For mega-corridors, research each phase independently and do not produce one global ranked stop list.
- For remote expedition tracks, complete the logistics viability pass before scoring stops. Treat camps, wells, fuel points, exit tracks, and recovery towns as practical anchors rather than attractions.
- When adding logistics gates, set severity and scope by consequence: `blocking-decision` when an unresolved condition invalidates the affected route until it is resolved or avoided, `pre-implementation-check` for non-invalidating issues that must be resolved before writing affected data, and `travel-time-validation` for routine checks close to travel.
- Add `travel-time-validation` notes or gates for ambitious days or phases that combine long driving, ferry dependency, seasonal roads, remote access, or several major activities. Scope the validation to the affected day, phase, stop pair, or variant; do not turn it into a blocker unless the travel-time uncertainty changes the route choice.
- Summarize the route's estimated driving burden at candidate-plan depth. Keep this decision-oriented rather than listing a calculated distance for every leg.
- Treat one-day stops primarily as departure, arrival, transit, resupply, or buffer stops. Give activity bases enough time for their activities beyond the surrounding driving burden.

9. Derive the recommended duration after balancing candidates. At this point, recommend the route's natural duration from realistic relocation days, activity bases, recovery and resupply needs, and material weather, ferry, border, or remote-road buffers. Keep estimated driving burden in research; leave precise route calculations to the app. At handoff-ready depth, choose exact `expectedStayDays` values whose sum equals `plannedDurationDays`.

10. Present the user-facing plan first. Do not include the handoff artifact unless the user asks for it or another agent needs the handoff contract.

11. Stop for user review. Do not implement until the user explicitly approves implementation.

## User-Facing Output

Default output should be easy to scan:

1. Recommended route or direction, with a short rationale.
2. Material alternatives or variants, only if they change the trip.
3. Hard blockers, unresolved decisions, or time-sensitive validation items.
4. A compact stop and activity preview at the chosen research depth, with overnight bases or phases in the spine and non-overnight endpoints or sights nested as activities.
5. A short provisional driving-intensity summary when presenting a candidate itinerary.
6. One focused approval question about the remaining material route decision. State conservative defaults separately instead of bundling routine assumptions into the question. End with this question rather than a generic invitation or a menu of possible next details.

Keep route-shape labels, internal field names, evidence details, and full JSON-like structures out of the main response unless they help the user make a decision or the user asks for handoff-ready output. Use the schema reference as the stable handoff contract between agents.

## Decision Ownership

The agent should decide:

- route shape and whether phases, corridors, or expedition viability are needed
- source weighting, evidence level, candidate scoring, and pruning
- stop versus activity classification
- default tags from the controlled vocabulary
- routine validation notes that do not change the route choice
- a recommended default route when the trade-offs are clear
- ordinary base and stop choices within the recommended route
- a conservative duration, pace, direction, or density when the user asks for a recommendation
- the route's naturally paced recommended duration and, at handoff-ready depth, the exact `plannedDurationDays` and `expectedStayDays` allocation
- conservative placeholders for non-blocking operational details, recorded as assumptions or validation items

The user should decide:

- high-consequence corridor, direction, or route variant choices
- season, vehicle, safety, comfort, or border-risk choices that materially affect feasibility
- whether to skip, defer, ship, overfly, or restart around a blocked phase
- whether to expand from `sketch` to `candidate-plan` or from `candidate-plan` to `handoff-ready`
- final approval before any trip data is written

Phrase user decisions in plain travel terms, not schema terms.

The agent may recommend a default route, but the user must approve choices that materially change safety, border exposure, season, vehicle suitability, budget, or the character of the trip.

Treat a user-supplied duration as a preference unless it is clearly fixed, exact, or a maximum. When a preferred duration differs from the recommendation, explain the scope, pace, corridor, or activity trade-off before producing that variant. For a hard duration limit that cannot hold the route comfortably, reduce scope or explicitly make the trip transit-heavy rather than silently compressing every stay.

Interaction budget:

- Before the first useful recommendation, ask at most one compact clarification round.
- A second follow-up is permitted only when a single unresolved answer would make every plausible route unsafe or non-viable. State why it blocks planning.
- Do not serially collect operational details. Dimensions, tyre specification, booking classification, ferry category, and similar facts normally become scoped checks attached to the affected route or phase. Ask before detailing a recommended corridor only when the missing fact could make that corridor unsuitable.
- A request for the agent's recommendation is permission to choose a conservative default, explain it, and continue.
- If the user signals impatience or asks for the route, stop discovery immediately, state assumptions, and provide the smallest useful plan.

Ask versus assume examples:

- Assume mixed scenic/practical style if the user gives no preference.
- Assume routine road, ferry, weather, and access checks can be preserved as validation notes only when current evidence does not invalidate the affected route.
- Ask before choosing border exposure through Russia, Iran, the Sahel, active conflict areas, or other materially risky corridors.
- Ask before committing to winter remote driving, remote high-clearance 4WD tracks, vehicle shipping, major ferry-dependent variants, or carnet/customs-heavy routes when the prompt has not already established that choice.
- Ask before expanding from a light `sketch` into `handoff-ready` detail unless the user has already requested a writeable handoff artifact.

## Logistics Gate Handoff

Gate severity controls implementation behavior for the route content the gate applies to:

- `blocking-decision`: do not write affected stops or activities while an unresolved condition invalidates the route. Resolve the condition or have the user choose a viable alternative such as a restart, skip, shipping, overfly, or deferral.
- `pre-implementation-check`: research may continue, but resolve the issue before writing affected trip data. Preserve it as a note only when the uncertainty does not invalidate the route and the user explicitly accepts it.
- `travel-time-validation`: safe to write approved trip data; preserve the check as a stop, activity, or implementation note to refresh close to travel.

Classify by consequence, not by whether the wording happens to involve a user preference. A current closure, unavailable required authorization, confirmed restricted access, broken physical continuity, or safety condition that makes the affected route non-viable is blocking. A routinely obtainable permit, booking, timetable, or operational detail may remain a pre-implementation check when failure would not invalidate the approved route.

A gate only blocks the route, phase, or variant it applies to. Do not present a conditional gate on an unchosen variant as a blocker for the recommended route.

For mega-corridors, a gate in one phase should not stop planning or writing researchable phases. State which phases can be researched or implemented now, which phase is blocked or deferred, and what must be resolved or decided for the affected phase.

## Route Shapes

### Ambiguous Point-To-Point

Example: home to a remote endpoint with two materially different corridors.

Start at `sketch` unless the user has already approved a corridor. Compare corridors before selecting detailed stops, preserve plausible alternatives, and recommend one default corridor. The recommended spine should contain one default base or phase at each position; resolve ordinary choices such as neighbouring overnight towns yourself and keep only material route variants in the alternatives section.

State route-defining defaults in plain travel terms, then ask about only the unresolved material choice. For example: "I’ll assume a summer trip at a mixed pace. Should I develop the efficient inland corridor?" After approval, expand that corridor to `candidate-plan`.

### Official Scenic Route

Example: a signed national coastal route.

Do not invent alternate corridors when the canonical route is already defined. Decide:

- full route or section
- direction
- compressed, immersive, or exhaustive density
- base stops versus nested activities

If the official route has meaningful practical or adventure variants, keep the route model canonical and express the variants with stop and activity tags first.

For long official routes, keep the route canonical but split it into phases before candidate stop selection. Do not flatten a multi-region official route into one global ranked stop list.

### Mega-Corridor

Example: a continent-spanning overland corridor with a physical discontinuity.

Decompose into phases before stop selection. Add logistics gates for route discontinuities, borders, vehicle shipping, import limits, permits, ferry constraints, safety advisories, and seasonal road constraints.

A mega-corridor `sketch` should include:

- recommended strategy or spine
- 2-3 material alternatives, such as scenic-practical, fastest-practical, sectional/restart, seasonal reversal, shipping/overfly, or skip/defer options
- phase list with high-level status for each phase: researchable, blocked, or deferred; attach scoped gates to researchable phases that still need checks
- logistics gates with affected phase, severity, required decision, and source link or source ID
- clear statement of which phases can be developed next without resolving unrelated gates
- next user decision in plain travel terms

#### Blocked Mega-Corridors

If a phase is blocked by current travel advice, active conflict, border closure, vehicle shipping or import constraints, or seasonal closure, do not produce a single continuous stop list. Mark the phase as `blocked` or `deferred`, add the relevant logistics gate, and propose restart options such as overflying, vehicle shipping, restarting with a rental or local vehicle, or deferring the route. Produce candidate stops only for phases that are researchable or explicitly approved. Continue planning unaffected phases when the user asks for them.

### Region Loop

Example: a country-scale scenic loop.

Choose loop direction, major regions, and density first. Balance landscapes, towns, recovery stops, and logistics.

Loop direction, base regions, and density are agent-owned unless they materially change safety, vehicle suitability, border exposure, budget, or trip character. Do not downgrade an explicitly requested itinerary to `sketch` merely to make these ordinary choices.

### Regional Corridor

Example: a capital-to-capital regional crossing or a named cross-country corridor.

Use this when the route is narrower than a mega-corridor but broader than a simple point-to-point drive. Compare practical alignments, borders, safety or access constraints, and anchor stops before producing a candidate plan.

### Open-Ended Route Family

Example: the best overland route through a multi-country region.

Compare route concepts before ranking stops. Make assumptions explicit.

For geopolitical route families spanning several materially different border corridors, produce a corridor viability matrix before candidate stop selection. Each corridor option should state its status, blockers, restart options, researchable phases, and the user decision required before implementation. Do not select stops for blocked or deferred corridors unless the user explicitly asks to research a reachable subsection.

### Remote Expedition Track

Example: a remote desert stock route.

Before selecting stops, produce an expedition viability pass that covers permits, season window, required vehicle capability, fuel and water legs, communications and recovery requirements, official road-condition sources, bailout or exit options, and culturally sensitive or restricted areas. Candidate stops should emphasize practical anchors such as camps, wells, fuel points, access tracks, exit tracks, and recovery towns. Do not treat culturally sensitive sites as activities unless a source explicitly confirms public visitor access is appropriate.

## Source Weighting By Region

- North America: Overland Trail Guides, iOverlander, official park sources, Google Maps, recent trip reports.
- South America: iOverlander, official park pages, Google Maps, AllTrails or Komoot, and long-distance overland blogs.
- Europe: park4night, Google Maps, official tourism and park sites, Komoot, AllTrails, road-trip guides.
- Africa: Tracks4Africa, iOverlander, Bradt, national park sites, overlander blogs, Expedition Portal, Horizons Unlimited.
- Central Asia: Caravanistan-style route intelligence, iOverlander, traveller blogs, YouTube, Wikiloc, Google Maps where coverage is strong.
- Australia and New Zealand: Hema, Wikicamps Australia, iOverlander, national park sites, 4x4 forums, YouTube, official tourism pages.
- Remote expedition tracks: permit authorities, traditional-owner or land-council permit systems, local shires, road-condition authorities, official tourism access pages, emergency services guidance, specialist route guides, recent traveller condition reports.

## Approval-Gated Handoff

After the user gives final approval to implement an approved route research plan, switch to the trip data workflow:

1. Convert only approved route content to app data.
2. For mega-corridors, implement approved phases or phase subsets rather than flattening the whole speculative route.
3. For blocked or deferred mega-corridor phases, do not create stops or activities until the user approves a resolved restart, skip, or deferral plan.
4. Convert approved overnight or base candidates to trip stops.
5. Convert approved non-overnight candidates to activities.
6. Preserve approved candidate tags as stop or activity tags.
7. Store source URLs as stop or activity links.
8. Put scores, vehicle warnings, caveats, timing, costs, logistics gates, and evidence notes into stop or activity notes.
9. Use source coordinates when available.
10. Preserve approved stop order, activities, `plannedDurationDays`, and `expectedStayDays` without judging or changing them.
11. Let the app calculate routes and derived data.
12. Verify with `npm run trip -- get --include-activities --include-links --summary --pretty`.

## References

- See `schema-reference.md` for the plan schema and allowed values.
- Files under `examples/` are synthetic validation fixtures. Do not read them while researching or planning a live route, and never reuse their assumptions, locations, recommendations, or placeholder sources as evidence.
- See `examples/ambiguous-point-to-point-user-response-fixture.md` only when validating the default user-facing output shape.
- See `examples/ambiguous-point-to-point-handoff-artifact-fixture.md` only when validating optional handoff-ready structure.
- See `../world-tour-trip-data/README.md` for the approved implementation workflow after user approval.
