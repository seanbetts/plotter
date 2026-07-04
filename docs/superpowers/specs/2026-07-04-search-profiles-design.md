# Search Profiles Design

## Purpose

Split trip search into two clear contexts while keeping the implementation shared.

The top app search is for macro route stops: cities, towns, districts, counties, and regions that can anchor the trip route. The stop panel activity search is for micro places around a selected stop: venues, points of interest, streets, addresses, and neighbourhoods that become activities under that stop.

This keeps the main search focused on adding route stops while allowing the stop panel to support rich activity discovery without mixing stop and activity behaviors in one UI.

## Product Model

The app has two search surfaces:

- Main search in the top toolbar. Selecting a result adds a trip stop.
- Activity search in the selected stop panel. Selecting a result adds or fills an activity under that stop.

The two surfaces should use one central search module with context-specific profiles. They should not duplicate MapTiler request construction, response mapping, coordinate parsing, stale-response handling, or normalized result types.

```ts
type SearchProfile = 'stop' | 'activity';

type SearchRequest = {
  query: string;
  profile: SearchProfile;
  proximity?: Coordinates;
};
```

## Stop Search

Stop search is for macro locations. It should include MapTiler types that represent settlements or administrative areas useful as trip anchors:

```text
place
locality
municipality
municipal_district
joint_municipality
joint_submunicipality
county
subregion
region
```

It should not include `country`, because countries are too broad for this app's route-stop workflow.

It should not include `major_landform`. Testing showed it can help with some geographic queries, but it also creates noisy and surprising results. The Sagres issue is solved by adding `municipal_district`, not by adding landforms.

Stop search results do not need type badges. The result row can stay simple: primary place name and location context.

## Activity Search

Activity search is for micro locations inside the selected stop context. It should use the selected stop's coordinates as MapTiler proximity bias.

Activity search should include:

```text
poi
address
road
neighbourhood
place
locality
```

`place` and `locality` are included here because useful activities can be nearby named areas, beaches, small villages, markets, or other local features that are not necessarily POIs.

Activity search results can use type badges, because the user benefits from seeing whether a result is a venue, address, street, neighbourhood, or nearby place. These badges should appear only in the activity search UI, not in the main search UI.

The activity search row should show:

- Result name.
- Type badge when useful.
- Local context or address.
- Distance from the selected stop when coordinates are available.

No action labels are needed. The search surface already determines the action.

## Result Data

The central search module should preserve more MapTiler response data than the current stop search adapter does.

Normalized results should keep:

- `id`
- `label`
- `coordinates`
- `location`
- `placeTypes`
- `placeTypeNames`
- `address`
- `bbox`
- `relevance`
- `context`
- `matchingPlaceName`
- `matchingText`
- `sourceProvider`
- `sourceFeatureId`

The UI can display a small subset, but keeping the normalized fields avoids reworking the adapter when activity badges, distance ranking, or richer location labels need refinement.

## Ranking And Filtering

The first implementation should rely mostly on MapTiler's ranking plus type filters.

Result limits should be profile-specific:

- Stop search should request 8 results.
- Activity search should request 10 results.

Stop search needs a little more breadth than the current 6-result request so useful macro places are less likely to be crowded out. Activity search should use 10 results because it is more exploratory and the user is looking for multiple possible things to do around a selected stop.

For activity search, proximity to the selected stop should be sent to MapTiler. The app can compute `distanceFromStopKm` for display, but should avoid custom heavy ranking until real examples show it is needed.

Blank queries return no results. Coordinate input should remain supported by the shared search module. In the main search context, coordinates resolve to a stop candidate. In activity search, coordinates can create an activity location under the selected stop.

## Architecture

Create a shared search layer around MapTiler:

```ts
searchPlaces(query, {
  profile: 'stop' | 'activity',
  proximity,
  apiKey,
  signal,
})
```

The shared layer owns:

- Coordinate parsing.
- Profile-to-MapTiler-type mapping.
- MapTiler request construction.
- Response normalization.
- Optional distance calculation when proximity is provided.
- Reverse geocoding for coordinate results.

The top toolbar and activity search component should share reusable combobox behavior where practical, but their rendering can differ. The top toolbar stays visually simple. The stop panel activity search can show activity-specific badges and distance context.

## Error Handling

Both search surfaces should preserve the current behavior of ignoring stale responses and showing a local error when the latest request fails.

An activity search cannot run unless a stop is selected. If the selected stop lacks coordinates, activity search can still run without proximity, but the UI should not show distance values.

## Testing

Unit tests should cover:

- Stop profile uses the stop type set and excludes `country` and `major_landform`.
- Activity profile uses the activity type set and includes `poi`.
- Sagres, Portugal-style `municipal_district` results map correctly.
- MapTiler fields are preserved in normalized results.
- Coordinate results work in both profiles.
- Activity search computes distance when a proximity coordinate is supplied.

Component tests should cover:

- Main search renders simple macro results without badges.
- Activity search renders badges and local context.
- Selecting a main search result adds a stop.
- Selecting an activity search result adds or fills an activity under the selected stop.
