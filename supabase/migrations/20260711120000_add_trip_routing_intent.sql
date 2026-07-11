alter table public.trips
  add column vehicle_preset text not null default 'standard'
    check (vehicle_preset in ('standard', 'large-camper', 'expedition-truck')),
  add column vehicle_profile text not null default 'driving-car'
    check (vehicle_profile in ('driving-car', 'driving-hgv')),
  add column vehicle_type text null check (vehicle_type is null or vehicle_type = 'hgv'),
  add column vehicle_restrictions jsonb not null default '{}'::jsonb;

alter table public.route_legs
  add column movement text not null default 'drive'
    check (movement in ('drive', 'vehicle-shipping')),
  add column calculation_mode text not null default 'automatic'
    check (calculation_mode in ('automatic', 'manual')),
  add column ferry_policy text not null default 'allow'
    check (ferry_policy in ('allow', 'avoid', 'require')),
  add column waypoints jsonb not null default '[]'::jsonb,
  add column sections jsonb not null default '[]'::jsonb,
  add column warnings jsonb not null default '[]'::jsonb;

update public.route_legs
set movement = case when type = 'shipping-manual' then 'vehicle-shipping' else 'drive' end,
    calculation_mode = case when type = 'shipping-manual' then 'manual' else 'automatic' end;

alter table public.route_legs drop constraint route_legs_status_check;
alter table public.route_legs add constraint route_legs_status_check
  check (status in ('pending', 'calculating', 'ready', 'failed', 'manual', 'review-required'));
