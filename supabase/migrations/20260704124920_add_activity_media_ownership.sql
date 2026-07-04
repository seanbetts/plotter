alter table public.media_assets
add column if not exists activity_id uuid;

alter table public.media_assets
alter column destination_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_assets_activity_owner_fk'
  ) then
    alter table public.media_assets
    add constraint media_assets_activity_owner_fk
      foreign key (trip_id, destination_id, activity_id)
      references public.activities(trip_id, destination_id, id)
      on delete cascade;
  end if;
end $$;

drop index if exists public.media_assets_trip_destination_sort_order_key;

create unique index if not exists media_assets_destination_owned_sort_order_key
on public.media_assets(trip_id, destination_id, sort_order)
where activity_id is null;

create unique index if not exists media_assets_activity_owned_sort_order_key
on public.media_assets(trip_id, destination_id, activity_id, sort_order)
where activity_id is not null;

create index if not exists media_assets_trip_destination_activity_idx
on public.media_assets(trip_id, destination_id, activity_id);
