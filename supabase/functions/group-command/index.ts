// group-command: the only writer of a Group's scheduling state.
// Authenticates the caller, then runs the shared handler (load -> engine -> persist with
// an optimistic state_version lock). See docs/adr/0004-schedule-writes-go-through-the-engine.md.
//
// _shared/engine and _shared/db are generated copies of src/engine and src/db:
// run `npm run functions:sync` (functions:deploy does it for you).
import { createClient } from 'npm:@supabase/supabase-js@2';

import type { GroupRows } from '../_shared/db/groupRows.ts';
import { handleGroupCommand, persistPayload, type GroupStore } from '../_shared/db/handleGroupCommand.ts';
import type { GroupCommandResponse } from '../_shared/db/protocol.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: GroupCommandResponse, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// The service role key is provided to Edge Functions by Supabase; it never reaches the app.
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ ok: false, reason: 'invalidRequest', message: 'Use POST' }, 405);
  }

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  if (authError || !auth?.user) {
    return json({ ok: false, reason: 'unauthenticated', message: 'Sign in first' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'invalidRequest', message: 'Body must be JSON' }, 400);
  }

  try {
    const response = await handleGroupCommand(store, body, {
      accountId: auth.user.id,
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
    return json(response);
  } catch (error) {
    console.error('group-command failed', error);
    return json({ ok: false, reason: 'serverError', message: 'Something went wrong' }, 500);
  }
});
