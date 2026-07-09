# Example Handoff Artifact: Home To Nordkapp

This example shows optional handoff-ready research detail. Produce this only when the user asks for handoff detail or another agent needs the implementation contract. It is not write approval.

## Assumptions

- Home means Balcombe, West Sussex, UK.
- Default style is hybrid: efficient transit through southern Scandinavia, then scenic northern Norway.
- Research depth is `handoff-ready`.
- No app data is written by this plan.

## Route Shape

`ambiguous-point-to-point`

## Corridor Options

| ID | Name | Status | Strengths | Tradeoffs | Evidence |
| --- | --- | --- | --- | --- | --- |
| efficient-sweden-finland | Efficient Sweden and Finland transit | researchable | Fewer ferries, reliable long-distance roads | Less Norwegian coast scenery | medium |
| norway-heavy-coast | Norway-heavy scenic coast | researchable | Fjords, coastal towns, iconic Norwegian landscapes | More ferries and slower progress | medium |
| hybrid-sweden-northern-norway | Hybrid Sweden northbound with scenic northern Norway | researchable | Efficient south, scenic Arctic finish | Misses some fjord-heavy highlights | medium |

Recommended corridor: `hybrid-sweden-northern-norway`.

## Candidate Stops

The order below is canonical for implementation.

| Order | Stop | Priority | Score | Stay | Tags | Vehicle | Evidence | Sources | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Balcombe | practical | 2 | departure | `practical-route` | good | high | local-knowledge | Route anchor only. |
| 2 | Hamburg or Lubeck | practical | 2 | 1 night | `practical-route`, `buffer-stop` | good | medium | map-routing | Breaks the long transit through northern Germany. |
| 3 | Copenhagen / Malmo | strong | 3 | 1 night | `practical-route`, `culture` | good | medium | map-routing | Gateway into Sweden; choose exact base after parking/accommodation validation. |
| 4 | High Coast, Sweden | strong | 4 | 1-2 nights | `coast`, `optional-detour`, `nature` | good | medium | high-coast | Distinct landscape break on the northbound transit. |
| 5 | Lulea | practical | 2 | 1 night | `practical-route`, `resupply`, `buffer-stop` | good | medium | map-routing | Arctic Sweden resupply and buffer stop. |
| 6 | Rovaniemi | strong | 3 | 1 night | `official-route`, `nature`, `buffer-stop` | good | medium | visit-rovaniemi | Finland Arctic base; useful before the final northern push. |
| 7 | Inari / Saariselka | strong | 4 | 1-2 nights | `adventure-variant`, `nature`, `seasonal-access` | check | medium | inari-saariselka | Northern Finland nature base; validate season and road/weather conditions. |
| 8 | Alta | strong | 4 | 1 night | `practical-route`, `resupply`, `buffer-stop` | good | medium | map-routing, vegvesen-traffic | Practical Arctic Norway base before Honningsvag and Nordkapp. |
| 9 | Honningsvag | must-do | 4 | 1 night | `official-route`, `seasonal-access` | check | high | nordkapp-practical, vegvesen-traffic | Base for North Cape Plateau. Validate road/weather conditions near travel. |

## Candidate Activities

Flattened activity tables must include the parent stop.

| Parent Stop | Activity | Priority | Score | Tags | Vehicle | Evidence | Sources | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Honningsvag | North Cape Plateau | must-do | 5 | `viewpoint`, `seasonal-access`, `road-status-check` | check | high | nordkapp-practical, vegvesen-traffic | Final destination activity. Winter access may require convoy travel. |

## Source Evidence

| ID | Source | Type | Used For | Confidence |
| --- | --- | --- | --- | --- |
| local-knowledge | User-provided home location | user-provided | Departure anchor | high |
| map-routing | General map validation | map | Transit spacing and practical routing | medium |
| high-coast | [High Coast official visitor information](https://www.hogakusten.com/en) | official | High Coast scenic stop rationale | medium |
| visit-rovaniemi | [Visit Rovaniemi](https://www.visitrovaniemi.fi/) | official | Rovaniemi Arctic base rationale | medium |
| inari-saariselka | [Lapland North](https://laplandnorth.fi/en/) | official | Northern Finland nature base rationale | medium |
| nordkapp-practical | [Visit Nordkapp practical information](https://www.nordkapp.no/practical-info/) | official | E69 winter convoy/access warning for the North Cape Plateau | high |
| vegvesen-convoy | [Statens vegvesen convoy driving guidance](https://www.vegvesen.no/en/traffic-information/traffic-safety/how-to-drive-in-a-convoy/) | official | Convoy safety requirements and vehicle preparation | high |
| vegvesen-traffic | [Statens vegvesen traffic information](https://www.vegvesen.no/trafikk) | official | Current road closures, traffic messages, and camera checks near travel | high |
| helgelandskysten | [Norwegian Scenic Route Helgelandskysten](https://www.nasjonaleturistveger.no/en/routes/helgelandskysten/) | official | Optional Norway-heavy coast corridor ferry/scenic tradeoff | high |
| hirtshals-kristiansand | [Fjord Line Hirtshals-Kristiansand](https://fjordline.com/en/p/our-ferry-routes/hirtshals-kristiansand) | operator | Denmark-Norway ferry option for Norway-heavy corridor | medium |

Retrieved: 2026-07-08.

## Logistics Gates

| ID | Gate | Severity | Applies To Recommended Route | Variant | Conditional On | Required Decision | Vehicle | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nordkapp-e69-seasonal-access | E69/North Cape Plateau seasonal access | travel-time-validation | yes | hybrid-sweden-northern-norway | Always applies near travel. | Check current Statens vegvesen traffic status and Visit Nordkapp convoy guidance close to travel; add buffer if winter or severe weather is possible. | check | high |
| denmark-norway-ferry-choice | Denmark-Norway ferry choice | blocking-decision | no | norway-heavy-coast | Only if Norway-heavy coast is selected. | Choose whether to cross directly to Norway by ferry or continue through Sweden before implementing that variant. | good | medium |
| helgeland-ferry-chain | Helgelandskysten ferry chain | pre-implementation-check | no | norway-heavy-coast | Only if Norway-heavy coast is selected. | If this variant is chosen, validate current ferry timetables and decide whether the scenic delay is worth it. | check | high |

## Open Questions

- Exact travel season.
- Whether the trip should include Lofoten, Senja, or Tromso as a scenic northern Norway detour.
- Whether Copenhagen/Malmo should be a city stop or a practical overnight only.

## Implementation Mapping

- Approved overnight/base rows become trip stops in the canonical order above.
- North Cape Plateau becomes an activity under Honningsvag.
- Approved tags become stop or activity tags in the trip CLI payloads.
- Source evidence links become stop or activity links where relevant.
- `travel-time-validation` gates become stop, activity, or implementation notes.
- Conditional gates for `norway-heavy-coast` are not blockers for the recommended hybrid route.
- Route geometry is left to the app.
- A separate final user approval is still required before using the trip data guide.
