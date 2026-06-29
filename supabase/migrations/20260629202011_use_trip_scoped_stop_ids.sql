alter table public.destinations
  drop constraint destinations_pkey,
  add constraint destinations_pkey primary key (trip_id, id);

alter table public.route_legs
  drop constraint route_legs_pkey,
  add constraint route_legs_pkey primary key (trip_id, id);
