create table public.activities (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid not null,
  activity_order integer not null default 0,
  title text not null,
  description text not null default '',
  category text not null default 'other' check (category in (
    'food',
    'culture',
    'outdoors',
    'street-art',
    'ski',
    'detour',
    'logistics',
    'other'
  )),
  status text not null default 'idea' check (status in (
    'idea',
    'planned',
    'booked',
    'done',
    'skipped'
  )),
  priority text not null default 'medium' check (priority in (
    'low',
    'medium',
    'high',
    'must-do'
  )),
  location jsonb,
  links jsonb not null default '[]'::jsonb,
  notes text not null default '',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trip_id, destination_id)
    references public.destinations(trip_id, id)
    on delete cascade,
  unique (trip_id, destination_id, id)
);

create index activities_trip_destination_order_idx
on public.activities(trip_id, destination_id, activity_order, created_at);

create index activities_trip_updated_at_idx
on public.activities(trip_id, updated_at);

create trigger set_activities_updated_at
before update on public.activities
for each row execute function public.set_updated_at();

alter table public.activities enable row level security;

grant select, insert, update, delete on table public.activities to authenticated;
grant select, insert, update, delete on table public.activities to service_role;

create policy "Trip owners can view activities"
on public.activities
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can create activities"
on public.activities
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can update activities"
on public.activities
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete activities"
on public.activities
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);
