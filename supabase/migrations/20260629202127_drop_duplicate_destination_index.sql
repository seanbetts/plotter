alter table public.route_legs
  drop constraint route_legs_trip_id_origin_destination_id_fkey,
  drop constraint route_legs_trip_id_target_destination_id_fkey;

alter table public.media_assets
  drop constraint media_assets_trip_id_destination_id_fkey;

alter table public.destinations
  drop constraint destinations_trip_id_id_key;

alter table public.route_legs
  add constraint route_legs_trip_id_origin_destination_id_fkey
    foreign key (trip_id, origin_destination_id)
    references public.destinations(trip_id, id)
    on delete cascade,
  add constraint route_legs_trip_id_target_destination_id_fkey
    foreign key (trip_id, target_destination_id)
    references public.destinations(trip_id, id)
    on delete cascade;

alter table public.media_assets
  add constraint media_assets_trip_id_destination_id_fkey
    foreign key (trip_id, destination_id)
    references public.destinations(trip_id, id)
    on delete cascade;
