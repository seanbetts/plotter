alter table public.destinations
  add column routing_anchors jsonb not null default '{}'::jsonb;

update public.trips
set
  vehicle_profile = 'driving-car',
  vehicle_type = null
where vehicle_preset = 'large-camper';
