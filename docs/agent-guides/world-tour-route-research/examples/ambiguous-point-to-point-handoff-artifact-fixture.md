# Validation Fixture: Ambiguous Point-To-Point Handoff Artifact

This synthetic fixture demonstrates `handoff-ready` structure after corridor approval. It is not route research, write approval, or reusable evidence. All locations and source URLs are placeholders.

## Assumptions

- The approved corridor uses efficient inland transit with a scenic final approach.
- The naturally paced recommendation and approved plan are both 15 days for one-way summer travel using the `standard` vehicle preset.
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

| Order | Stop | Priority | Expected Stay | Tags | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Home | practical | 1 day | `practical-route` | high | User-provided route anchor. |
| 2 | Continental gateway | practical | 2 days | `practical-route`, `buffer-stop` | low | Conservative transit assumption. |
| 3 | Inland regional base | strong | 3 days | `practical-route`, `recovery-stop` | medium | Meaningful inland base between transit sections. |
| 4 | Landscape base | strong | 4 days | `nature`, `viewpoint` | medium | Scenic base with time for its activities. |
| 5 | Final resupply base | practical | 2 days | `resupply`, `buffer-stop` | low | Buffer before the final section. |
| 6 | Destination base | must-do | 3 days | `seasonal-access` | high | Base for the non-overnight endpoint activity. |
| Total |  |  | 15 days |  |  |  |

Home: 1
Continental gateway: 2
Inland regional base: 3
Landscape base: 4
Final resupply base: 2
Destination base: 3
Total: 15

## Candidate Activities

| Parent Stop | Activity | Priority | Tags | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Landscape base | Landscape viewpoint walk | strong | `nature`, `viewpoint` | medium | Core scenic activity with time beyond the surrounding driving burden. |
| Destination base | Remote endpoint viewpoint | must-do | `viewpoint`, `seasonal-access`, `road-status-check` | high | Refresh access and weather near travel. |

## Schema-Native Handoff Excerpt

The reserved `example.com` URLs below demonstrate field shape only. A live handoff must replace them with current, traceable sources.

```json
{
  "manifestVersion": 2,
  "vehiclePreset": "standard",
  "recommendedDuration": {
    "days": 15,
    "rangeDays": { "min": 13, "max": 17 },
    "rationale": "Balances efficient transit with meaningful scenic bases and a final access buffer."
  },
  "plannedDurationDays": 15,
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
      "key": "home",
      "name": "Home",
      "countryRegion": "Home Region",
      "stopType": ["departure", "practical"],
      "classification": ["practical"],
      "priority": "practical",
      "score": 5,
      "suggestedStay": "1 day",
      "expectedStayDays": 1,
      "tags": ["practical-route"],
      "placeQuery": "Home, Home Region",
      "coordinates": { "lat": 50.0, "lng": -1.0 },
      "whyItMatters": "User-provided departure anchor for the approved route.",
      "vehicleConfidence": "good",
      "evidenceLevel": "high",
      "notes": "Departure stop; route geometry and normalized location details are left to the app.",
      "sources": [],
      "activities": []
    },
    {
      "key": "continental-gateway",
      "name": "Continental gateway",
      "countryRegion": "Continental Region",
      "stopType": ["town", "practical", "buffer"],
      "classification": ["practical", "buffer"],
      "priority": "practical",
      "score": 3,
      "suggestedStay": "2 days",
      "expectedStayDays": 2,
      "tags": ["practical-route", "buffer-stop"],
      "placeQuery": "Continental gateway, Continental Region",
      "coordinates": { "lat": 49.0, "lng": 3.0 },
      "whyItMatters": "Conservative transit base that separates the long-distance route sections.",
      "vehicleConfidence": "good",
      "evidenceLevel": "low",
      "notes": "Planning assumption. Validate adjacent legs using app-derived route times.",
      "sources": [],
      "activities": []
    },
    {
      "key": "inland-regional-base",
      "name": "Inland regional base",
      "countryRegion": "Inland Region",
      "stopType": ["town", "recovery"],
      "classification": ["experience", "practical"],
      "priority": "strong",
      "score": 4,
      "suggestedStay": "3 days",
      "expectedStayDays": 3,
      "tags": ["practical-route", "recovery-stop"],
      "placeQuery": "Inland regional base, Inland Region",
      "coordinates": { "lat": 47.0, "lng": 6.0 },
      "whyItMatters": "Meaningful inland base between transit sections, with recovery time.",
      "vehicleConfidence": "good",
      "evidenceLevel": "medium",
      "notes": "Retain the approved recovery allocation instead of compressing it into transit nights.",
      "sources": [],
      "activities": []
    },
    {
      "key": "landscape-base",
      "name": "Landscape base",
      "countryRegion": "Landscape Region",
      "stopType": ["town", "nature-base"],
      "classification": ["anchor", "experience"],
      "priority": "strong",
      "score": 5,
      "suggestedStay": "4 days",
      "expectedStayDays": 4,
      "tags": ["nature", "viewpoint"],
      "placeQuery": "Landscape base, Landscape Region",
      "coordinates": { "lat": 46.0, "lng": 7.0 },
      "whyItMatters": "Scenic base with enough time for its activity beyond the surrounding driving burden.",
      "vehicleConfidence": "good",
      "evidenceLevel": "medium",
      "notes": "Retain the approved scenic-base allocation.",
      "sources": [],
      "activities": [
        {
          "title": "Landscape viewpoint walk",
          "activityType": ["walk", "viewpoint"],
          "priority": "strong",
          "score": 4,
          "tags": ["nature", "viewpoint"],
          "placeQuery": "Landscape viewpoint, Destination region",
          "coordinates": { "lat": 46.1, "lng": 7.1 },
          "whyItMatters": "Core scenic activity for the landscape base.",
          "vehicleConfidence": "good",
          "evidenceLevel": "medium",
          "notes": "Allow time beyond the surrounding driving burden.",
          "sources": []
        }
      ]
    },
    {
      "key": "final-resupply-base",
      "name": "Final resupply base",
      "countryRegion": "Destination region",
      "stopType": ["town", "practical", "buffer"],
      "classification": ["practical", "buffer"],
      "priority": "practical",
      "score": 3,
      "suggestedStay": "2 days",
      "expectedStayDays": 2,
      "tags": ["resupply", "buffer-stop"],
      "placeQuery": "Final resupply base, Destination region",
      "coordinates": { "lat": 45.0, "lng": 7.0 },
      "whyItMatters": "Practical buffer before the destination base.",
      "vehicleConfidence": "good",
      "evidenceLevel": "low",
      "notes": "Planning assumption. Validate both adjacent legs using app-derived route times.",
      "sources": [],
      "activities": []
    },
    {
      "key": "destination-base",
      "name": "Destination base",
      "countryRegion": "Destination region",
      "stopType": ["town", "destination-base"],
      "classification": ["anchor", "practical"],
      "priority": "must-do",
      "score": 4,
      "suggestedStay": "3 days",
      "expectedStayDays": 3,
      "tags": ["seasonal-access"],
      "placeQuery": "Destination base, Destination region",
      "coordinates": { "lat": 44.0, "lng": 8.0 },
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
          "coordinates": { "lat": 43.9, "lng": 8.1 },
          "whyItMatters": "Symbolic endpoint of the route.",
          "vehicleConfidence": "check",
          "evidenceLevel": "high",
          "notes": "Refresh access and weather close to travel.",
          "sources": ["current-access-authority"]
        }
      ]
    }
  ],
  "routeLegs": [],
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
- Copy the approved `plannedDurationDays` and `expectedStayDays` allocation without replanning it.
- Copy `manifestVersion: 2`, `vehiclePreset: "standard"`, and `routeLegs: []` into the write handoff. The empty route directive list keeps every ordinary adjacent automatic leg implicit.
- Operational unknowns remain scoped validation notes unless they invalidate the approved corridor.
- Route geometry and normalized location details are left to the app.
- A separate final user approval is still required before using the trip data guide.
