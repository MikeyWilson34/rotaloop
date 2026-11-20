-- Feedback-2 ticket 05: "Are you one of these?" when joining with the Group's join link.
-- Additive only: a new read-only RPC; nothing existing changes.
--
-- invite_link_stand_ins lists the Group's Stand-ins (active Placeholder Members) for someone
-- holding a valid *join* link, so the join screen can ask whether they are one of them. A
-- personal claim link already names its Stand-in (invite_link_preview), so it returns nothing,
-- and so does an unknown or reset token. It returns only ids and names, in join order, and
-- only to signed-in callers (a signed-out visitor makes their account before joining).
-- Claiming one goes through group-command's `join` with `standInId`, which re-checks it.
create function public.invite_link_stand_ins(p_token text)
returns table (member_id text, name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.display_name
  from public.invite_links l
  join public.members m on m.group_id = l.group_id
  where l.token = p_token
    and l.member_id is null
    and m.account_id is null
    and m.left_at is null
  order by m.position
$$;

revoke execute on function public.invite_link_stand_ins(text) from public, anon;
grant execute on function public.invite_link_stand_ins(text) to authenticated, service_role;
