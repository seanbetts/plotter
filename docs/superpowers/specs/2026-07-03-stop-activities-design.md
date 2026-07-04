# Stop Activities Design

## Purpose

Add rich activities inside each trip stop without turning those activities into route stops.

Stops remain the trip route anchors: they control route order, route legs, stay length, and the route-level map. Activities are things to do in and around a stop: places, meals, walks, day trips, bookings, visual references, and notes. Activities can be rich planning objects, but they stay bundled with their parent stop.

This keeps the trip flexible. The app should support planning possibilities without making the user feel beholden to a strict schedule.

## Product Model

The app has three nested planning layers:

```text
Trip -> Stops -> Activities
```

A stop represents a route anchor such as Paris. An activity represents something related to that stop, such as the Louvre, a bakery crawl, a street-art walk, or a day trip to Versailles.

Activities are not route stops. They do not affect route-leg calculation, stop order, or trip-level map clutter. If an activity later deserves to become part of the trip route, that should be an explicit promote-to-stop action in a later design, not automatic behavior.

## Interaction Model

### Route View

The default map shows the full trip route, route legs, and stop pins only. Activity pins are hidden in this view so the map stays readable at trip scale.

The itinerary panel remains the route ordering surface. Activities should not appear as peer rows in the route itinerary.

### Stop Focus View

Selecting a stop opens the stop profile and moves the map into a local focus state for that stop.

In stop focus view, the map should:

- Zoom toward the selected stop and its mappable activities.
- Show the selected stop pin.
- Show pins for activities under that stop that have coordinates.
- Keep activities without coordinates visible in the stop profile list, but not on the map.
- Highlight the selected activity pin when an activity is selected.

Closing the stop profile exits focus view, hides activity pins, clears selected activity state, and restores the previous route-level viewport. Selecting another stop directly transitions from one stop focus view to the next.

### Activity List

The stop profile contains an ordered activity list.

The list order is manual and flexible. It should not imply date, time, day number, or schedule. Reordering an activity means "show this higher in the planning list", not "do this earlier".

Each activity row should support selection. Selecting an activity opens its detail panel and highlights its map pin if the activity has coordinates.

## Panel Layout

The stop profile remains a right-side panel.

When an activity is selected, an activity panel opens immediately to the left of the stop panel so both remain visible:

```text
[ map / focus layer ] [ selected activity panel ] [ selected stop panel ]
```

The stop panel continues to provide stop-level context, stop images, stop metadata, and the activity list. The activity panel provides rich editing for the selected activity.

On narrow screens, the two-panel layout can collapse into a stacked or drill-in behavior during implementation, but the desktop design should preserve simultaneous stop and activity context.

## Activity Data Model

Activities should be persisted as their own child records rather than embedded in `destination.activities`.

Conceptual TypeScript shape:

```ts
type Activity = {
  id: string;
  tripId: string;
  destinationId: string;
  order: number;
  title: string;
  description: string;
  category:
    | 'food'
    | 'culture'
    | 'outdoors'
    | 'street-art'
    | 'ski'
    | 'detour'
    | 'logistics'
    | 'other';
  status: 'idea' | 'planned' | 'booked' | 'done' | 'skipped';
  priority: 'low' | 'medium' | 'high' | 'must-do';
  location?: {
    name: string;
    address: string;
    coordinates?: Coordinates;
    sourceProvider?: 'maptiler' | 'manual';
    sourceFeatureId?: string;
  };
  links: ResearchLink[];
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
```

Coordinates are optional. Activities without coordinates stay in the ordered list and do not get map pins. Activities with coordinates render as pins only while their parent stop is selected.

The existing `destination.activities` JSON can remain as a migration bridge, but new application code should read and write through the activities collection.

## Database Design

Add an `activities` table:

```sql
create table public.activities (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid not null,
  activity_order integer not null default 0,
  title text not null,
  description text not null default '',
  category text not null default 'other',
  status text not null default 'idea',
  priority text not null default 'medium',
  location jsonb,
  links jsonb not null default '[]'::jsonb,
  notes text not null default '',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trip_id, destination_id)
    references public.destinations(trip_id, id)
    on delete cascade
);
```

Useful indexes:

```sql
create index activities_trip_destination_order_idx
  on public.activities(trip_id, destination_id, activity_order, created_at);

create index activities_trip_updated_at_idx
  on public.activities(trip_id, updated_at);
```

RLS should mirror destination access: a user who can edit the parent trip can view and mutate that trip's activities.

## Media Design

This design extends the stop reference image work in `docs/superpowers/specs/2026-07-03-stop-reference-images-design.md`.

Images should continue to use the existing `media_assets` storage spine and private `trip-media` bucket. Activity images should not introduce a separate image system.

Each media item has exactly one owner:

```ts
type MediaOwnerType = 'destination' | 'activity';
```

Destination-owned images are general stop images. Activity-owned images belong to a specific activity. The `media_assets` table should support activity ownership while preserving destination ownership:

```sql
alter table public.media_assets
  add column activity_id uuid;
```

The existing `media_assets.sort_order` column remains the ordering field. The table should enforce that every media row belongs to a destination and optionally to one activity under that destination. A destination-owned image has `activity_id = null`. An activity-owned image has `activity_id` set to an activity for the same trip and destination.

The activities table already has a composite uniqueness constraint on `(trip_id, destination_id, id)`. Media ownership should reference that existing key so activity media cannot point at an activity under a different stop.

```sql
alter table public.media_assets
  alter column destination_id set not null,
  add constraint media_assets_activity_owner_fk
    foreign key (trip_id, destination_id, activity_id)
    references public.activities(trip_id, destination_id, id)
    on delete cascade;
```

The foreign key permits `activity_id = null` for destination-owned media and enforces same-trip, same-destination ownership for activity media.

The existing destination media implementation already enforces unique `sort_order` values per destination. Activity media needs separate ownership-aware uniqueness so destination-owned image order and each activity-owned image order do not collide:

```sql
drop index if exists media_assets_trip_destination_sort_order_key;

create unique index media_assets_destination_owned_sort_order_key
on public.media_assets(trip_id, destination_id, sort_order)
where destination_id is not null
  and activity_id is null;

create unique index media_assets_activity_owned_sort_order_key
on public.media_assets(trip_id, destination_id, activity_id, sort_order)
where destination_id is not null
  and activity_id is not null;
```

Storage paths should remain trip and destination scoped. Activity uploads can add the activity id as an extra path segment:

```text
{tripId}/{destinationId}/{activityId}/{generated-file-name}
```

Destination-owned uploads can keep the existing path:

```text
{tripId}/{destinationId}/{generated-file-name}
```

### Stop Carousel Rollup

The stop image area keeps the preview-first interaction from the stop reference image design. The large preview shows the currently selected rollup image, thumbnails select that preview, and opening the full-screen modal happens from the large preview.

The stop carousel shows a rollup of:

- Destination-owned images for the stop.
- Activity-owned images from all activities under the stop.

The app should keep `MediaItem` as the reusable image primitive used by the existing image strip and preview modal. Rollup-only ownership and attribution should be carried by a wrapper type rather than making every `MediaItem` consumer care about destination/activity ownership:

```ts
type MediaRollupItem = {
  mediaItem: MediaItem;
  ownerType: 'destination' | 'activity';
  destinationId: string;
  activityId?: string;
  activityTitle?: string;
  canReorderInStopCarousel: boolean;
};
```

Ordering should be deterministic without adding a second global carousel order:

1. Destination-owned images first, ordered by `sort_order`.
2. Activity-owned images next, grouped by activity `order`.
3. Within each activity group, images ordered by media `sort_order`.

The first destination-owned image is the default selected preview when one exists. If the stop has no destination-owned images, the default selected preview falls back to the first activity-owned image in the rollup.

Activity-owned images shown inside the stop carousel should be attributed to their activity, such as "Bakery crawl". Opening an activity-owned image in the full-screen modal from the stop rollup should offer an "Open activity" affordance without forcing navigation.

The stop carousel owns reordering for destination-owned images only. Activity-owned images appear in the stop rollup, but their order is controlled inside their parent activity carousel. Mixed rollup thumbnails must mark activity-owned items as non-reorderable in the stop carousel. Drag reorder from the stop carousel should only be enabled when every dragged and target thumbnail is destination-owned.

### Activity Carousel

The activity panel has its own preview image and thumbnail carousel, using only that activity's images.

The first activity-owned image by `sort_order` is the default selected activity preview. Uploading from the activity panel creates activity-owned media. Uploading from the stop panel creates destination-owned media.

The same preview-first browsing, optimized image URL selection, upload normalization, delete confirmation, and thumbnail reorder behavior from the stop reference image design should be reused for activity media. The existing `DestinationImageStrip`, `DestinationImagePreviewModal`, and `useDestinationMedia` behavior should be generalized or wrapped rather than forked into a separate parallel implementation. The reusable layer should accept owner-specific labels and repository handlers so a stop can say "Stop images" while an activity can say "Activity images".

Caption and credit metadata can remain on `MediaItem` and in repository patch methods, but Phase 2 should not put caption/credit editing back into the full-screen modal. If metadata editing is exposed, it should live in the stop or activity panel alongside the selected preview.

## Repository API

Extend the trip repository with activity CRUD and media ownership operations:

```ts
listActivities(destinationId: string): Promise<Activity[]>;

createActivity(input: {
  destinationId: string;
  title: string;
  order?: number;
}): Promise<Activity>;

updateActivity(
  activityId: string,
  patch: Partial<Omit<Activity, 'id' | 'tripId' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
): Promise<Activity>;

deleteActivity(activityId: string): Promise<void>;

reorderActivities(destinationId: string, orderedActivityIds: string[]): Promise<Activity[]>;

listDestinationMedia(destinationId: string): Promise<MediaItem[]>;

listDestinationMediaRollup(destinationId: string): Promise<MediaRollupItem[]>;

listActivityMedia(activityId: string): Promise<MediaItem[]>;

uploadDestinationMedia(input: {
  destinationId: string;
  file: File;
  caption?: string;
  credit?: string;
}): Promise<MediaItem>;

uploadActivityMedia(input: {
  destinationId: string;
  activityId: string;
  file: File;
  caption?: string;
  credit?: string;
}): Promise<MediaItem>;

reorderActivityMedia(activityId: string, orderedMediaIds: string[]): Promise<MediaItem[]>;
```

Existing stop media operations should keep destination-owned behavior by default. `listDestinationMedia`, `uploadDestinationMedia`, `updateDestinationMedia`, `deleteDestinationMedia`, and `reorderDestinationMedia` must operate only on rows where `activity_id is null`. The stop carousel should use `listDestinationMediaRollup` only when it needs the combined destination/activity view.

## Component Boundaries

Suggested components:

- `ActivityList`: renders the ordered activity list inside the stop panel.
- `ActivityPanel`: renders selected activity details to the left of the stop panel.
- Shared image strip and preview components: generalize or wrap the existing destination image components so both stop-owned and activity-owned media use the same large-preview, thumbnail selection, upload, full-screen preview, delete, and reorder behavior.
- `MapCanvas`: renders activity pins only for the selected stop and emits activity selection events.
- `App`: owns selected stop, selected activity, focus-layer map state, and viewport restoration.
- `useTripData`: owns repository-backed activity state and mutations.

`DestinationProfile` should not grow into the whole activity editor. It should host stop-level controls and the activity list, then delegate selected activity editing to `ActivityPanel`.

## Loading And Error States

Activity loading should not block the whole trip route view.

States to support:

- Loading activities for the selected stop.
- Creating an activity.
- Updating activity metadata.
- Reordering activities.
- Deleting an activity.
- Loading activity-owned media.
- Uploading activity images.
- Reordering activity images.
- Save failures for activity fields and media metadata.

If activity loading fails, the stop panel should remain usable and show an activity-specific retry/error state.

If an activity save fails, the activity panel should use the same clear save-status pattern as the existing stop profile.

## Phased Implementation

### Phase 1: Data Foundation And Basic Activity List

Add the `Activity` domain type, repository methods, Supabase table, local storage support, hook state/actions, and a basic ordered activity list inside the stop profile.

Activities can be added, renamed, reordered, selected, and deleted. Coordinates are optional but the first pass does not need rich map behavior.

### Phase 2: Rich Activity Panel And Media Ownership

Add the activity detail panel, rich fields, activity-owned media, activity image strip, stop carousel rollup, and media attribution.

This phase should reuse the current media behavior from the stop reference images design: optimized thumbnail/preview/full URLs, normalized uploads, thumbnail-selects-preview browsing, full-screen navigation without reorder, and thumbnail-only reorder within the current owner scope.

### Phase 3: Map Focus Layer

When a stop is selected, preserve the previous route viewport, zoom to the stop/activity bounds, show the selected stop's activity pins, and support selecting an activity from either the list or the map.

Closing the stop restores the route-level viewport and hides activity pins.

## Testing

Domain and hook tests should cover:

- Creating activities with default fields.
- Updating activity fields without rewriting unrelated data.
- Reordering activities within a destination.
- Deleting an activity.
- Keeping activities scoped to their destination.

Repository tests should cover:

- Supabase activity row mapping.
- Activity list ordering by `activity_order`.
- RLS-compatible trip/destination scoping.
- Activity media upload and listing.
- Stop media rollup ordering with destination-owned and activity-owned media.
- Destination media operations filtering out activity-owned rows.
- Activity media reorder scoped to the selected activity.
- Activity deletion behavior for associated media metadata and storage objects.

Component tests should cover:

- Empty activity list.
- Adding an activity under the selected stop.
- Selecting an activity opens the activity panel beside the stop panel.
- Reordering activities does not change stop order or route legs.
- Activities without coordinates do not render map pins.
- Activities with coordinates render pins only in selected-stop focus view.
- Selecting an activity highlights the list row and map pin.
- Closing the stop closes the activity panel and restores route view.
- Stop carousel includes destination-owned and activity-owned images.
- Activity carousel includes only selected activity images.
- Stop rollup thumbnails select the large preview and activity-owned thumbnails are attributed.
- Full-screen image navigation does not reorder images.

Browser checks should cover:

- Desktop two-panel layout.
- Narrow viewport collapse behavior.
- Stop focus viewport restoration.
- Activity pin visibility and selection.
- Stop carousel rollup attribution for activity images.

## Out Of Scope

- Scheduling activities by date, day number, or time.
- Showing all activity pins in route view.
- Promoting an activity to a stop.
- Trip-wide gallery pages.
- Public sharing.
- AI image analysis.
- Automatic activity recommendations.
