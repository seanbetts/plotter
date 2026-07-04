-- Keep activities aligned with the personal canonical-trip access model.
-- The activities table was introduced after the original personal access
-- migration, so it still had owner-based policies while destinations did not.

drop policy if exists "Trip owners can view activities" on public.activities;
drop policy if exists "Trip owners can create activities" on public.activities;
drop policy if exists "Trip owners can update activities" on public.activities;
drop policy if exists "Trip owners can delete activities" on public.activities;

drop policy if exists "Personal app can view canonical activities" on public.activities;
drop policy if exists "Personal app can create canonical activities" on public.activities;
drop policy if exists "Personal app can update canonical activities" on public.activities;
drop policy if exists "Personal app can delete canonical activities" on public.activities;

create policy "Personal app can view canonical activities"
on public.activities
for select
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can create canonical activities"
on public.activities
for insert
to authenticated
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can update canonical activities"
on public.activities
for update
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
)
with check (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);

create policy "Personal app can delete canonical activities"
on public.activities
for delete
to authenticated
using (
  trip_id = '66ba131d-378f-4547-aac2-224b3d24d04a'::uuid
);
