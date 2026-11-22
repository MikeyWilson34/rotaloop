-- Feedback-2 ticket 08: deleting a Group (docs/adr/0009-deleting-a-group.md). Additive only.
--
-- Any active Member may delete their Group. Deleting is soft: `groups.deleted_at` is set and
-- every row is kept for 30 days, so a mistake can be undone by hand:
--   update public.groups set deleted_at = null, deleted_by = null where id = '<group id>';
-- A later ticket purges deleted Groups older than 30 days (a plain `delete from groups`
-- cascades to everything).
--
-- A deleted Group is gone for everyone, old app versions included, because the rules live in
-- the database rather than in the app:
-- - is_group_member() is false for a deleted Group, so every RLS policy and every RPC built on
--   it (members, jobs, turns, dates off, history, headcount answers, invite links, rename,
--   reset link, claim link) hides or refuses it.
-- - group_state_rows() returns no Group for a deleted one. group-command and notify read
--   through it with the service role, so commands, joins, the daily horizon job, reminders and
--   every other scheduled push skip deleted Groups.
-- - invite_link_preview() and invite_link_stand_ins() return no rows for a deleted Group's link; the new
--   deleted_group_for_invite() lets the join screen say the Group was deleted.
-- - The `groups` row itself stays readable to the people who were in it when it was deleted
--   (nothing else is): Realtime delivers the deleted_at change to anyone who has the Group open,
--   and the app can tell them it was deleted. The deployed app never reads `groups` on its own
--   (only through members or group_state_rows), so it just sees the Group disappear.

alter table public.groups
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index groups_deleted_at on public.groups (deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- Membership helpers: a deleted Group has no Members as far as access goes.

create or replace function public.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    join public.groups g on g.id = m.group_id
    where m.group_id = p_group_id and m.account_id = auth.uid() and m.left_at is null
      and g.deleted_at is null
  )
$$;

create or replace function public.is_group_admin(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    join public.groups g on g.id = m.group_id
    where m.group_id = p_group_id and m.account_id = auth.uid() and m.left_at is null and m.is_admin
      and g.deleted_at is null
  )
$$;

-- The caller was an active Member of this Group when it was deleted.
create function public.was_in_deleted_group(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    join public.groups g on g.id = m.group_id
    where m.group_id = p_group_id and m.account_id = auth.uid() and m.left_at is null
      and g.deleted_at is not null
  )
$$;

-- Groups: Members read their Group; the people who were in a deleted Group still read its row
-- (name, deleted_at) and nothing else.
drop policy if exists groups_select_member on public.groups;
create policy groups_select_member on public.groups for select to authenticated
  using (public.is_group_member(id) or public.was_in_deleted_group(id));

-- ---------------------------------------------------------------------------
-- group_state_rows: nothing for a deleted Group (same shape as for an unknown one).

create or replace function public.group_state_rows(p_group_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.deleted_at is null) then
    return jsonb_build_object(
      'group', null, 'members', '[]'::jsonb, 'responsibilities', '[]'::jsonb, 'rotations', '[]'::jsonb,
      'event_series', '[]'::jsonb, 'events', '[]'::jsonb, 'time_off', '[]'::jsonb,
      'make_up_turns', '[]'::jsonb, 'assignments', '[]'::jsonb, 'headcount_answers', '[]'::jsonb
    );
  end if;
  return jsonb_build_object(
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
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting (service role: group-command's `deleteGroup` action checks the caller first)

-- Marks the Group deleted by `p_account_id`, who must be an active Member. Returns false when
-- the Group is unknown, already deleted, or they aren't in it.
create function public.mark_group_deleted(p_group_id uuid, p_account_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.groups g set deleted_at = now(), deleted_by = p_account_id
  where g.id = p_group_id and g.deleted_at is null
    and exists (
      select 1 from public.members m
      where m.group_id = p_group_id and m.account_id = p_account_id and m.left_at is null
    );
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite links of a deleted Group

create or replace function public.invite_link_preview(p_token text)
returns table (group_id uuid, group_name text, placeholder_name text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, m.display_name
  from public.invite_links l
  join public.groups g on g.id = l.group_id
  left join public.members m on m.group_id = l.group_id and m.id = l.member_id
  where l.token = p_token and g.deleted_at is null
    and (l.member_id is null or (m.account_id is null and m.left_at is null))
$$;

-- "Are you one of these?" (20261125000000_stand_ins_on_join.sql): no Stand-ins for a deleted
-- Group's join link.
create or replace function public.invite_link_stand_ins(p_token text)
returns table (member_id text, name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.display_name
  from public.invite_links l
  join public.groups g on g.id = l.group_id
  join public.members m on m.group_id = l.group_id
  where l.token = p_token
    and g.deleted_at is null
    and l.member_id is null
    and m.account_id is null
    and m.left_at is null
  order by m.position
$$;

-- The name of the deleted Group an invite link led to (null otherwise), so the join screen can
-- say so in plain words. The token holder could already see the name before.
create function public.deleted_group_for_invite(p_token text) returns text
language sql stable security definer set search_path = '' as $$
  select g.name
  from public.invite_links l
  join public.groups g on g.id = l.group_id
  where l.token = p_token and g.deleted_at is not null
$$;

-- ---------------------------------------------------------------------------
-- Telling the others: one push per remaining Member ("Sam deleted Sunday Team").

alter type public.notification_kind add value if not exists 'groupDeleted';

-- ---------------------------------------------------------------------------
-- Privileges (Supabase grants EXECUTE on new functions to anon and authenticated by default).

revoke execute on function public.was_in_deleted_group(uuid), public.mark_group_deleted(uuid, uuid),
  public.deleted_group_for_invite(text)
  from public, anon, authenticated;
grant execute on function public.was_in_deleted_group(uuid) to authenticated, service_role;
grant execute on function public.mark_group_deleted(uuid, uuid) to service_role;
grant execute on function public.deleted_group_for_invite(text) to anon, authenticated, service_role;
-- `create or replace` keeps grants; restated so this file stands on its own.
grant execute on function public.is_group_member(uuid), public.is_group_admin(uuid), public.group_state_rows(uuid)
  to authenticated, service_role;
grant execute on function public.invite_link_preview(text) to anon, authenticated, service_role;
revoke execute on function public.invite_link_stand_ins(text) from public, anon;
grant execute on function public.invite_link_stand_ins(text) to authenticated, service_role;
