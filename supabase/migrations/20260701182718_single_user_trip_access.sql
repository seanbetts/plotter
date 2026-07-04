drop policy if exists "Trip owners can view trips" on public.trips;

drop policy if exists "Users can create owned trips" on public.trips;

drop policy if exists "Trip owners can update trips" on public.trips;

drop policy if exists "Trip owners can delete trips" on public.trips;

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

drop policy if exists "Trip owners can view members" on public.trip_members;

drop policy if exists "Trip owners can add members" on public.trip_members;

drop policy if exists "Trip owners can update members" on public.trip_members;

drop policy if exists "Trip owners can delete members" on public.trip_members;

create policy "Authenticated app users can view members"
on public.trip_members
for select
to authenticated
using ((select auth.uid()) is not null);

create policy "Authenticated app users can add members"
on public.trip_members
for insert
to authenticated
with check ((select auth.uid()) is not null);

create policy "Authenticated app users can update members"
on public.trip_members
for update
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

create policy "Authenticated app users can delete members"
on public.trip_members
for delete
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists "Trip owners can view destinations" on public.destinations;

drop policy if exists "Trip owners can create destinations" on public.destinations;

drop policy if exists "Trip owners can update destinations" on public.destinations;

drop policy if exists "Trip owners can delete destinations" on public.destinations;

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

drop policy if exists "Trip owners can view route legs" on public.route_legs;

drop policy if exists "Trip owners can create route legs" on public.route_legs;

drop policy if exists "Trip owners can update route legs" on public.route_legs;

drop policy if exists "Trip owners can delete route legs" on public.route_legs;

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

drop policy if exists "Trip owners can view media assets" on public.media_assets;

drop policy if exists "Trip owners can create media assets" on public.media_assets;

drop policy if exists "Trip owners can update media assets" on public.media_assets;

drop policy if exists "Trip owners can delete media assets" on public.media_assets;

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

drop policy if exists "Trip owners can read trip media" on storage.objects;

drop policy if exists "Trip owners can upload trip media" on storage.objects;

drop policy if exists "Trip owners can replace trip media" on storage.objects;

drop policy if exists "Trip owners can delete trip media" on storage.objects;

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
