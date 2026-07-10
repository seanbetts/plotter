# Validation Fixture: Ambiguous Point-To-Point User Response

This is a synthetic skill-validation fixture, not a route recommendation. Never use its assumptions, locations, or placeholder evidence in a live planning request.

Assumptions: one-way summer travel, a standard road vehicle, and a mixed scenic/practical pace. No duration limit was supplied.

Recommended duration: 15 days. A reasonable range is 13-17 days without materially changing the route; 15 days leaves enough time for the scenic bases and final access buffer rather than treating every base as a transit night.

Recommended route: use the efficient inland corridor, then take the scenic approach through the destination region. This keeps the long transit practical without losing the distinctive final section.

Main alternatives:

- Fully efficient corridor: simpler and less weather-dependent, but misses the scenic finish.
- Fully scenic corridor: stronger landscapes throughout, but slower and more exposed to seasonal disruption.

Compact spine:

| Base Or Phase | Role | Why It Is Included |
| --- | --- | --- |
| Home | Departure | User-provided route anchor. |
| Continental gateway | Transit break | Breaks the first long section after the international crossing. |
| Inland regional base | Practical transit | Keeps the long middle section efficient. |
| Landscape base | Scenic break | Adds a distinctive experience without committing to the slower corridor throughout. |
| Final resupply base | Practical buffer | Creates resilience before the remote final section. |
| Destination base | Endpoint base | Overnight base for the non-overnight endpoint activity. |

Activity preview:

| Stop | Activity | Why It Is Included |
| --- | --- | --- |
| Destination base | Remote endpoint viewpoint | Symbolic endpoint of the route. |

Validation notes:

- Use app-derived route times to split any over-ambitious transit legs when the detailed candidate plan is built.
- Refresh the final access road and weather status close to travel.
- Confirm vehicle dimensions only if the selected crossing or final access road imposes a material restriction.

Live output would cite current route-authority and access sources here. They are intentionally omitted from this synthetic fixture.

Does a 15-day version feel about right, or should I deliberately reshape it into a shorter or longer trip?
