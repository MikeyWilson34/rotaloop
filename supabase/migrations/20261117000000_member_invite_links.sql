-- Ticket 15 (from ticket 06): any active Member can share the Group's join link, and a
-- signed-out web visitor can see which Group an invite link leads to before making a guest
-- account. Resetting the link stays Admin-only (reset_invite_link).

-- Any active Member: the Group's current join link token. Null if the Group has none.
create function public.group_invite_link(p_group_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Members only' using errcode = '42501';
  end if;
  select token into v_token from public.invite_links where group_id = p_group_id and member_id is null;
  return v_token;
end;
$$;

-- Supabase grants EXECUTE on new functions to anon and authenticated by default.
revoke execute on function public.group_invite_link(uuid) from public, anon, authenticated;
grant execute on function public.group_invite_link(uuid) to authenticated, service_role;

-- invite_link_preview returns only what the token holder is about to see on the join screen:
-- the Group's id and name, and for a claim link the Placeholder's name. It reads no account
-- data, and an unknown, reset or spent token returns no rows.
grant execute on function public.invite_link_preview(text) to anon;
