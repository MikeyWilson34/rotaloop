-- Ticket 11: push notifications (Expo push for the app, Web Push for the website), the
-- notification log that makes every send happen at most once, and the 15-minute job.
--
-- What is sent, and to whom, is decided by the pure planner in src/notify/plan.ts. The
-- `notify` Edge Function loads the data, calls it, claims each planned notification here
-- (claim_notifications: a unique dedupe key, so retries and overlapping runs never send
-- twice) and delivers to the account's devices.
--
-- The job: every 15 minutes pg_cron calls public.request_notification_run(), which POSTs
-- { "action": "scheduled" } to the notify function with the service role key from Vault
-- (same pattern as the event horizon job, 20261118000000_event_horizon_job.sql):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify', 'notify_url');
--   (group_command_service_key, the service role key, is shared with the horizon job.)
-- Without them the job logs a warning and does nothing.

-- ---------------------------------------------------------------------------
-- Devices: Expo push tokens and Web Push subscriptions share push_tokens

create type public.push_kind as enum ('expo', 'web');

-- `token` is the Expo push token, or the subscription's endpoint URL for Web Push.
-- `subscription` is the browser's PushSubscription JSON ({ endpoint, keys: { p256dh, auth } }).
alter table public.push_tokens
  add column kind public.push_kind not null default 'expo',
  add column subscription jsonb,
  add constraint push_tokens_web_subscription check ((kind = 'web') = (subscription is not null));

-- Registers this browser's Web Push subscription for the caller (taking it over if the
-- browser was signed in to another account).
create function public.register_web_push(p_subscription jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_endpoint text := p_subscription ->> 'endpoint';
  v_p256dh text := p_subscription #>> '{keys,p256dh}';
  v_auth text := p_subscription #>> '{keys,auth}';
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_endpoint is null or v_endpoint !~ '^https://' or length(v_endpoint) > 1000
     or v_p256dh is null or v_p256dh !~ '^[A-Za-z0-9_=-]{20,200}$'
     or v_auth is null or v_auth !~ '^[A-Za-z0-9_=-]{8,100}$' then
    raise exception 'Not a push subscription' using errcode = '22023';
  end if;
  insert into public.push_tokens (token, account_id, platform, kind, subscription)
  values (v_endpoint, auth.uid(), 'web', 'web',
          jsonb_build_object('endpoint', v_endpoint, 'keys', jsonb_build_object('p256dh', v_p256dh, 'auth', v_auth)))
  on conflict (token) do update set
    account_id = excluded.account_id, platform = 'web', kind = 'web',
    subscription = excluded.subscription, last_seen_at = now();
end;
$$;

-- Forgets one of the caller's devices (push turned off, or the browser unsubscribed).
create function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and account_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- The notification log: one row per planned notification per person, ever

create type public.notification_kind as enum (
  'coverageRequest',     -- a new Coverage Request, to its Qualified Members
  'coverageFollowUp',    -- the one follow-up at the Group's "find a replacement by" deadline
  'covered',             -- someone covered your request
  'coverWithdrawn',      -- your coverer can no longer make it
  'askedToConfirmCover', -- you were marked as covering: please confirm
  'confirmationRequested',
  'scheduleChange',      -- your Assignment moved, was reassigned, added or removed
  'reminder',
  'replacementDuty',
  'adminAlert'
);

create table public.notification_log (
  id bigint generated always as identity primary key,
  -- Built by the planner, e.g. "reminder:<group>:<assignment>:<event>:1d:<account>".
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 400),
  account_id uuid not null references auth.users (id) on delete cascade,
  kind public.notification_kind not null,
  group_id uuid references public.groups (id) on delete cascade,
  assignment_id text,
  event_id text,
  -- Which offset or variant: "1d" for a reminder, "unconfirmed" for an Admin alert, ...
  offset_key text not null default '',
  title text not null,
  body text not null,
  url text not null,
  sent_at timestamptz not null default now(),
  -- Devices the message was handed to (0: none registered, push off, or all failed).
  delivered smallint not null default 0
);
create index notification_log_account on public.notification_log (account_id, sent_at desc);

alter table public.notification_log enable row level security;
-- Members read their own rows (the app can show what was sent); no client writes.
create policy notification_log_select_own on public.notification_log for select to authenticated
  using (account_id = (select auth.uid()));
revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;

-- Service role: claims planned notifications. Returns the dedupe keys that were new (and so
-- must be sent now); keys already in the log are skipped.
create function public.claim_notifications(p_items jsonb) returns setof text
language sql volatile set search_path = '' as $$
  insert into public.notification_log
    (dedupe_key, account_id, kind, group_id, assignment_id, event_id, offset_key, title, body, url)
  select i ->> 'dedupeKey', (i ->> 'accountId')::uuid, (i ->> 'kind')::public.notification_kind,
         (i ->> 'groupId')::uuid, i ->> 'assignmentId', i ->> 'eventId', coalesce(i ->> 'offsetKey', ''),
         i ->> 'title', i ->> 'body', i ->> 'url'
  from jsonb_array_elements(p_items) as i
  on conflict (dedupe_key) do nothing
  returning dedupe_key
$$;

-- ---------------------------------------------------------------------------
-- Expo push tickets waiting for their receipts (checked on the next runs)

create table public.expo_push_tickets (
  id text primary key,
  token text not null,
  created_at timestamptz not null default now()
);
alter table public.expo_push_tickets enable row level security;
revoke all on public.expo_push_tickets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The 15-minute job

-- Returns the pg_net request id, or null when the Vault secrets are missing.
create or replace function public.request_notification_run() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'group_command_service_key';
  if v_url is null or v_key is null then
    raise warning 'Notification job skipped: set the Vault secrets notify_url and group_command_service_key';
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'scheduled'),
    timeout_milliseconds := 120000
  ) into v_request;
  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges

revoke execute on function public.register_web_push(jsonb), public.unregister_push_token(text),
  public.claim_notifications(jsonb), public.request_notification_run()
  from public, anon, authenticated;
grant execute on function public.register_web_push(jsonb), public.unregister_push_token(text) to authenticated;
grant execute on function public.register_web_push(jsonb), public.unregister_push_token(text),
  public.claim_notifications(jsonb), public.request_notification_run()
  to service_role;

-- Every 15 minutes (reminders go out at quarter-hour precision; the chips are on the hour).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('run-notifications', '*/15 * * * *', 'select public.request_notification_run()');
  end if;
end;
$$;
