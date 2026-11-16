-- Ticket 07: keep every Group's Events filled up to the rolling horizon (about 12 weeks).
--
-- Once a day pg_cron calls public.request_event_horizon_extension(), which POSTs
-- { "action": "extendHorizons" } to the group-command Edge Function through pg_net. The
-- function only accepts that action with the service role key, and then adds each repeating
-- Event Series' missing Events (and fills them) as the system.
--
-- The function URL and the service role key live in Supabase Vault, never in a migration:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/group-command', 'group_command_url');
--   select vault.create_secret('<service role key>', 'group_command_service_key');
-- Without them the job logs a warning and does nothing.
--
-- pg_cron and pg_net are only enabled where available (they are on hosted Supabase, including
-- the free plan; not in the PGlite test database).

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end;
$$;

-- Returns the pg_net request id, or null when the Vault secrets are missing.
create or replace function public.request_event_horizon_extension() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'group_command_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'group_command_service_key';
  if v_url is null or v_key is null then
    raise warning 'Event horizon job skipped: set the Vault secrets group_command_url and group_command_service_key';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'extendHorizons'),
    timeout_milliseconds := 120000
  ) into v_request;
  return v_request;
end;
$$;

revoke execute on function public.request_event_horizon_extension() from public, anon, authenticated;
grant execute on function public.request_event_horizon_extension() to service_role;

-- Daily at 08:17 UTC (night-time in the Americas, morning in Europe).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('extend-event-horizons', '17 8 * * *', 'select public.request_event_horizon_extension()');
  end if;
end;
$$;
