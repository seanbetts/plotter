alter table public.media_assets
add column if not exists sort_order integer;

with ranked_media as (
  select
    id,
    row_number() over (
      partition by trip_id, destination_id
      order by created_at asc, id asc
    ) - 1 as next_sort_order
  from public.media_assets
)
update public.media_assets
set sort_order = ranked_media.next_sort_order
from ranked_media
where public.media_assets.id = ranked_media.id
  and public.media_assets.sort_order is null;

alter table public.media_assets
alter column sort_order set not null;

alter table public.media_assets
alter column sort_order drop default;

drop index if exists public.media_assets_trip_destination_order_idx;

create unique index if not exists media_assets_trip_destination_sort_order_key
on public.media_assets(trip_id, destination_id, sort_order)
where destination_id is not null;
