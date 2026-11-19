-- Headcount Jobs (simplify ticket 09). Additive only.
--
-- - responsibilities.kind: a Job takes turns (the default, and every existing Job) or is a
--   headcount: no Rotation and no seats; before each date every Member is asked "Coming?".
--   Not to be confused with responsibilities.headcount, which is people per turn.
-- - headcount_answers: each Member's Yes / No per date (Event) of a headcount Job, written by
--   the group-command Edge Function (engine state `GroupState.headcountAnswers`, command
--   `answerHeadcount`). Any Member may answer for a Stand-in. Readable by the Group's Members.
--
-- group_state_rows returns the answers too, and apply_group_command_result writes `kind`
-- and the answers (otherwise unchanged from 20261120000000_decline_reason.sql). Both accept
-- payloads from a group-command deployed before this migration (no kind: Jobs keep theirs, new ones take
-- turns; no answers: left alone), so the migration and the functions can be deployed in either order.

create type public.job_kind as enum ('turns', 'headcount');

alter table public.responsibilities add column kind public.job_kind not null default 'turns';

create type public.headcount_reply as enum ('yes', 'no');

create table public.headcount_answers (
  group_id uuid not null references public.groups (id) on delete cascade,
  event_id text not null,
  responsibility_id text not null,
  member_id text not null,
  position integer not null,
  answer public.headcount_reply not null,
  -- Who answered: the Member, or someone else in the Group for a Stand-in. null: the system.
  answered_by text,
  answered_at timestamptz not null,
  primary key (group_id, event_id, responsibility_id, member_id),
  foreign key (group_id, event_id) references public.events (group_id, id) deferrable initially deferred,
  foreign key (group_id, responsibility_id) references public.responsibilities (group_id, id)
    deferrable initially deferred,
  foreign key (group_id, member_id) references public.members (group_id, id) deferrable initially deferred
);

alter table public.headcount_answers enable row level security;
create policy headcount_answers_select_member on public.headcount_answers for select to authenticated
  using (public.is_group_member(group_id));
revoke all on public.headcount_answers from anon, authenticated;
grant select on public.headcount_answers to authenticated;
grant all on public.headcount_answers to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.headcount_answers;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- group_state_rows, now with `headcount_answers`.

create or replace function public.group_state_rows(p_group_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'group', (select to_jsonb(g) from public.groups g where g.id = p_group_id),
    'members', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.members x where x.group_id = p_group_id), '[]'),
    'responsibilities', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.responsibilities x where x.group_id = p_group_id), '[]'),
    'rotations', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.rotations x where x.group_id = p_group_id), '[]'),
    'event_series', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.event_series x where x.group_id = p_group_id), '[]'),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.events x where x.group_id = p_group_id), '[]'),
    'time_off', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.time_off x where x.group_id = p_group_id), '[]'),
    'make_up_turns', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.make_up_turns x where x.group_id = p_group_id), '[]'),
    'assignments', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.assignments x where x.group_id = p_group_id), '[]'),
    'headcount_answers', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.headcount_answers x where x.group_id = p_group_id), '[]')
  )
$$;

-- ---------------------------------------------------------------------------
-- apply_group_command_result, now also writing responsibilities.kind and headcount_answers.

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
  v_has_kind boolean;
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

  -- Responsibilities. A payload without `kind` (from a group-command deployed before this
  -- migration) adds Jobs that take turns and leaves existing Jobs' kind alone.
  v_has_kind := exists (
    select 1 from jsonb_array_elements(p_rows -> 'responsibilities') x where x ? 'kind'
  );
  insert into public.responsibilities as t
    (group_id, id, position, name, kind, headcount, requires_confirmation, removed_at)
  select p_group_id, r.id, r.position, r.name, coalesce(r.kind, 'turns'), r.headcount, r.requires_confirmation,
    r.removed_at
  from jsonb_populate_recordset(null::public.responsibilities, p_rows -> 'responsibilities') r
  on conflict (group_id, id) do update set
    position = excluded.position, name = excluded.name,
    kind = case when v_has_kind then excluded.kind else t.kind end, headcount = excluded.headcount,
    requires_confirmation = excluded.requires_confirmation, removed_at = excluded.removed_at
  where (t.position, t.name, t.kind, t.headcount, t.requires_confirmation, t.removed_at)
    is distinct from (excluded.position, excluded.name, case when v_has_kind then excluded.kind else t.kind end,
      excluded.headcount, excluded.requires_confirmation, excluded.removed_at);

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
    (group_id, id, position, series_id, starts_at, responsibility_ids, skip_date_marked_at, skip_date_marked_by,
     skip_date_reason)
  select p_group_id, r.id, r.position, r.series_id, r.starts_at, r.responsibility_ids,
    r.skip_date_marked_at, r.skip_date_marked_by, r.skip_date_reason
  from jsonb_populate_recordset(null::public.events, p_rows -> 'events') r
  on conflict (group_id, id) do update set
    position = excluded.position, series_id = excluded.series_id, starts_at = excluded.starts_at,
    responsibility_ids = excluded.responsibility_ids, skip_date_marked_at = excluded.skip_date_marked_at,
    skip_date_marked_by = excluded.skip_date_marked_by, skip_date_reason = excluded.skip_date_reason
  where (t.position, t.series_id, t.starts_at, t.responsibility_ids, t.skip_date_marked_at, t.skip_date_marked_by,
      t.skip_date_reason)
    is distinct from (excluded.position, excluded.series_id, excluded.starts_at, excluded.responsibility_ids,
      excluded.skip_date_marked_at, excluded.skip_date_marked_by, excluded.skip_date_reason);

  -- Time Off
  insert into public.time_off as t
    (group_id, id, position, member_id, starts_at, ends_at, repeat_every_weeks, repeat_until,
     responsibility_ids, removed_at, retained_event_ids, time_zone, note)
  select p_group_id, r.id, r.position, r.member_id, r.starts_at, r.ends_at, r.repeat_every_weeks,
    r.repeat_until, r.responsibility_ids, r.removed_at, r.retained_event_ids, r.time_zone, r.note
  from jsonb_populate_recordset(null::public.time_off, p_rows -> 'time_off') r
  on conflict (group_id, id) do update set
    position = excluded.position, member_id = excluded.member_id, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, repeat_every_weeks = excluded.repeat_every_weeks,
    repeat_until = excluded.repeat_until, responsibility_ids = excluded.responsibility_ids,
    removed_at = excluded.removed_at, retained_event_ids = excluded.retained_event_ids,
    time_zone = excluded.time_zone, note = excluded.note
  where (t.position, t.member_id, t.starts_at, t.ends_at, t.repeat_every_weeks, t.repeat_until,
      t.responsibility_ids, t.removed_at, t.retained_event_ids, t.time_zone, t.note)
    is distinct from (excluded.position, excluded.member_id, excluded.starts_at, excluded.ends_at,
      excluded.repeat_every_weeks, excluded.repeat_until, excluded.responsibility_ids, excluded.removed_at,
      excluded.retained_event_ids, excluded.time_zone, excluded.note);

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
     cover_guest_name, cover_arranged_by, covered_at, coverage_note)
  select p_group_id, r.id, r.position, r.event_id, r.responsibility_id, r.member_id, r.turn_of,
    r.make_up_turn_id, r.confirmation, r.coverage_reason, r.coverage_requested_by, r.coverage_requested_at,
    r.cover_kind, r.cover_member_id, r.cover_guest_name, r.cover_arranged_by, r.covered_at, r.coverage_note
  from jsonb_populate_recordset(null::public.assignments, p_rows -> 'assignments') r
  on conflict (group_id, id) do update set
    position = excluded.position, event_id = excluded.event_id, responsibility_id = excluded.responsibility_id,
    member_id = excluded.member_id, turn_of = excluded.turn_of, make_up_turn_id = excluded.make_up_turn_id,
    confirmation = excluded.confirmation, coverage_reason = excluded.coverage_reason,
    coverage_requested_by = excluded.coverage_requested_by,
    coverage_requested_at = excluded.coverage_requested_at, cover_kind = excluded.cover_kind,
    cover_member_id = excluded.cover_member_id, cover_guest_name = excluded.cover_guest_name,
    cover_arranged_by = excluded.cover_arranged_by, covered_at = excluded.covered_at,
    coverage_note = excluded.coverage_note
  where (t.position, t.event_id, t.responsibility_id, t.member_id, t.turn_of, t.make_up_turn_id, t.confirmation,
      t.coverage_reason, t.coverage_requested_by, t.coverage_requested_at, t.cover_kind, t.cover_member_id,
      t.cover_guest_name, t.cover_arranged_by, t.covered_at, t.coverage_note)
    is distinct from (excluded.position, excluded.event_id, excluded.responsibility_id, excluded.member_id,
      excluded.turn_of, excluded.make_up_turn_id, excluded.confirmation, excluded.coverage_reason,
      excluded.coverage_requested_by, excluded.coverage_requested_at, excluded.cover_kind,
      excluded.cover_member_id, excluded.cover_guest_name, excluded.cover_arranged_by, excluded.covered_at,
      excluded.coverage_note);

  -- Headcount answers. Only when the payload has them: a group-command from before this
  -- migration doesn't send the array, and must not wipe them.
  if jsonb_typeof(p_rows -> 'headcount_answers') = 'array' then
    insert into public.headcount_answers as t
      (group_id, event_id, responsibility_id, member_id, position, answer, answered_by, answered_at)
    select p_group_id, r.event_id, r.responsibility_id, r.member_id, r.position, r.answer, r.answered_by,
      r.answered_at
    from jsonb_populate_recordset(null::public.headcount_answers, p_rows -> 'headcount_answers') r
    on conflict (group_id, event_id, responsibility_id, member_id) do update set
      position = excluded.position, answer = excluded.answer, answered_by = excluded.answered_by,
      answered_at = excluded.answered_at
    where (t.position, t.answer, t.answered_by, t.answered_at)
      is distinct from (excluded.position, excluded.answer, excluded.answered_by, excluded.answered_at);

    delete from public.headcount_answers t where t.group_id = p_group_id
      and (t.event_id, t.responsibility_id, t.member_id) not in (
        select r ->> 'event_id', r ->> 'responsibility_id', r ->> 'member_id'
        from jsonb_array_elements(p_rows -> 'headcount_answers') r);
  else
    -- Still drop the answers of Events that are going away, so deleting those Events works.
    delete from public.headcount_answers t where t.group_id = p_group_id
      and t.event_id not in (select r ->> 'id' from jsonb_array_elements(p_rows -> 'events') r);
  end if;

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
