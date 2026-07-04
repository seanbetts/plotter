-- Personal-app access model: this frontend edits one canonical trip.
-- If this becomes a multi-user or multi-trip app, replace this with
-- member-based policies keyed from public.trip_members.

drop policy if exists "Authenticated app users can view trips" on public.trips;

drop policy if exists "Authenticated app users can create trips" on public.trips;

drop policy if exists "Authenticated app users can update trips" on public.trips;

drop policy if exists "Authenticated app users can delete trips" on public.trips;

drop policy if exists "Authenticated app users can view members" on public.trip_members;

drop policy if exists "Authenticated app users can add members" on public.trip_members;

drop policy if exists "Authenticated app users can update members" on public.trip_members;

drop policy if exists "Authenticated app users can delete members" on public.trip_members;

drop policy if exists "Authenticated app users can view destinations" on public.destinations;

drop policy if exists "Authenticated app users can create destinations" on public.destinations;

drop policy if exists "Authenticated app users can update destinations" on public.destinations;

drop policy if exists "Authenticated app users can delete destinations" on public.destinations;

drop policy if exists "Authenticated app users can view route legs" on public.route_legs;

drop policy if exists "Authenticated app users can create route legs" on public.route_legs;

drop policy if exists "Authenticated app users can update route legs" on public.route_legs;

drop policy if exists "Authenticated app users can delete route legs" on public.route_legs;

drop policy if exists "Authenticated app users can view media assets" on public.media_assets;

drop policy if exists "Authenticated app users can create media assets" on public.media_assets;

drop policy if exists "Authenticated app users can update media assets" on public.media_assets;

drop policy if exists "Authenticated app users can delete media assets" on public.media_assets;

drop policy if exists "Authenticated app users can read trip media" on storage.objects;

drop policy if exists "Authenticated app users can upload trip media" on storage.objects;

drop policy if exists "Authenticated app users can replace trip media" on storage.objects;

drop policy if exists "Authenticated app users can delete trip media" on storage.objects;

create policy "Personal app can view canonical trip"
on public.trips
for select
to authenticated
using (
  id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can update canonical trip"
on public.trips
for update
to authenticated
using (
  id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
)
with check (
  id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can view canonical destinations"
on public.destinations
for select
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can create canonical destinations"
on public.destinations
for insert
to authenticated
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can update canonical destinations"
on public.destinations
for update
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
)
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can delete canonical destinations"
on public.destinations
for delete
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can view canonical route legs"
on public.route_legs
for select
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can create canonical route legs"
on public.route_legs
for insert
to authenticated
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can update canonical route legs"
on public.route_legs
for update
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
)
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can delete canonical route legs"
on public.route_legs
for delete
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can view canonical media assets"
on public.media_assets
for select
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can create canonical media assets"
on public.media_assets
for insert
to authenticated
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
  and uploaded_by = (select auth.uid())
);

create policy "Personal app can update canonical media assets"
on public.media_assets
for update
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
)
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can delete canonical media assets"
on public.media_assets
for delete
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can read canonical trip media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trip-media'
  and (storage.foldername(name))[1] = '66ba131d-378f-4547-aac2-224b3d24d04a'
);

create policy "Personal app can upload canonical trip media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trip-media'
  and (storage.foldername(name))[1] = '66ba131d-378f-4547-aac2-224b3d24d04a'
);

create policy "Personal app can replace canonical trip media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'trip-media'
  and (storage.foldername(name))[1] = '66ba131d-378f-4547-aac2-224b3d24d04a'
)
with check (
  bucket_id = 'trip-media'
  and (storage.foldername(name))[1] = '66ba131d-378f-4547-aac2-224b3d24d04a'
);

create policy "Personal app can delete canonical trip media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trip-media'
  and (storage.foldername(name))[1] = '66ba131d-378f-4547-aac2-224b3d24d04a'
);
