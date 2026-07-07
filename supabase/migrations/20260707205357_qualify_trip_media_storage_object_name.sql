-- The trip-media policies join public.trips to authorize objects by the first
-- storage path segment. Qualify storage.objects.name so the expression does not
-- resolve to public.trips.name inside the EXISTS subquery.

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
      when (storage.foldername(storage.objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(storage.objects.name))[1])::uuid
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
      when (storage.foldername(storage.objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(storage.objects.name))[1])::uuid
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
      when (storage.foldername(storage.objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(storage.objects.name))[1])::uuid
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
      when (storage.foldername(storage.objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(storage.objects.name))[1])::uuid
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
      when (storage.foldername(storage.objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(storage.objects.name))[1])::uuid
      else null
    end
  )
);
