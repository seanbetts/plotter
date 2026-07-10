# Validation Fixture: Ambiguous Point-To-Point Handoff Artifact

This synthetic fixture demonstrates `handoff-ready` structure after corridor approval. It is not route research, write approval, or reusable evidence. All locations and source URLs are placeholders.

## Assumptions

- The approved corridor uses efficient inland transit with a scenic final approach.
- The approved shape is one-way, 12-15 days, summer, and a standard road vehicle.
- Research depth is `handoff-ready`.
- No app data is written by this plan.

## Route Shape

`ambiguous-point-to-point`

## Corridor Options

| ID | Name | Status | Strengths | Tradeoffs | Evidence |
| --- | --- | --- | --- | --- | --- |
| efficient-inland | Efficient inland transit | researchable | Simpler long-distance transit | Less scenery | medium |
| scenic-throughout | Scenic throughout | researchable | Stronger landscapes | Slower and more weather-dependent | medium |
| hybrid-scenic-finish | Inland transit with scenic finish | researchable | Practical middle and distinctive finish | Misses some scenic sections | medium |

Recommended corridor: `hybrid-scenic-finish`.

## Candidate Stops

The order below is canonical for implementation. Every row is one resolvable overnight or base location; the app derives route geometry and route-leg timings.

| Order | Stop | Priority | Stay | Tags | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Home | practical | departure | `practical-route` | high | User-provided route anchor. |
| 2 | Continental gateway | practical | 1 night | `practical-route`, `buffer-stop` | low | Conservative transit assumption. |
| 3 | Landscape base | strong | 1-2 nights | `nature`, `viewpoint` | medium | Scenic break on the approved corridor. |
| 4 | Final resupply base | practical | 1 night | `resupply`, `buffer-stop` | low | Buffer before the final section. |
| 5 | Destination base | must-do | 2 nights | `seasonal-access` | high | Base for the non-overnight endpoint activity. |

## Candidate Activities

| Parent Stop | Activity | Priority | Tags | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Destination base | Remote endpoint viewpoint | must-do | `viewpoint`, `seasonal-access`, `road-status-check` | high | Refresh access and weather near travel. |

## Schema-Native Handoff Excerpt

The reserved `example.com` URLs below demonstrate field shape only. A live handoff must replace them with current, traceable sources.

```json
{
  "sourceEvidence": [
    {
      "id": "current-access-authority",
      "title": "Current access authority",
      "url": "https://example.com/current-access-authority",
      "sourceType": "official",
      "usedFor": ["seasonal access", "road status"],
      "retrievedAt": "2026-07-10",
      "confidence": "high"
    }
  ],
  "stops": [
    {
      "name": "Final resupply base",
      "countryRegion": "Destination region",
      "stopType": ["town", "practical", "buffer"],
      "classification": ["practical", "buffer"],
      "priority": "practical",
      "score": 3,
      "suggestedStay": "1 night",
      "tags": ["resupply", "buffer-stop"],
      "placeQuery": "Final resupply base, Destination region",
      "whyItMatters": "Practical buffer before the destination base.",
      "vehicleConfidence": "good",
      "evidenceLevel": "low",
      "notes": "Planning assumption. Validate both adjacent legs using app-derived route times.",
      "sources": [],
      "activities": []
    },
    {
      "name": "Destination base",
      "countryRegion": "Destination region",
      "stopType": ["town", "destination-base"],
      "classification": ["anchor", "practical"],
      "priority": "must-do",
      "score": 4,
      "suggestedStay": "2 nights",
      "tags": ["seasonal-access"],
      "placeQuery": "Destination base, Destination region",
      "whyItMatters": "Overnight base for the remote endpoint, with a weather buffer.",
      "vehicleConfidence": "check",
      "evidenceLevel": "high",
      "notes": "Refresh final access and weather close to travel.",
      "sources": ["current-access-authority"],
      "activities": [
        {
          "title": "Remote endpoint viewpoint",
          "activityType": ["landmark", "viewpoint"],
          "priority": "must-do",
          "score": 5,
          "tags": ["viewpoint", "seasonal-access", "road-status-check"],
          "placeQuery": "Remote endpoint viewpoint, Destination region",
          "whyItMatters": "Symbolic endpoint of the route.",
          "vehicleConfidence": "check",
          "evidenceLevel": "high",
          "notes": "Refresh access and weather close to travel.",
          "sources": ["current-access-authority"]
        }
      ]
    }
  ],
  "logisticsGates": [
    {
      "id": "final-access-refresh",
      "name": "Final access and weather refresh",
      "type": "road-status-check",
      "severity": "travel-time-validation",
      "appliesToRecommendedRoute": true,
      "appliesToVariantId": "hybrid-scenic-finish",
      "appliesToPhaseId": null,
      "conditionalOn": "Always applies near travel.",
      "between": ["Destination base", "Remote endpoint viewpoint"],
      "impact": "Access can depend on current road and weather conditions.",
      "requiredDecision": "Refresh current access and weather before travel.",
      "vehicleConfidence": "check",
      "evidenceLevel": "high",
      "sources": ["current-access-authority"]
    }
  ]
}
```

## Open Questions

No unresolved route-shaping questions remain. A separate final user approval is still required before writing trip data.

## Implementation Mapping

- Approved overnight and base rows become trip stops in canonical order.
- The remote endpoint viewpoint becomes an activity under Destination base.
- Approved tags and links remain attached to their owning stop or activity.
- Operational unknowns remain scoped validation notes unless they invalidate the approved corridor.
- Route geometry and normalized location details are left to the app.
- A separate final user approval is still required before using the trip data guide.
