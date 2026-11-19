-- Simplify ticket 04: no Admins for now. Every active Member may do what Admins did: rename
-- the Group, change its time zone, reset the join link, and get a Stand-in's (Placeholder
-- Member's) personal claim link to send them. The engine (group-command) applies the same rule
-- to scheduling commands. `members.is_admin` and `is_group_admin` stay (hide, don't migrate);
-- nothing grants anything by them any more. Outside covers (someone not in the Group) reuse
-- the existing `cover_kind = 'guest'` and `cover_guest_name` columns, so no table changes.

-- Any active Member: rename the Group or change its time zone (not engine state).
create or replace function public.update_group_details(p_group_id uuid, p_name text, p_time_zone text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Members only' using errcode = '42501';
  end if;
  update public.groups set name = btrim(p_name), time_zone = p_time_zone where id = p_group_id;
end;
$$;

-- Any active Member: replace the Group's join link. Returns the new token.
create or replace function public.reset_invite_link(p_group_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Members only' using errcode = '42501';
  end if;
  delete from public.invite_links where group_id = p_group_id and member_id is null;
  insert into public.invite_links (group_id) values (p_group_id) returning token into v_token;
  return v_token;
end;
$$;

-- Any active Member: the personal claim link for a Stand-in (created on first request). The
-- Stand-in opens it to take over their place in the Group.
create or replace function public.claim_link_for(p_group_id uuid, p_member_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Members only' using errcode = '42501';
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

-- Invite links: readable by every active Member of the Group (was Admins only).
drop policy if exists invite_links_select_admin on public.invite_links;
create policy invite_links_select_member on public.invite_links for select to authenticated
  using (public.is_group_member(group_id));

-- `create or replace` keeps existing grants; restate them so this file stands on its own.
revoke execute on function public.update_group_details(uuid, text, text), public.reset_invite_link(uuid),
  public.claim_link_for(uuid, text) from public, anon;
grant execute on function public.update_group_details(uuid, text, text), public.reset_invite_link(uuid),
  public.claim_link_for(uuid, text) to authenticated, service_role;
