// group-command: the only writer of a Group's scheduling state.
// Authenticates the caller, then runs the shared handler (load -> engine -> persist with
// an optimistic state_version lock). See docs/adr/0004-schedule-writes-go-through-the-engine.md.
//
// One system action, `{ "action": "extendHorizons" }`, is for the daily pg_cron job only
// (see supabase/migrations/20261118000000_event_horizon_job.sql): it adds every repeating
// Event Series' missing Events up to the rolling horizon. It is refused unless the caller
// presents the project's service role key.
//
// After each successful command (or join) it asks the notify function, in the background,
// to send the push notifications the command caused (ticket 11). `deleteGroup` (feedback-2
// ticket 08) soft-deletes the Group and asks notify to tell everyone else.
//
// _shared/engine, _shared/db and _shared/schedule are generated copies of src/:
// run `npm run functions:sync` (functions:deploy does it for you).
import { createClient } from 'npm:@supabase/supabase-js@2';

import type { GroupRows } from '../_shared/db/groupRows.ts';
import {
  extendHorizons,
  handleGroupCommand,
  persistPayload,
  type GroupStore,
} from '../_shared/db/handleGroupCommand.ts';
import type { GroupCommandResponse } from '../_shared/db/protocol.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const fail = (body: Extract<GroupCommandResponse, { ok: false }>, status: number) => json(body, status);

/** Supabase Edge Runtime: keeps background work running after the response is sent. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/**
 * Hands a successful command's history to the notify function without delaying the reply.
 * A failure here never fails the command (notifications are best effort).
 */
function notifyInBackground(response: GroupCommandResponse, action: unknown): void {
  if (!response.ok) return;
  // A deleted Group: "Sam deleted Sunday Team" to everyone else (feedback-2 ticket 08).
  if (action === 'deleteGroup') {
    postToNotify({ action: 'groupDeleted', groupId: response.groupId });
    return;
  }
  if (response.history.length === 0) return;
  postToNotify({
    action: 'afterCommand',
    groupId: response.groupId,
    stateVersion: response.stateVersion,
    history: response.history,
  });
}

function postToNotify(body: Record<string, unknown>): void {
  const task = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      if (!r.ok) console.error('notify failed', r.status, await r.text());
    })
    .catch((error) => console.error('notify failed', error));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
}

// The service role key is provided to Edge Functions by Supabase; it never reaches the app.
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Constant-time string comparison (for the service role check). */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Whether `token` is a service role key. The env key is compared first; otherwise the key is
 * tried against a service-role-only RPC, so PostgREST does the verification (this covers the
 * legacy JWT and the newer secret keys alike).
 */
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false;
  if (sameSecret(token, SERVICE_ROLE_KEY)) return true;
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await caller.rpc('is_service_role_caller');
  return !error && data === true;
}

const store: GroupStore = {
  async load(groupId) {
    const { data, error } = await admin.rpc('group_state_rows', { p_group_id: groupId });
    if (error) throw error;
    const rows = data as (GroupRows & { group: { state_version: number } | null }) | null;
    if (!rows?.group) return null;
    return { rows: rows as GroupRows, version: Number(rows.group.state_version) };
  },
  async persist(input) {
    const { data, error } = await admin.rpc('apply_group_command_result', {
      p_group_id: input.groupId,
      p_expected_version: input.expectedVersion,
      p_rows: persistPayload(input),
      p_history: input.history,
    });
    if (error) throw error;
    return data === null ? null : Number(data);
  },
  async findInvite(token) {
    const { data, error } = await admin
      .from('invite_links')
      .select('group_id, member_id')
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    return data ? { groupId: data.group_id as string, memberId: data.member_id as string | null } : null;
  },
  async groupsWithRepeatingSeries() {
    const { data, error } = await admin
      .from('event_series')
      .select('group_id')
      .is('removed_at', null)
      .not('repeat', 'is', null);
    if (error) throw error;
    return [...new Set((data ?? []).map((r) => r.group_id as string))];
  },
  async markDeleted(groupId, accountId) {
    const { data, error } = await admin.rpc('mark_group_deleted', { p_group_id: groupId, p_account_id: accountId });
    if (error) throw error;
    return data === true;
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return fail({ ok: false, reason: 'invalidRequest', message: 'Use POST' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail({ ok: false, reason: 'invalidRequest', message: 'Body must be JSON' }, 400);
  }

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';

  // The daily system job: service role only.
  if ((body as { action?: unknown } | null)?.action === 'extendHorizons') {
    if (!(await isServiceRole(jwt))) {
      return fail({ ok: false, reason: 'notPermitted', message: 'System only' }, 403);
    }
    try {
      const report = await extendHorizons(store, { now: () => new Date().toISOString() });
      console.log('extendHorizons', report);
      return json({ ok: true, ...report });
    } catch (error) {
      console.error('extendHorizons failed', error);
      return fail({ ok: false, reason: 'serverError', message: 'Something went wrong' }, 500);
    }
  }

  const { data: auth, error: authError } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  if (authError || !auth?.user) {
    return fail({ ok: false, reason: 'unauthenticated', message: 'Sign in first' }, 401);
  }

  try {
    const response = await handleGroupCommand(store, body, {
      accountId: auth.user.id,
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
    // A new Group has no one else to tell.
    const action = (body as { action?: unknown }).action;
    if (action !== 'createGroup') notifyInBackground(response, action);
    return json(response);
  } catch (error) {
    console.error('group-command failed', error);
    return fail({ ok: false, reason: 'serverError', message: 'Something went wrong' }, 500);
  }
});
