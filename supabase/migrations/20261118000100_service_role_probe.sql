-- Ticket 07: lets the group-command Edge Function confirm that a caller of its system action
-- (the daily event horizon job) holds a service role key. The function calls this RPC with the
-- caller's key: PostgREST validates the key, and only service_role may execute it.
create function public.is_service_role_caller() returns boolean
language sql stable set search_path = '' as $$
  select true
$$;

revoke execute on function public.is_service_role_caller() from public, anon, authenticated;
grant execute on function public.is_service_role_caller() to service_role;
