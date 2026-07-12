create or replace function public.apply_trip_mutation(
  p_trip_id uuid,
  p_destinations_to_upsert jsonb default '[]'::jsonb,
  p_destination_ids_to_delete uuid[] default '{}'::uuid[],
  p_route_legs_to_upsert jsonb default '[]'::jsonb,
  p_route_leg_ids_to_delete uuid[] default '{}'::uuid[]
)
returns table(bucket_id text, object_path text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_destinations_to_upsert, '[]'::jsonb)) as item
    where (item ->> 'trip_id')::uuid is distinct from p_trip_id
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_route_legs_to_upsert, '[]'::jsonb)) as item
    where (item ->> 'trip_id')::uuid is distinct from p_trip_id
  ) then
    raise exception 'Trip mutation rows must match p_trip_id';
  end if;

  return query
  select distinct media.bucket_id, media.object_path
  from public.media_assets as media
  where media.trip_id = p_trip_id
    and media.destination_id = any(p_destination_ids_to_delete);

  delete from public.route_legs
  where trip_id = p_trip_id
    and id = any(p_route_leg_ids_to_delete);

  insert into public.destinations
  select *
  from jsonb_populate_recordset(
    null::public.destinations,
    coalesce(p_destinations_to_upsert, '[]'::jsonb)
  )
  on conflict (trip_id, id) do update set
    name = excluded.name,
    country_region = excluded.country_region,
    lat = excluded.lat,
    lng = excluded.lng,
    location = excluded.location,
    stop_order = excluded.stop_order,
    status = excluded.status,
    priority = excluded.priority,
    timing = excluded.timing,
    why = excluded.why,
    media = excluded.media,
    research = excluded.research,
    activities = excluded.activities,
    route_context = excluded.route_context,
    routing_anchors = excluded.routing_anchors,
    tags = excluded.tags,
    updated_at = excluded.updated_at;

  insert into public.route_legs
  select *
  from jsonb_populate_recordset(
    null::public.route_legs,
    coalesce(p_route_legs_to_upsert, '[]'::jsonb)
  )
  on conflict (trip_id, id) do update set
    origin_destination_id = excluded.origin_destination_id,
    target_destination_id = excluded.target_destination_id,
    status = excluded.status,
    distance_km = excluded.distance_km,
    travel_time_hours = excluded.travel_time_hours,
    geometry = excluded.geometry,
    provider = excluded.provider,
    profile = excluded.profile,
    route_key = excluded.route_key,
    calculated_at = excluded.calculated_at,
    error = excluded.error,
    notes = excluded.notes,
    movement = excluded.movement,
    calculation_mode = excluded.calculation_mode,
    ferry_policy = excluded.ferry_policy,
    waypoints = excluded.waypoints,
    sections = excluded.sections,
    warnings = excluded.warnings,
    provider_diagnostic = excluded.provider_diagnostic,
    updated_at = excluded.updated_at;

  delete from public.destinations
  where trip_id = p_trip_id
    and id = any(p_destination_ids_to_delete);
end;
$$;

revoke all on function public.apply_trip_mutation(uuid, jsonb, uuid[], jsonb, uuid[]) from public;
grant execute on function public.apply_trip_mutation(uuid, jsonb, uuid[], jsonb, uuid[]) to authenticated;
