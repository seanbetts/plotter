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

## Source Evidence

| ID | Source | Type | Used For | Confidence |
| --- | --- | --- | --- | --- |
| nordkapp-practical | [Visit Nordkapp practical information](https://www.nordkapp.no/practical-info/) | official | E69 winter convoy/access warning for the North Cape Plateau | high |
| vegvesen-convoy | [Statens vegvesen convoy driving guidance](https://www.vegvesen.no/en/traffic-information/traffic-safety/how-to-drive-in-a-convoy/) | official | Convoy safety requirements and vehicle preparation | high |
| vegvesen-traffic | [Statens vegvesen traffic information](https://www.vegvesen.no/trafikk) | official | Current road closures, traffic messages, and camera checks near travel | high |
| helgelandskysten | [Norwegian Scenic Route Helgelandskysten](https://www.nasjonaleturistveger.no/en/routes/helgelandskysten/) | official | Optional Norway-heavy coast corridor ferry/scenic tradeoff | high |
| hirtshals-kristiansand | [Fjord Line Hirtshals-Kristiansand](https://fjordline.com/en/p/our-ferry-routes/hirtshals-kristiansand) | operator | Denmark-Norway ferry option for Norway-heavy corridor | medium |

Retrieved: 2026-07-08.

## Logistics Gates

| ID | Gate | Applies To | Required Decision | Vehicle | Evidence |
| --- | --- | --- | --- | --- | --- |
| nordkapp-e69-seasonal-access | E69/North Cape Plateau seasonal access | Honningsvag to North Cape Plateau | Check current Statens vegvesen traffic status and Visit Nordkapp convoy guidance close to travel; add buffer if winter or severe weather is possible. | check | high |
| denmark-norway-ferry-choice | Denmark-Norway ferry choice | Norway-heavy coast corridor | Choose whether to cross directly to Norway by ferry or continue through Sweden before implementation. | good | medium |
| helgeland-ferry-chain | Helgelandskysten ferry chain | Norway-heavy coast corridor | If this corridor is chosen, validate current ferry timetables and decide whether the scenic delay is worth it. | check | high |

## Open Questions

- Exact travel season.
- Whether the trip should include Lofoten, Senja, or Tromso as a scenic northern Norway detour.
- Whether Copenhagen/Malmo should be a city stop or a practical overnight only.

## Implementation Mapping

- Approved overnight/base rows become trip stops.
- North Cape Plateau becomes an activity under Honningsvag.
- Source evidence links become stop or activity links where relevant.
- Logistics gate warnings become stop notes, activity notes, or implementation notes.
- Route geometry is left to the app.
