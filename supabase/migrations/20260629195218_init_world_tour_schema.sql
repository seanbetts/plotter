create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'World tour',
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_trips_updated_at
before update on public.trips
for each row execute function public.set_updated_at();

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index trip_members_user_id_idx on public.trip_members(user_id);

create trigger set_trip_members_updated_at
before update on public.trip_members
for each row execute function public.set_updated_at();

create table public.destinations (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  country_region text not null default '',
  lat double precision not null,
  lng double precision not null,
  location jsonb not null default '{}'::jsonb,
  stop_order integer not null default 0,
  status text not null default 'idea' check (status in ('idea', 'planned', 'confirmed', 'visited')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'must-do')),
  timing jsonb not null default '{}'::jsonb,
  why jsonb not null default '{}'::jsonb,
  media jsonb not null default '[]'::jsonb,
  research jsonb not null default '{}'::jsonb,
  activities jsonb not null default '{}'::jsonb,
  route_context jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, id)
);

create index destinations_trip_order_idx on public.destinations(trip_id, stop_order, created_at);
create index destinations_trip_updated_at_idx on public.destinations(trip_id, updated_at);

create trigger set_destinations_updated_at
before update on public.destinations
for each row execute function public.set_updated_at();

create table public.route_legs (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  origin_destination_id uuid not null,
  target_destination_id uuid not null,
  type text not null check (type in ('driving-auto', 'shipping-manual')),
  status text not null check (status in ('pending', 'calculating', 'ready', 'failed', 'manual')),
  distance_km double precision,
  travel_time_hours double precision,
  geometry jsonb,
  provider text,
  profile text,
  route_key text,
  calculated_at timestamptz,
  error text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trip_id, origin_destination_id)
    references public.destinations(trip_id, id)
    on delete cascade,
  foreign key (trip_id, target_destination_id)
    references public.destinations(trip_id, id)
    on delete cascade
);

create index route_legs_trip_updated_at_idx on public.route_legs(trip_id, updated_at);
create index route_legs_origin_destination_idx on public.route_legs(origin_destination_id);
create index route_legs_target_destination_idx on public.route_legs(target_destination_id);

create trigger set_route_legs_updated_at
before update on public.route_legs
for each row execute function public.set_updated_at();

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid,
  bucket_id text not null default 'trip-media',
  object_path text not null,
  caption text not null default '',
  credit text not null default '',
  content_type text,
  size_bytes bigint,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path),
  foreign key (trip_id, destination_id)
    references public.destinations(trip_id, id)
    on delete cascade
);

create index media_assets_trip_destination_idx on public.media_assets(trip_id, destination_id);

create trigger set_media_assets_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.destinations enable row level security;
alter table public.route_legs enable row level security;
alter table public.media_assets enable row level security;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on table
  public.trips,
  public.trip_members,
  public.destinations,
  public.route_legs,
  public.media_assets
to authenticated;
grant select, insert, update, delete on table
  public.trips,
  public.trip_members,
  public.destinations,
  public.route_legs,
  public.media_assets
to service_role;

create policy "Trip owners can view trips"
on public.trips
for select
to authenticated
using (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy "Users can create owned trips"
on public.trips
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy "Trip owners can update trips"
on public.trips
for update
to authenticated
using (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
)
with check (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy "Trip owners can delete trips"
on public.trips
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy "Trip owners can view members"
on public.trip_members
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = trip_members.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can add members"
on public.trip_members
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = trip_members.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can update members"
on public.trip_members
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = trip_members.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = trip_members.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete members"
on public.trip_members
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = trip_members.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can view destinations"
on public.destinations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can create destinations"
on public.destinations
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can update destinations"
on public.destinations
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete destinations"
on public.destinations
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = destinations.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can view route legs"
on public.route_legs
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can create route legs"
on public.route_legs
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can update route legs"
on public.route_legs
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete route legs"
on public.route_legs
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = route_legs.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can view media assets"
on public.media_assets
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can create media assets"
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
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can update media assets"
on public.media_assets
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete media assets"
on public.media_assets
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = media_assets.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-media',
  'trip-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Trip owners can read trip media"
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
    and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can upload trip media"
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
    and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can replace trip media"
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
    and trips.owner_user_id = (select auth.uid())
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
    and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete trip media"
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
    and trips.owner_user_id = (select auth.uid())
  )
);
