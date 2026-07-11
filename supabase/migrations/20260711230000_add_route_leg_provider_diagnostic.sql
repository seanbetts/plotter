alter table public.route_legs
  add column if not exists provider_diagnostic jsonb;
