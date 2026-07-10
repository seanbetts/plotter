# Example Handoff Artifact: Home To Nordkapp

This example shows optional `handoff-ready` research detail after the user has approved the corridor and material assumptions. It is not write approval.

## Assumptions

- Home means Balcombe, West Sussex, UK.
- The approved corridor is hybrid: efficient transit through Sweden and Finland, then a northern Norway finish.
- The approved shape is northbound only, 12-15 days, summer travel, and a standard road vehicle.
- Research depth is `handoff-ready`.
- No app data is written by this plan.

## Route Shape

`ambiguous-point-to-point`

## Corridor Options

| ID | Name | Status | Strengths | Tradeoffs | Evidence |
| --- | --- | --- | --- | --- | --- |
| efficient-sweden-finland | Efficient Sweden and Finland transit | researchable | Fewer ferries and simpler long-distance transit | Less Norwegian coast scenery | medium |
| norway-heavy-coast | Norway-heavy scenic coast | researchable | Fjords, coastal towns, and iconic Norwegian landscapes | More ferries and slower progress | medium |
| hybrid-sweden-northern-norway | Hybrid Sweden and Finland with northern Norway finish | researchable | Efficient south and a scenic Arctic finish | Misses some fjord-heavy highlights | medium |

Recommended corridor: `hybrid-sweden-northern-norway`.

## Candidate Stops

The order below is canonical for implementation. Every row is one resolvable overnight or base location; the app derives route geometry and route-leg timings.

| Order | Stop | Priority | Score | Stay | Tags | Vehicle | Evidence | Sources | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Balcombe | practical | 2 | departure | `practical-route` | good | high | local-knowledge | Route anchor only. |
| 2 | Hamburg | practical | 2 | 1 night | `practical-route`, `buffer-stop` | good | low | - | Conservative transit base; validate the preceding leg with app-derived route time. |
| 3 | Malmo | practical | 2 | 1 night | `practical-route` | good | low | - | Gateway base after entering Sweden. |
| 4 | Uppsala | practical | 2 | 1 night | `buffer-stop` | good | low | - | Buffer before the longer northern Sweden stages. |
| 5 | Ornskoldsvik | strong | 4 | 1-2 nights | `coast`, `nature` | good | medium | high-coast | Concrete High Coast base. |
| 6 | Lulea | practical | 2 | 1 night | `resupply`, `buffer-stop` | good | low | - | Arctic Sweden resupply and buffer stop. |
| 7 | Rovaniemi | strong | 3 | 1 night | `buffer-stop` | good | medium | visit-rovaniemi | Arctic Finland base before northern Lapland. |
| 8 | Inari | strong | 4 | 1-2 nights | `nature` | good | medium | lapland-north | Northern Lapland nature base on the approved corridor. |
| 9 | Alta | practical | 3 | 1 night | `resupply`, `buffer-stop` | good | low | - | Practical Arctic Norway base before Honningsvag. |
| 10 | Honningsvag | must-do | 4 | 2 nights | `seasonal-access` | check | high | nordkapp-practical, vegvesen-traffic | Base for North Cape Plateau, with a weather buffer. |

Practical bases with no external source are deliberate planning assumptions, not fake evidence. Their exact spacing remains subject to app-derived route-time validation.

## Candidate Activities

Flattened activity tables must include the parent stop.

| Parent Stop | Activity | Priority | Score | Tags | Vehicle | Evidence | Sources | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Honningsvag | North Cape Plateau | must-do | 5 | `viewpoint`, `seasonal-access`, `road-status-check` | check | high | nordkapp-practical, vegvesen-traffic | Final destination activity. Check current road and weather conditions before travel. |

## Schema-Native Handoff Excerpt

For handoff-ready output, preserve schema-native fields even if the user-facing summary used compact tables. Use `placeQuery` when coordinates are not available from a traceable source and let the app resolve location details.

```json
{
  "sourceEvidence": [
    {
      "id": "nordkapp-practical",
      "title": "Visit Nordkapp practical information",
      "url": "https://www.nordkapp.no/practical-info/",
      "sourceType": "official",
      "usedFor": ["seasonal access", "vehicle confidence"],
      "retrievedAt": "2026-07-08",
      "confidence": "high"
    },
    {
      "id": "vegvesen-traffic",
      "title": "Statens vegvesen traffic information",
      "url": "https://www.vegvesen.no/trafikk",
      "sourceType": "official",
      "usedFor": ["road status", "travel-time validation"],
      "retrievedAt": "2026-07-08",
      "confidence": "high"
    }
  ],
  "stops": [
    {
      "name": "Alta",
      "countryRegion": "Finnmark, Norway",
      "stopType": ["town", "practical", "buffer"],
      "classification": ["practical", "buffer"],
      "priority": "practical",
      "score": 3,
      "suggestedStay": "1 night",
      "tags": ["resupply", "buffer-stop"],
      "placeQuery": "Alta, Finnmark, Norway",
      "whyItMatters": "Practical Arctic Norway base before Honningsvag.",
      "vehicleConfidence": "good",
      "evidenceLevel": "low",
      "notes": "Planning assumption. Validate route timing from Inari and onward to Honningsvag using app-derived route legs.",
      "sources": [],
      "activities": []
    },
    {
      "name": "Honningsvag",
      "countryRegion": "Finnmark, Norway",
      "stopType": ["town", "destination-base"],
      "classification": ["anchor", "practical"],
      "priority": "must-do",
      "score": 4,
      "suggestedStay": "2 nights",
      "tags": ["seasonal-access"],
      "placeQuery": "Honningsvag, Finnmark, Norway",
      "whyItMatters": "Overnight base for North Cape Plateau, with a weather buffer.",
      "vehicleConfidence": "check",
      "evidenceLevel": "high",
      "notes": "Validate E69 and weather conditions near travel.",
      "sources": ["nordkapp-practical", "vegvesen-traffic"],
      "activities": [
        {
          "title": "North Cape Plateau",
          "activityType": ["landmark", "viewpoint"],
          "priority": "must-do",
          "score": 5,
          "tags": ["viewpoint", "seasonal-access", "road-status-check"],
          "placeQuery": "North Cape Plateau, Nordkapp, Norway",
          "whyItMatters": "Symbolic endpoint of the route.",
          "vehicleConfidence": "check",
          "evidenceLevel": "high",
          "notes": "Check current E69 access and weather before travel.",
          "sources": ["nordkapp-practical", "vegvesen-traffic"]
        }
      ]
    }
  ],
  "logisticsGates": [
    {
      "id": "southern-transit-duration",
      "name": "Southern transit driving-day validation",
      "type": "road-status-check",
      "severity": "travel-time-validation",
      "appliesToRecommendedRoute": true,
      "appliesToVariantId": "hybrid-sweden-northern-norway",
      "appliesToPhaseId": null,
      "conditionalOn": "Validate after the app derives route-leg timings.",
      "between": ["Balcombe", "Hamburg"],
      "impact": "The Channel crossing and first continental leg may exceed the approved daily driving tolerance.",
      "requiredDecision": "Add an intermediate overnight if the app-derived route time is too ambitious.",
      "vehicleConfidence": "good",
      "evidenceLevel": "low",
      "sources": []
    },
    {
      "id": "nordkapp-e69-seasonal-access",
      "name": "E69/North Cape Plateau seasonal access",
      "type": "road-status-check",
      "severity": "travel-time-validation",
      "appliesToRecommendedRoute": true,
      "appliesToVariantId": "hybrid-sweden-northern-norway",
      "appliesToPhaseId": null,
      "conditionalOn": "Always applies near travel.",
      "between": ["Honningsvag", "North Cape Plateau"],
      "impact": "Access can depend on current road and weather conditions.",
      "requiredDecision": "Refresh current road and weather status close to travel.",
      "vehicleConfidence": "check",
      "evidenceLevel": "high",
      "sources": ["nordkapp-practical", "vegvesen-traffic"]
    }
  ]
}
```

## Source Evidence

| ID | Source | Type | Used For | Confidence |
| --- | --- | --- | --- | --- |
| local-knowledge | User-provided home location | user-provided | Departure anchor | high |
| high-coast | [High Coast official visitor information](https://www.hogakusten.com/en) | official | Ornskoldsvik and High Coast rationale | medium |
| visit-rovaniemi | [Visit Rovaniemi](https://www.visitrovaniemi.fi/) | official | Rovaniemi Arctic base rationale | medium |
| lapland-north | [Lapland North](https://laplandnorth.fi/en/) | official | Inari nature base rationale | medium |
| nordkapp-practical | [Visit Nordkapp practical information](https://www.nordkapp.no/practical-info/) | official | North Cape Plateau access guidance | high |
| vegvesen-traffic | [Statens vegvesen traffic information](https://www.vegvesen.no/trafikk) | official | Current road and traffic checks near travel | high |
| helgelandskysten | [Norwegian Scenic Route Helgelandskysten](https://www.nasjonaleturistveger.no/en/routes/helgelandskysten/) | official | Optional Norway-heavy coast tradeoff | high |
| hirtshals-kristiansand | [Fjord Line Hirtshals-Kristiansand](https://fjordline.com/en/p/our-ferry-routes/hirtshals-kristiansand) | operator | Denmark-Norway ferry option for the Norway-heavy corridor | medium |

Retrieved: 2026-07-08.

## Logistics Gates

| ID | Gate | Severity | Applies To Recommended Route | Variant | Conditional On | Required Decision | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| southern-transit-duration | Southern transit driving-day validation | travel-time-validation | yes | hybrid-sweden-northern-norway | After app-derived route timings are available. | Add an intermediate overnight if Balcombe to Hamburg is too ambitious. | low |
| nordkapp-e69-seasonal-access | E69/North Cape Plateau seasonal access | travel-time-validation | yes | hybrid-sweden-northern-norway | Always applies near travel. | Refresh current road and weather status close to travel. | high |
| denmark-norway-ferry-choice | Denmark-Norway ferry choice | blocking-decision | no | norway-heavy-coast | Only if the Norway-heavy coast is selected. | Choose whether to cross directly to Norway by ferry or continue through Sweden before implementing that variant. | medium |
| helgeland-ferry-chain | Helgelandskysten ferry chain | pre-implementation-check | no | norway-heavy-coast | Only if the Norway-heavy coast is selected. | Validate current ferry timetables before implementing that variant. | high |

## Open Questions

No unresolved route-shaping questions remain. A separate final user approval is still required before writing trip data.

## Implementation Mapping

- Approved overnight/base rows become trip stops in the canonical order above.
- North Cape Plateau becomes an activity under Honningsvag.
- Approved tags become stop or activity tags in the trip CLI payloads.
- Source evidence links become stop or activity links where relevant.
- Practical bases without sources remain explicit planning assumptions rather than source evidence.
- `travel-time-validation` gates become stop, activity, or implementation notes and can trigger later stop amendments after app-derived route timings are available.
- Conditional gates for `norway-heavy-coast` are not blockers for the recommended hybrid route.
- Route geometry and normalized location details are left to the app.
- A separate final user approval is still required before using the trip data guide.
