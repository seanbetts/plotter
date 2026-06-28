# World Tour Planner PoC Design

Date: 2026-06-28

## Purpose

Build a local, visual-first planning website for a future 2-3 year round-the-world expedition truck trip. The first version is a proof of concept for the core experience: a blank custom world map where destinations and route legs are added iteratively as the tour takes shape.

The PoC should help with dreaming, route shaping, and destination research before it grows into a more sophisticated planning and on-tour tool. It should not start as a full logistics, budgeting, publishing, or field-operations platform.

## Product Direction

The app opens onto a blank interactive global map. The map is the primary surface. It should feel like a serious planning atlas with enough atmosphere to make the trip exciting to explore.

The user adds their own destinations. The app does not need a global destination database and should not display information for places that have not been added to the tour.

Each added destination uses the same structured profile model. The profile should feel rich and editorial, but the underlying data should be consistent across every destination.

The first impression should be a serious planning map. Over time the same app can support three modes:

- Serious planning map: route segments, dates, stops, route gaps, and constraints.
- Dream map: photos, highlights, book-inspired ideas, and visual storytelling.
- Living expedition map: practical notes, on-tour records, and daily operational context.

Only the first mode is required for the PoC, with enough visual richness to evaluate look and feel.

## PoC Scope

In scope:

- Blank interactive global map with pan and zoom.
- Customizable map look and feel.
- Add a destination by searching for a place or dropping a pin.
- Store destinations locally.
- Click a destination pin to open its structured profile.
- Edit the same profile fields for every destination.
- Add simple route legs between destinations.
- Distinguish route leg types: driving, ferry/shipping, and uncertain/manual.
- Show route lines on the map.
- Provide a basic itinerary/list view as a secondary tool.
- Support import/export of trip data as a portable JSON snapshot.

Out of scope:

- Full logistics planning.
- Detailed budgets.
- Visa, carnet, insurance, document, and maintenance management.
- Public sharing or publishing.
- Offline mode.
- Full digitisation of travel books.
- Automatic destination discovery for places not already added to the tour.

Light notes for shipping gaps, borders, seasons, or other route-shaping constraints are allowed when attached to a destination or route leg.

## Destination Model

Every destination should support this structured profile:

- Identity: name, country or region, coordinates, status, and priority.
- Timing: ideal season or months, expected stay length, and provisional dates.
- Why it matters: summary, highlights, and personal rationale.
- Media: photos or gallery items, captions, and credits.
- Research: notes, links, book references, and external resources.
- Activities: things to do, nearby detours, food, culture, outdoors, street art, ski, and other relevant themes.
- Route context: previous or next stop notes, driving notes, and border or shipping notes where useful.
- Tags: themes such as `ski`, `street-art`, `mountains`, `city`, `coast`, and `must-do`.

The book layer should be curated rather than comprehensive. The app should store references to useful ideas from books such as `World Atlas of Street Art`, `Lonely Planet's Where to Go When`, and `Powder`, but it should not attempt to copy or digitise the books wholesale.

## Route Leg Model

Route legs connect destinations. Each leg should support:

- Origin destination ID.
- Target destination ID.
- Leg type: driving, ferry/shipping, or uncertain/manual.
- Optional distance estimate.
- Optional travel time estimate.
- Optional geometry for the displayed route line.
- Notes.

The PoC can start with manual or approximate lines. The architecture should allow real routed road geometry from APIs later.

## Recommended Stack

- Frontend: Vite, React, and TypeScript.
- Map renderer: MapLibre GL JS.
- Local persistence: browser-local IndexedDB for the PoC.
- Data portability: JSON export and import.
- Routing: adapter interface with manual route support first; optional OSRM, OpenRouteService, or similar providers later.
- Geocoding: adapter interface so providers can be changed without rewriting the UI.
- Media: browser-managed local image attachments or local references for PoC, with a later decision on long-term media storage.

MapLibre is preferred because it supports custom styling and avoids locking the project into a proprietary renderer. Tile provider choice can remain flexible during the PoC.

## Core Modules

- `MapCanvas`: renders the map, destination pins, route lines, selected state, and map controls.
- `DestinationStore`: owns destination persistence, validation, and import/export.
- `DestinationProfile`: displays and edits the structured destination profile.
- `RouteLegStore`: owns route-leg persistence, ordering, and route-line data.
- `ItineraryPanel`: secondary view for scanning destinations and selecting or reordering stops.
- `MapStyle`: map style configuration and visual theme tokens.
- `GeocodingAdapter`: searches place names and converts them to coordinates.
- `RoutingAdapter`: calculates or stores route geometry and estimates when available.

## Data Flow

Adding a destination creates a destination record in local persistence. The map subscribes to the destination store and renders a pin immediately.

Clicking a pin selects that destination and opens its profile. Editing profile fields updates local persistence and refreshes the map and itinerary list.

Route legs connect destination IDs. They render as map lines with different styling for driving, ferry/shipping, and uncertain/manual legs.

Import and export operate on the full local trip dataset: destinations, route legs, and app-level metadata.

## Interaction Design

The app should open directly to the map. There should be no landing page or marketing-style homepage.

Primary workflow:

1. Open full-screen world map.
2. Search for a place or drop a pin.
3. Add the selected location as a destination.
4. Click the destination pin.
5. Edit its structured profile.
6. Connect it to another destination with a route leg.
7. See the updated route on the map.
8. Use the itinerary/list panel only when useful for scanning or ordering stops.

The map should remain dominant. Toolbars, panels, and forms should be compact and should not make the app feel like an admin dashboard.

## Look And Feel

The visual target is a custom expedition atlas:

- Serious enough for planning.
- Atmospheric enough to feel exciting.
- Minimal interface chrome.
- Strong emphasis on map, route lines, pins, photos, and destination profiles.
- Route and pin styling should feel intentional rather than default.

The PoC exists partly to refine this look and feel. The first implementation should make visual iteration easy.

## API Strategy

Use APIs where they make planning easier, but keep them replaceable:

- Geocoding for place search.
- Optional route calculation for distance, time, and road geometry.
- Optional external enrichment later for weather, climate, photos, or travel advisories.

The app should cache or persist useful API results so the local planning dataset remains stable.

## Testing And Verification

Testing should protect the core planning flows without slowing visual iteration.

Required verification:

- Unit tests for destination and route-leg helper logic.
- Persistence tests for create, update, and delete operations.
- Browser smoke test that loads the app, renders the map container, adds a destination, opens its profile, and saves an edit.
- Visual screenshots at desktop and smaller widths once map styling is implemented.
- Manual checks for map pan/zoom, pin selection, profile editing, and route drawing.

## Open Implementation Decisions

These decisions should be made during implementation planning:

- Exact UI component library, if any.
- IndexedDB wrapper choice.
- Initial map tile provider and style.
- Initial geocoding provider.
- Whether image attachments are stored directly in IndexedDB for PoC or referenced from local files.
- How route ordering is represented in the itinerary panel.

## Success Criteria

The PoC is successful when:

- The app opens to a blank, attractive world map.
- A destination can be added from search or pin drop.
- A destination pin can be clicked to open a rich structured profile.
- Profile edits persist locally.
- Two destinations can be connected with a route leg.
- Different route leg types are visually distinct.
- The experience feels promising enough to continue refining the visual design.
