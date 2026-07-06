-- Personal multi-trip access model.
--
-- The app uses an anonymous authenticated Supabase session in a personal
-- project. The previous fixed-trip policy allowed only one canonical trip,
-- which blocks creating additional trips and any trip-scoped child rows for
-- those trips.

drop policy if exists "Personal app can view canonical trip" on public.trips;
drop policy if exists "Personal app can update canonical trip" on public.trips;
drop policy if exists "Authenticated app users can view trips" on public.trips;
drop policy if exists "Authenticated app users can create trips" on public.trips;
drop policy if exists "Authenticated app users can update trips" on public.trips;
drop policy if exists "Authenticated app users can delete trips" on public.trips;

create policy "Authenticated app users can view trips"
on public.trips
for select
to authenticated
using ((select auth.uid()) is not null);

create policy "Authenticated app users can create trips"
on public.trips
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy "Authenticated app users can update trips"
on public.trips
for update
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

create policy "Authenticated app users can delete trips"
on public.trips
for delete
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists "Personal app can view canonical destinations" on public.destinations;
drop policy if exists "Personal app can create canonical destinations" on public.destinations;
drop policy if exists "Personal app can update canonical destinations" on public.destinations;
drop policy if exists "Personal app can delete canonical destinations" on public.destinations;
drop policy if exists "Authenticated app users can view destinations" on public.destinations;
drop policy if exists "Authenticated app users can create destinations" on public.destinations;
drop policy if exists "Authenticated app users can update destinations" on public.destinations;
drop policy if exists "Authenticated app users can delete destinations" on public.destinations;

create policy "Authenticated app users can view destinations"
on public.destinations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
  )
);

create policy "Authenticated app users can create destinations"
on public.destinations
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
  )
);

create policy "Authenticated app users can update destinations"
on public.destinations
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
  )
);

create policy "Authenticated app users can delete destinations"
on public.destinations
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
  )
);

drop policy if exists "Personal app can view canonical route legs" on public.route_legs;
drop policy if exists "Personal app can create canonical route legs" on public.route_legs;
drop policy if exists "Personal app can update canonical route legs" on public.route_legs;
drop policy if exists "Personal app can delete canonical route legs" on public.route_legs;
drop policy if exists "Authenticated app users can view route legs" on public.route_legs;
drop policy if exists "Authenticated app users can create route legs" on public.route_legs;
drop policy if exists "Authenticated app users can update route legs" on public.route_legs;
drop policy if exists "Authenticated app users can delete route legs" on public.route_legs;

create policy "Authenticated app users can view route legs"
on public.route_legs
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
  )
);

create policy "Authenticated app users can create route legs"
on public.route_legs
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
  )
);

create policy "Authenticated app users can update route legs"
on public.route_legs
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
  )
);

create policy "Authenticated app users can delete route legs"
on public.route_legs
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
  )
);

drop policy if exists "Personal app can view canonical media assets" on public.media_assets;
drop policy if exists "Personal app can create canonical media assets" on public.media_assets;
drop policy if exists "Personal app can update canonical media assets" on public.media_assets;
drop policy if exists "Personal app can delete canonical media assets" on public.media_assets;
drop policy if exists "Authenticated app users can view media assets" on public.media_assets;
drop policy if exists "Authenticated app users can create media assets" on public.media_assets;
drop policy if exists "Authenticated app users can update media assets" on public.media_assets;
drop policy if exists "Authenticated app users can delete media assets" on public.media_assets;

create policy "Authenticated app users can view media assets"
on public.media_assets
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
  )
);

create policy "Authenticated app users can create media assets"
on public.media_assets
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and uploaded_by = (select auth.uid())
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
  )
);

create policy "Authenticated app users can update media assets"
on public.media_assets
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
  )
);

create policy "Authenticated app users can delete media assets"
on public.media_assets
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
  )
);

drop policy if exists "Personal app can view canonical activities" on public.activities;
drop policy if exists "Personal app can create canonical activities" on public.activities;
drop policy if exists "Personal app can update canonical activities" on public.activities;
drop policy if exists "Personal app can delete canonical activities" on public.activities;
drop policy if exists "Trip owners can view activities" on public.activities;
drop policy if exists "Trip owners can create activities" on public.activities;
drop policy if exists "Trip owners can update activities" on public.activities;
drop policy if exists "Trip owners can delete activities" on public.activities;
drop policy if exists "Authenticated app users can view activities" on public.activities;
drop policy if exists "Authenticated app users can create activities" on public.activities;
drop policy if exists "Authenticated app users can update activities" on public.activities;
drop policy if exists "Authenticated app users can delete activities" on public.activities;

create policy "Authenticated app users can view activities"
on public.activities
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
  )
);

create policy "Authenticated app users can create activities"
on public.activities
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
  )
);

create policy "Authenticated app users can update activities"
on public.activities
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
  )
);

create policy "Authenticated app users can delete activities"
on public.activities
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
  )
);

drop policy if exists "Personal app can read canonical trip media" on storage.objects;
drop policy if exists "Personal app can upload canonical trip media" on storage.objects;
drop policy if exists "Personal app can replace canonical trip media" on storage.objects;
drop policy if exists "Personal app can delete canonical trip media" on storage.objects;
drop policy if exists "Authenticated app users can read trip media" on storage.objects;
drop policy if exists "Authenticated app users can upload trip media" on storage.objects;
drop policy if exists "Authenticated app users can replace trip media" on storage.objects;
drop policy if exists "Authenticated app users can delete trip media" on storage.objects;

create policy "Authenticated app users can read trip media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trip-media'
  and exists (
    select 1
    from public.trips
    where trips.id = case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

create policy "Authenticated app users can upload trip media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trip-media'
  and exists (
    select 1
    from public.trips
    where trips.id = case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

create policy "Authenticated app users can replace trip media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'trip-media'
  and exists (
    select 1
    from public.trips
    where trips.id = case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
)
with check (
  bucket_id = 'trip-media'
  and exists (
    select 1
    from public.trips
    where trips.id = case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

create policy "Authenticated app users can delete trip media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trip-media'
  and exists (
    select 1
    from public.trips
    where trips.id = case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);
