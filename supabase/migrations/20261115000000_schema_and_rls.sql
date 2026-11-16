-- Rotaloop schema: Groups and their scheduling state, profiles, push tokens, invite links.
--
-- Scheduling state (everything the rotation engine's GroupState holds) is written only by
-- the `group-command` Edge Function, through `apply_group_command_result` (see
-- docs/adr/0004-schedule-writes-go-through-the-engine.md). Clients read it through RLS and
-- never write it. Engine ids are unique per Group only, so engine-owned tables use
-- composite primary keys (group_id, id). `position` keeps each GroupState array's order so
-- that rows -> GroupState -> rows round-trips exactly.

-- ---------------------------------------------------------------------------
-- Enums (values match the engine's string unions)

create type public.coverage_policy as enum ('payItBack', 'countRealWork');
create type public.time_off_handling as enum ('routeAround', 'askVolunteer');
create type public.replacement_duty as enum ('assignedMember', 'admins');
create type public.confirmation as enum ('notRequired', 'notYetRequested', 'requested', 'confirmed');
create type public.coverage_request_reason as enum ('declined', 'timeOff', 'noOneAvailable');
create type public.cover_kind as enum ('member', 'guest');
create type public.make_up_turn_status as enum ('outstanding', 'paid', 'settled', 'cancelled');
create type public.make_up_turn_closed_reason as enum (
  'paid', 'movedAlong', 'rebalance', 'coveragePolicyChanged', 'memberLeft', 'memberNoLongerQualified', 'coverWithdrawn'
);
create type public.push_platform as enum ('ios', 'android', 'web');

-- An unguessable token for invite links (two v4 UUIDs: 244 random bits).
create function public.new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per account; written by its owner)

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 80),
  -- Notification channels. Push is on by default; email and SMS are opt-ins that are
  -- stored but not delivered in the MVP.
  push_enabled boolean not null default true,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  phone text check (length(phone) <= 32),
  notify_coverage_requests boolean not null default true,
  notify_changes boolean not null default true,
  -- "Remind me before an Assignment": any of 0 (morning of), 1, 2 or 7 days before.
  reminder_days_before smallint[] not null default '{1}'
    check (reminder_days_before <@ array[0, 1, 2, 7]::smallint[]),
  -- Local time of day reminders go out, in `time_zone`.
  reminder_time time not null default '18:00',
  time_zone text not null default 'UTC',
  -- As an Admin: how long before an Event to be alerted about anything Unconfirmed or
  -- Needs coverage (the engine's DEFAULT_ALERT_LEAD_TIME_MS is 3 days).
  admin_alert_lead_time_ms bigint not null default 259200000 check (admin_alert_lead_time_ms >= 0),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new account gets a profile.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Push tokens (one row per device)

create table public.push_tokens (
  token text primary key,
  account_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform public.push_platform not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_account_id on public.push_tokens (account_id);

-- ---------------------------------------------------------------------------
-- Groups: settings and engine bookkeeping

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The Group's time zone, for Event Series and reminders (not used by the engine yet).
  time_zone text not null default 'UTC',
  -- GroupState.settings
  coverage_policy public.coverage_policy not null default 'payItBack',
  time_off_handling public.time_off_handling not null default 'routeAround',
  allow_doubling boolean not null default false,
  replacement_duty public.replacement_duty not null default 'assignedMember',
  replacement_deadline_ms bigint not null default 259200000 check (replacement_deadline_ms >= 0),
  primary_responsibility_id text,
  -- Engine bookkeeping
  rotated_through timestamptz,
  id_sequence integer not null default 0,
  -- Optimistic concurrency: bumped by every apply_group_command_result.
  state_version bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Members (never deleted: former Members keep `left_at` and their history)

create table public.members (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  position integer not null,
  display_name text not null,
  is_admin boolean not null default false,
  -- null = Placeholder Member
  account_id uuid references auth.users (id) on delete set null,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (group_id, id)
);
-- One active membership per account per Group.
create unique index members_one_active_per_account
  on public.members (group_id, account_id) where account_id is not null and left_at is null;
create index members_account_id on public.members (account_id) where account_id is not null;

-- ---------------------------------------------------------------------------
-- Responsibilities and Rotations

create table public.responsibilities (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  -- Fill order at each Event.
  position integer not null,
  name text not null,
  headcount integer not null check (headcount >= 1),
  requires_confirmation boolean not null,
  primary key (group_id, id)
);

alter table public.groups
  add constraint groups_primary_responsibility_fk
  foreign key (id, primary_responsibility_id) references public.responsibilities (group_id, id)
  deferrable initially deferred;

create table public.rotations (
  group_id uuid not null,
  responsibility_id text not null,
  position integer not null,
  -- The ordered queue of Qualified Members (Member ids) as of groups.rotated_through.
  queue text[] not null,
  -- { memberId: count } of turns taken ahead of the Member's place in the queue.
  turns_taken_early jsonb not null default '{}',
  primary key (group_id, responsibility_id),
  foreign key (group_id, responsibility_id) references public.responsibilities (group_id, id)
    on delete cascade deferrable initially deferred
);

-- ---------------------------------------------------------------------------
-- Event Series and Events

create table public.event_series (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  position integer not null,
  name text not null,
  responsibility_ids text[] not null,
  primary key (group_id, id)
);

create table public.events (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  position integer not null,
  -- null for a one-off Event
  series_id text,
  starts_at timestamptz not null,
  -- null inherits the Event Series' Responsibilities
  responsibility_ids text[],
  -- Skip Date: set when the Event needs no one. marked_by is null when the system marked it.
  skip_date_marked_at timestamptz,
  skip_date_marked_by text,
  primary key (group_id, id),
  foreign key (group_id, series_id) references public.event_series (group_id, id)
    deferrable initially deferred,
  check (series_id is not null or responsibility_ids is not null),
  check (skip_date_marked_at is not null or skip_date_marked_by is null)
);
create index events_group_starts_at on public.events (group_id, starts_at);

-- ---------------------------------------------------------------------------
-- Time Off

create table public.time_off (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  position integer not null,
  member_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  repeat_every_weeks integer check (repeat_every_weeks >= 1),
  repeat_until timestamptz,
  -- null = every Responsibility
  responsibility_ids text[],
  removed_at timestamptz,
  retained_event_ids text[] not null default '{}',
  primary key (group_id, id),
  foreign key (group_id, member_id) references public.members (group_id, id) deferrable initially deferred,
  check (ends_at >= starts_at)
);

-- ---------------------------------------------------------------------------
-- Make-up Turns

create table public.make_up_turns (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  position integer not null,
  responsibility_id text not null,
  debtor_id text not null,
  creditor_id text not null,
  -- The covered Assignment that created it. No foreign key: the engine may remove that
  -- Assignment later (e.g. its Event became a Skip Date) while the Make-up Turn stays.
  cover_assignment_id text not null,
  created_at timestamptz not null,
  status public.make_up_turn_status not null,
  closed_at timestamptz,
  closed_reason public.make_up_turn_closed_reason,
  primary key (group_id, id),
  foreign key (group_id, responsibility_id) references public.responsibilities (group_id, id)
    deferrable initially deferred,
  foreign key (group_id, debtor_id) references public.members (group_id, id) deferrable initially deferred,
  foreign key (group_id, creditor_id) references public.members (group_id, id) deferrable initially deferred,
  check ((status = 'outstanding') = (closed_at is null))
);

-- ---------------------------------------------------------------------------
-- Assignments (one seat each), with the Coverage Request and Cover inline

create table public.assignments (
  group_id uuid not null references public.groups (id) on delete cascade,
  id text not null,
  position integer not null,
  event_id text not null,
  responsibility_id text not null,
  -- Who fills the seat (null: open seat or Guest Cover).
  member_id text,
  -- Whose Rotation turn this seat used up.
  turn_of text,
  -- The Make-up Turn this Assignment pays.
  make_up_turn_id text,
  confirmation public.confirmation not null,
  -- Coverage Request: set when the Assignment was Declined or needs a volunteer.
  coverage_reason public.coverage_request_reason,
  coverage_requested_by text,
  coverage_requested_at timestamptz,
  -- Cover: set once someone covers the Coverage Request.
  cover_kind public.cover_kind,
  cover_member_id text,
  cover_guest_name text,
  -- A Member id, or 'system' when a scheduled job arranged it.
  cover_arranged_by text,
  covered_at timestamptz,
  primary key (group_id, id),
  foreign key (group_id, event_id) references public.events (group_id, id) deferrable initially deferred,
  foreign key (group_id, responsibility_id) references public.responsibilities (group_id, id)
    deferrable initially deferred,
  foreign key (group_id, member_id) references public.members (group_id, id) deferrable initially deferred,
  foreign key (group_id, turn_of) references public.members (group_id, id) deferrable initially deferred,
  foreign key (group_id, make_up_turn_id) references public.make_up_turns (group_id, id)
    deferrable initially deferred,
  check ((coverage_reason is null) = (coverage_requested_at is null)),
  check (coverage_reason is not null or cover_kind is null),
  check ((cover_kind is null) = (covered_at is null) and (cover_kind is null) = (cover_arranged_by is null)),
  check (cover_kind is distinct from 'member' or (cover_member_id is not null and cover_guest_name is null)),
  check (cover_kind is distinct from 'guest' or (cover_guest_name is not null and cover_member_id is null)),
  check (cover_kind is not null or (cover_member_id is null and cover_guest_name is null))
);
create index assignments_group_event on public.assignments (group_id, event_id);
create index assignments_group_member on public.assignments (group_id, member_id);

-- ---------------------------------------------------------------------------
-- Schedule history (the engine's HistoryEntry, append-only)

create table public.schedule_history (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- The groups.state_version the command produced.
  state_version bigint not null,
  at timestamptz not null,
  -- The Member who acted; null for the system.
  actor_id text,
  -- The engine's Cause: the command, or e.g. { type: 'makeUpTurnPaid' }.
  cause jsonb not null,
  cause_type text generated always as (cause ->> 'type') stored,
  -- AssignmentChange[] and MakeUpTurnChange[]
  changes jsonb not null default '[]',
  make_up_turns jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index schedule_history_group_at on public.schedule_history (group_id, at desc, id desc);

-- ---------------------------------------------------------------------------
-- Invite links: the Group's join link (member_id null) and personal Placeholder claim
-- links (member_id set). Kept out of `groups` and `members` so that only Admins can read them.

create table public.invite_links (
  token text primary key default public.new_token(),
  group_id uuid not null references public.groups (id) on delete cascade,
  member_id text,
  created_at timestamptz not null default now(),
  foreign key (group_id, member_id) references public.members (group_id, id) on delete cascade
);
create unique index invite_links_one_group_link on public.invite_links (group_id) where member_id is null;
create unique index invite_links_one_claim_link on public.invite_links (group_id, member_id) where member_id is not null;

-- A new Group gets its join link.
create function public.handle_new_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invite_links (group_id) values (new.id);
  return new;
end;
$$;
create trigger on_group_created after insert on public.groups
  for each row execute function public.handle_new_group();

-- A claimed Placeholder's personal link is spent.
create function public.handle_member_claimed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.invite_links where group_id = new.group_id and member_id = new.id;
  return new;
end;
$$;
create trigger on_member_claimed after update of account_id on public.members
  for each row when (old.account_id is null and new.account_id is not null)
  execute function public.handle_member_claimed();

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies can use them without recursion)

create function public.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where group_id = p_group_id and account_id = auth.uid() and left_at is null
  )
$$;

create function public.is_group_admin(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where group_id = p_group_id and account_id = auth.uid() and left_at is null and is_admin
  )
$$;

-- ---------------------------------------------------------------------------
-- Row-level security

alter table public.profiles enable row level security;
alter table public.push_tokens enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.responsibilities enable row level security;
alter table public.rotations enable row level security;
alter table public.event_series enable row level security;
alter table public.events enable row level security;
alter table public.time_off enable row level security;
alter table public.make_up_turns enable row level security;
alter table public.assignments enable row level security;
alter table public.schedule_history enable row level security;
alter table public.invite_links enable row level security;

-- Profiles: each account reads and writes only its own.
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Push tokens: each account manages its own devices (register through register_push_token).
create policy push_tokens_select_own on public.push_tokens for select to authenticated
  using (account_id = (select auth.uid()));
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated
  using (account_id = (select auth.uid()));

-- Scheduling state: active Members read their Group's data. No write policies: writes go
-- through the group-command Edge Function (service role).
create policy groups_select_member on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy members_select_member on public.members for select to authenticated
  using (public.is_group_member(group_id));
create policy responsibilities_select_member on public.responsibilities for select to authenticated
  using (public.is_group_member(group_id));
create policy rotations_select_member on public.rotations for select to authenticated
  using (public.is_group_member(group_id));
create policy event_series_select_member on public.event_series for select to authenticated
  using (public.is_group_member(group_id));
create policy events_select_member on public.events for select to authenticated
  using (public.is_group_member(group_id));
create policy time_off_select_member on public.time_off for select to authenticated
  using (public.is_group_member(group_id));
create policy make_up_turns_select_member on public.make_up_turns for select to authenticated
  using (public.is_group_member(group_id));
create policy assignments_select_member on public.assignments for select to authenticated
  using (public.is_group_member(group_id));
create policy schedule_history_select_member on public.schedule_history for select to authenticated
  using (public.is_group_member(group_id));

-- Invite links: Admins only.
create policy invite_links_select_admin on public.invite_links for select to authenticated
  using (public.is_group_admin(group_id));

-- Table privileges. Supabase grants everything to anon and authenticated by default; RLS
-- would block writes anyway, but revoking them makes the intent explicit.
revoke all on public.profiles, public.push_tokens, public.groups, public.members, public.responsibilities,
  public.rotations, public.event_series, public.events, public.time_off, public.make_up_turns,
  public.assignments, public.schedule_history, public.invite_links
  from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, delete on public.push_tokens to authenticated;
grant select on public.groups, public.members, public.responsibilities, public.rotations, public.event_series,
  public.events, public.time_off, public.make_up_turns, public.assignments, public.schedule_history,
  public.invite_links
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reading a Group's state

-- All of a Group's engine rows as one consistent snapshot:
-- { group, members, responsibilities, rotations, event_series, events, time_off,
--   make_up_turns, assignments }, each array in `position` order. `group` is null when the
-- Group doesn't exist or the caller can't read it. Security invoker: under RLS a client
-- gets only its own Groups (the app can use this to run engine previews locally).
create function public.group_state_rows(p_group_id uuid) returns jsonb
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
    'assignments', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from public.assignments x where x.group_id = p_group_id), '[]')
  )
$$;

-- ---------------------------------------------------------------------------
-- Writing a Group's state (service role only)

-- Persists the engine's resulting GroupState (as rows) and its history entries in one
-- transaction. Optimistic concurrency: returns the new state_version, or null when the
-- Group's state_version is no longer p_expected_version (the caller reloads and retries).
--
-- p_expected_version null creates the Group: p_rows.group must then also carry `name`,
-- and may carry `time_zone` and `created_by`.
--
-- Rows are upserted (unchanged rows are left alone, so Realtime only sees real changes)
-- and rows missing from p_rows are deleted. In practice only Assignments are ever removed;
-- deleting a Member or an Event that something references fails on its foreign key.
create function public.apply_group_command_result(
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
  insert into public.responsibilities as t (group_id, id, position, name, headcount, requires_confirmation)
  select p_group_id, r.id, r.position, r.name, r.headcount, r.requires_confirmation
  from jsonb_populate_recordset(null::public.responsibilities, p_rows -> 'responsibilities') r
  on conflict (group_id, id) do update set
    position = excluded.position, name = excluded.name, headcount = excluded.headcount,
    requires_confirmation = excluded.requires_confirmation
  where (t.position, t.name, t.headcount, t.requires_confirmation)
    is distinct from (excluded.position, excluded.name, excluded.headcount, excluded.requires_confirmation);

  -- Rotations
  insert into public.rotations as t (group_id, responsibility_id, position, queue, turns_taken_early)
  select p_group_id, r.responsibility_id, r.position, r.queue, r.turns_taken_early
  from jsonb_populate_recordset(null::public.rotations, p_rows -> 'rotations') r
  on conflict (group_id, responsibility_id) do update set
    position = excluded.position, queue = excluded.queue, turns_taken_early = excluded.turns_taken_early
  where (t.position, t.queue, t.turns_taken_early)
    is distinct from (excluded.position, excluded.queue, excluded.turns_taken_early);

  -- Event Series
  insert into public.event_series as t (group_id, id, position, name, responsibility_ids)
  select p_group_id, r.id, r.position, r.name, r.responsibility_ids
  from jsonb_populate_recordset(null::public.event_series, p_rows -> 'event_series') r
  on conflict (group_id, id) do update set
    position = excluded.position, name = excluded.name, responsibility_ids = excluded.responsibility_ids
  where (t.position, t.name, t.responsibility_ids)
    is distinct from (excluded.position, excluded.name, excluded.responsibility_ids);

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

-- ---------------------------------------------------------------------------
-- Client RPCs that don't touch scheduling state

-- Registers this device's Expo push token for the caller (taking it over if the device
-- was signed in to another account).
create function public.register_push_token(p_token text, p_platform public.push_platform) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into public.push_tokens (token, account_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set
    account_id = excluded.account_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

-- Admin: rename the Group or change its time zone (not engine state).
create function public.update_group_details(p_group_id uuid, p_name text, p_time_zone text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.groups set name = btrim(p_name), time_zone = p_time_zone where id = p_group_id;
end;
$$;

-- Admin: replace the Group's join link. Returns the new token.
create function public.reset_invite_link(p_group_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  delete from public.invite_links where group_id = p_group_id and member_id is null;
  insert into public.invite_links (group_id) values (p_group_id) returning token into v_token;
  return v_token;
end;
$$;

-- Admin: the personal claim link for a Placeholder Member (created on first request).
create function public.claim_link_for(p_group_id uuid, p_member_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.members
    where group_id = p_group_id and id = p_member_id and account_id is null and left_at is null
  ) then
    raise exception 'Not a Placeholder Member' using errcode = '22023';
  end if;
  insert into public.invite_links (group_id, member_id) values (p_group_id, p_member_id)
  on conflict (group_id, member_id) where member_id is not null do nothing;
  select token into v_token from public.invite_links where group_id = p_group_id and member_id = p_member_id;
  return v_token;
end;
$$;

-- What an invite link leads to, for the join screen: the Group's name and, for a claim
-- link, the Placeholder's name. No rows when the token is unknown.
create function public.invite_link_preview(p_token text)
returns table (group_id uuid, group_name text, placeholder_name text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, m.display_name
  from public.invite_links l
  join public.groups g on g.id = l.group_id
  left join public.members m on m.group_id = l.group_id and m.id = l.member_id
  where l.token = p_token
    and (l.member_id is null or (m.account_id is null and m.left_at is null))
$$;

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE on new functions to anon and authenticated
-- by default, so revoke explicitly and grant only what clients need.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_group_member(uuid), public.is_group_admin(uuid),
  public.group_state_rows(uuid), public.register_push_token(text, public.push_platform),
  public.update_group_details(uuid, text, text), public.reset_invite_link(uuid),
  public.claim_link_for(uuid, text), public.invite_link_preview(text)
  to authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: Coverage Requests ("first tap wins") and schedule changes stay current.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.groups, public.members, public.events, public.assignments, public.schedule_history;
  end if;
end;
$$;
