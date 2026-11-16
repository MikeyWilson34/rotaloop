-- Group setup commands (ticket 13): removable Responsibilities and Event Series, and the
-- Event Series repeat pattern. Additive only; 20261115000000_schema_and_rls.sql is applied.
--
-- - responsibilities.removed_at / event_series.removed_at: removal keeps the row, because
--   past Assignments and Events still point to it (Responsibility.removedAt and
--   EventSeries.removedAt in the engine).
-- - event_series.repeat: the engine's RepeatPattern as JSON, e.g.
--     { "frequency": "biweekly", "intervalWeeks": null, "daysOfWeek": [0], "weekOfMonth": null,
--       "startTime": "09:00", "timeZone": "America/Chicago", "startsOn": "2027-01-03" }
--   frequency weekly | biweekly | monthly | custom; intervalWeeks (custom only) is weeks
--   between occurrences; weekOfMonth (monthly only) is 1-4 or -1 for the last; daysOfWeek
--   0 = Sunday. null = no stored pattern. The engine never expands it: a server job turns
--   it into Events.
-- - make_up_turn_closed_reason gains 'responsibilityRemoved'.

alter type public.make_up_turn_closed_reason add value if not exists 'responsibilityRemoved';

alter table public.responsibilities add column removed_at timestamptz;

-- Shape check for event_series.repeat (the engine validates the details too).
create function public.is_repeat_pattern(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and p ->> 'frequency' in ('weekly', 'biweekly', 'monthly', 'custom')
    and jsonb_typeof(p -> 'daysOfWeek') = 'array'
    and jsonb_array_length(p -> 'daysOfWeek') between 1 and 7
    and not exists (
      select 1 from jsonb_array_elements(p -> 'daysOfWeek') d
      where jsonb_typeof(d) <> 'number' or (d #>> '{}')::numeric not in (0, 1, 2, 3, 4, 5, 6)
    )
    and ((p ->> 'frequency') = 'custom') = (jsonb_typeof(p -> 'intervalWeeks') = 'number')
    and ((p ->> 'frequency') = 'monthly') = (jsonb_typeof(p -> 'weekOfMonth') = 'number')
    and (p ->> 'startTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and length(btrim(p ->> 'timeZone')) > 0
    and (p ->> 'startsOn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
    false
  )
$$;

alter table public.event_series
  add column repeat jsonb check (repeat is null or public.is_repeat_pattern(repeat)),
  add column removed_at timestamptz;

revoke execute on function public.is_repeat_pattern(jsonb) from public, anon, authenticated;
grant execute on function public.is_repeat_pattern(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- apply_group_command_result, now also writing the new columns (otherwise unchanged).

create or replace function public.apply_group_command_result(
  p_group_id uuid,
  p_expected_version bigint,
  p_rows jsonb,
  p_history jsonb default '[]'
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  g jsonb := p_rows -> 'group';
  v_version bigint;
begin
  if g is null then
    raise exception 'p_rows.group is required' using errcode = '22023';
  end if;
  -- A missing array would read as "delete every row", so require all of them.
  if exists (
    select 1 from unnest(array['members', 'responsibilities', 'rotations', 'event_series', 'events',
      'time_off', 'make_up_turns', 'assignments']) k
    where jsonb_typeof(p_rows -> k) is distinct from 'array'
  ) then
    raise exception 'p_rows must contain every row array' using errcode = '22023';
  end if;

  if p_expected_version is null then
    insert into public.groups (id, name, time_zone, created_by, state_version)
    values (
      p_group_id,
      g ->> 'name',
      coalesce(g ->> 'time_zone', 'UTC'),
      (g ->> 'created_by')::uuid,
      0
    )
    on conflict (id) do nothing;
    if not found then
      return null;
    end if;
    p_expected_version := 0;
  end if;

  update public.groups set
    state_version = state_version + 1,
    coverage_policy = (g ->> 'coverage_policy')::public.coverage_policy,
    time_off_handling = (g ->> 'time_off_handling')::public.time_off_handling,
    allow_doubling = (g ->> 'allow_doubling')::boolean,
    replacement_duty = (g ->> 'replacement_duty')::public.replacement_duty,
    replacement_deadline_ms = (g ->> 'replacement_deadline_ms')::bigint,
    primary_responsibility_id = g ->> 'primary_responsibility_id',
    rotated_through = (g ->> 'rotated_through')::timestamptz,
    id_sequence = (g ->> 'id_sequence')::integer
  where id = p_group_id and state_version = p_expected_version
  returning state_version into v_version;

  if v_version is null then
    return null;
  end if;

  -- Members
  insert into public.members as t (group_id, id, position, display_name, is_admin, account_id, left_at)
  select p_group_id, r.id, r.position, r.display_name, r.is_admin, r.account_id, r.left_at
  from jsonb_populate_recordset(null::public.members, p_rows -> 'members') r
  on conflict (group_id, id) do update set
    position = excluded.position, display_name = excluded.display_name, is_admin = excluded.is_admin,
    account_id = excluded.account_id, left_at = excluded.left_at
  where (t.position, t.display_name, t.is_admin, t.account_id, t.left_at)
    is distinct from (excluded.position, excluded.display_name, excluded.is_admin, excluded.account_id, excluded.left_at);

  -- Responsibilities
  insert into public.responsibilities as t
    (group_id, id, position, name, headcount, requires_confirmation, removed_at)
  select p_group_id, r.id, r.position, r.name, r.headcount, r.requires_confirmation, r.removed_at
  from jsonb_populate_recordset(null::public.responsibilities, p_rows -> 'responsibilities') r
  on conflict (group_id, id) do update set
    position = excluded.position, name = excluded.name, headcount = excluded.headcount,
    requires_confirmation = excluded.requires_confirmation, removed_at = excluded.removed_at
  where (t.position, t.name, t.headcount, t.requires_confirmation, t.removed_at)
    is distinct from (excluded.position, excluded.name, excluded.headcount, excluded.requires_confirmation,
      excluded.removed_at);

  -- Rotations
  insert into public.rotations as t (group_id, responsibility_id, position, queue, turns_taken_early)
  select p_group_id, r.responsibility_id, r.position, r.queue, r.turns_taken_early
  from jsonb_populate_recordset(null::public.rotations, p_rows -> 'rotations') r
  on conflict (group_id, responsibility_id) do update set
    position = excluded.position, queue = excluded.queue, turns_taken_early = excluded.turns_taken_early
  where (t.position, t.queue, t.turns_taken_early)
    is distinct from (excluded.position, excluded.queue, excluded.turns_taken_early);

  -- Event Series
  insert into public.event_series as t (group_id, id, position, name, responsibility_ids, repeat, removed_at)
  select p_group_id, r.id, r.position, r.name, r.responsibility_ids, r.repeat, r.removed_at
  from jsonb_populate_recordset(null::public.event_series, p_rows -> 'event_series') r
  on conflict (group_id, id) do update set
    position = excluded.position, name = excluded.name, responsibility_ids = excluded.responsibility_ids,
    repeat = excluded.repeat, removed_at = excluded.removed_at
  where (t.position, t.name, t.responsibility_ids, t.repeat, t.removed_at)
    is distinct from (excluded.position, excluded.name, excluded.responsibility_ids, excluded.repeat,
      excluded.removed_at);

  -- Events
  insert into public.events as t
    (group_id, id, position, series_id, starts_at, responsibility_ids, skip_date_marked_at, skip_date_marked_by)
  select p_group_id, r.id, r.position, r.series_id, r.starts_at, r.responsibility_ids,
    r.skip_date_marked_at, r.skip_date_marked_by
  from jsonb_populate_recordset(null::public.events, p_rows -> 'events') r
  on conflict (group_id, id) do update set
    position = excluded.position, series_id = excluded.series_id, starts_at = excluded.starts_at,
    responsibility_ids = excluded.responsibility_ids, skip_date_marked_at = excluded.skip_date_marked_at,
    skip_date_marked_by = excluded.skip_date_marked_by
  where (t.position, t.series_id, t.starts_at, t.responsibility_ids, t.skip_date_marked_at, t.skip_date_marked_by)
    is distinct from (excluded.position, excluded.series_id, excluded.starts_at, excluded.responsibility_ids,
      excluded.skip_date_marked_at, excluded.skip_date_marked_by);

  -- Time Off
  insert into public.time_off as t
    (group_id, id, position, member_id, starts_at, ends_at, repeat_every_weeks, repeat_until,
     responsibility_ids, removed_at, retained_event_ids)
  select p_group_id, r.id, r.position, r.member_id, r.starts_at, r.ends_at, r.repeat_every_weeks,
    r.repeat_until, r.responsibility_ids, r.removed_at, r.retained_event_ids
  from jsonb_populate_recordset(null::public.time_off, p_rows -> 'time_off') r
  on conflict (group_id, id) do update set
    position = excluded.position, member_id = excluded.member_id, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, repeat_every_weeks = excluded.repeat_every_weeks,
    repeat_until = excluded.repeat_until, responsibility_ids = excluded.responsibility_ids,
    removed_at = excluded.removed_at, retained_event_ids = excluded.retained_event_ids
  where (t.position, t.member_id, t.starts_at, t.ends_at, t.repeat_every_weeks, t.repeat_until,
      t.responsibility_ids, t.removed_at, t.retained_event_ids)
    is distinct from (excluded.position, excluded.member_id, excluded.starts_at, excluded.ends_at,
      excluded.repeat_every_weeks, excluded.repeat_until, excluded.responsibility_ids, excluded.removed_at,
      excluded.retained_event_ids);

  -- Make-up Turns
  insert into public.make_up_turns as t
    (group_id, id, position, responsibility_id, debtor_id, creditor_id, cover_assignment_id, created_at,
     status, closed_at, closed_reason)
  select p_group_id, r.id, r.position, r.responsibility_id, r.debtor_id, r.creditor_id,
    r.cover_assignment_id, r.created_at, r.status, r.closed_at, r.closed_reason
  from jsonb_populate_recordset(null::public.make_up_turns, p_rows -> 'make_up_turns') r
  on conflict (group_id, id) do update set
    position = excluded.position, responsibility_id = excluded.responsibility_id,
    debtor_id = excluded.debtor_id, creditor_id = excluded.creditor_id,
    cover_assignment_id = excluded.cover_assignment_id, created_at = excluded.created_at,
    status = excluded.status, closed_at = excluded.closed_at, closed_reason = excluded.closed_reason
  where (t.position, t.responsibility_id, t.debtor_id, t.creditor_id, t.cover_assignment_id, t.created_at,
      t.status, t.closed_at, t.closed_reason)
    is distinct from (excluded.position, excluded.responsibility_id, excluded.debtor_id, excluded.creditor_id,
      excluded.cover_assignment_id, excluded.created_at, excluded.status, excluded.closed_at,
      excluded.closed_reason);

  -- Assignments
  insert into public.assignments as t
    (group_id, id, position, event_id, responsibility_id, member_id, turn_of, make_up_turn_id, confirmation,
     coverage_reason, coverage_requested_by, coverage_requested_at, cover_kind, cover_member_id,
     cover_guest_name, cover_arranged_by, covered_at)
  select p_group_id, r.id, r.position, r.event_id, r.responsibility_id, r.member_id, r.turn_of,
    r.make_up_turn_id, r.confirmation, r.coverage_reason, r.coverage_requested_by, r.coverage_requested_at,
    r.cover_kind, r.cover_member_id, r.cover_guest_name, r.cover_arranged_by, r.covered_at
  from jsonb_populate_recordset(null::public.assignments, p_rows -> 'assignments') r
  on conflict (group_id, id) do update set
    position = excluded.position, event_id = excluded.event_id, responsibility_id = excluded.responsibility_id,
    member_id = excluded.member_id, turn_of = excluded.turn_of, make_up_turn_id = excluded.make_up_turn_id,
    confirmation = excluded.confirmation, coverage_reason = excluded.coverage_reason,
    coverage_requested_by = excluded.coverage_requested_by,
    coverage_requested_at = excluded.coverage_requested_at, cover_kind = excluded.cover_kind,
    cover_member_id = excluded.cover_member_id, cover_guest_name = excluded.cover_guest_name,
    cover_arranged_by = excluded.cover_arranged_by, covered_at = excluded.covered_at
  where (t.position, t.event_id, t.responsibility_id, t.member_id, t.turn_of, t.make_up_turn_id, t.confirmation,
      t.coverage_reason, t.coverage_requested_by, t.coverage_requested_at, t.cover_kind, t.cover_member_id,
      t.cover_guest_name, t.cover_arranged_by, t.covered_at)
    is distinct from (excluded.position, excluded.event_id, excluded.responsibility_id, excluded.member_id,
      excluded.turn_of, excluded.make_up_turn_id, excluded.confirmation, excluded.coverage_reason,
      excluded.coverage_requested_by, excluded.coverage_requested_at, excluded.cover_kind,
      excluded.cover_member_id, excluded.cover_guest_name, excluded.cover_arranged_by, excluded.covered_at);

  -- Rows no longer in the state (dependents first).
  delete from public.assignments t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'assignments') r);
  delete from public.make_up_turns t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'make_up_turns') r);
  delete from public.time_off t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'time_off') r);
  delete from public.events t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'events') r);
  delete from public.event_series t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'event_series') r);
  delete from public.rotations t where t.group_id = p_group_id
    and t.responsibility_id not in (select r ->> 'responsibility_id' from jsonb_array_elements(p_rows -> 'rotations') r);
  delete from public.responsibilities t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'responsibilities') r);
  delete from public.members t where t.group_id = p_group_id
    and t.id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'members') r);

  -- History entries, in order.
  insert into public.schedule_history (group_id, state_version, at, actor_id, cause, changes, make_up_turns)
  select p_group_id, v_version, (h ->> 'at')::timestamptz, h ->> 'actorId', h -> 'cause',
    coalesce(h -> 'changes', '[]'), coalesce(h -> 'makeUpTurns', '[]')
  from jsonb_array_elements(coalesce(p_history, '[]')) with ordinality as e(h, n)
  order by n;

  return v_version;
end;
$$;
