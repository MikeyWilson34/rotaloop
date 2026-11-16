// Live end-to-end check of groups, invites, Admins and Placeholders (ticket 06) against the
// hosted Supabase project. Uses only the publishable key from .env and three new guest
// accounts. Prints step names and ok / rejection reasons only (no tokens or keys).
//
//   node --env-file=.env scripts/smoke-groups.mjs
//
// It leaves its data behind: a Group named "Smoke Test 06 <timestamp>".
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (run with --env-file=.env)');
  process.exit(1);
}

let failures = 0;
function report(step, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? ` (${detail})` : ''}`);
}

async function guest(name) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInAnonymously({ options: { data: { display_name: name } } });
  if (error) throw new Error(`Guest sign-in failed for ${name}: ${error.message}`);
  return client;
}

async function call(client, body) {
  const { data, error } = await client.functions.invoke('group-command', { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { ok: false, reason: 'serverError', message: error?.message };
  }
}

const outcome = (r) => (r.ok ? 'ok' : `rejected: ${r.reason}`);

const groupName = `Smoke Test 06 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const a = await guest('Smoke A');
const b = await guest('Smoke B');
const c = await guest('Smoke C');
report('three guest accounts signed in', true);

// A creates the Group.
const created = await call(a, { action: 'createGroup', name: groupName, memberName: 'Smoke A', timeZone: 'America/Chicago' });
report(`A creates "${groupName}"`, created.ok, outcome(created));
if (!created.ok) process.exit(1);
const groupId = created.groupId;

// A adds Placeholder "Pat".
const added = await call(a, { action: 'command', groupId, command: { type: 'addMember', member: { name: 'Pat' } } });
report('A adds Placeholder "Pat"', added.ok, outcome(added));
const { data: membersA } = await a.from('members').select('id, display_name, account_id, is_admin').eq('group_id', groupId);
const pat = membersA?.find((m) => m.display_name === 'Pat' && m.account_id === null);
report('Pat is listed as a Placeholder', !!pat);

// A gets the Group link and Pat's claim link.
const { data: links } = await a.from('invite_links').select('token').eq('group_id', groupId).is('member_id', null);
const groupToken = links?.[0]?.token;
report('A reads the Group invite link', !!groupToken);
const patLinkA = await a.rpc('claim_link_for', { p_group_id: groupId, p_member_id: pat?.id });
report("A gets Pat's claim link", !patLinkA.error && !!patLinkA.data, patLinkA.error?.message);

// B previews and joins with the Group link.
const preview = await b.rpc('invite_link_preview', { p_token: groupToken });
const previewRow = preview.data?.[0];
report('B previews the Group link', previewRow?.group_name === groupName && !previewRow?.placeholder_name);
const joinedB = await call(b, { action: 'join', token: groupToken, memberName: 'Smoke B' });
report('B joins with the Group link', joinedB.ok, outcome(joinedB));
const joinedAgain = await call(b, { action: 'join', token: groupToken, memberName: 'Smoke B' });
report('B joining again is refused', !joinedAgain.ok && joinedAgain.reason === 'alreadyMember', outcome(joinedAgain));
const memberB = joinedB.memberId;

// A appoints B Admin, then A leaves.
const appoint = await call(a, { action: 'command', groupId, command: { type: 'setAdmin', memberId: memberB, isAdmin: true } });
report('A appoints B Admin', appoint.ok, outcome(appoint));
const leave = await call(a, { action: 'command', groupId, command: { type: 'removeMember', memberId: created.memberId } });
report('A leaves the Group', leave.ok, outcome(leave));
const { data: afterLeave } = await a.from('groups').select('id').eq('id', groupId);
report('A can no longer read the Group', (afterLeave ?? []).length === 0);

// B, now the only Admin, can't step down.
const stepDown = await call(b, { action: 'command', groupId, command: { type: 'setAdmin', memberId: memberB, isAdmin: false } });
report('B removing Admin from themselves is refused', !stepDown.ok && stepDown.reason === 'lastAdmin', outcome(stepDown));

// B gets Pat's claim link; C claims Pat.
const patLinkB = await b.rpc('claim_link_for', { p_group_id: groupId, p_member_id: pat?.id });
report("B gets Pat's claim link", !patLinkB.error && !!patLinkB.data, patLinkB.error?.message);
const claimPreview = await c.rpc('invite_link_preview', { p_token: patLinkB.data });
report('C previews the claim link ("You\'ll join as Pat")', claimPreview.data?.[0]?.placeholder_name === 'Pat');
const claimed = await call(c, { action: 'join', token: patLinkB.data, memberName: 'Smoke C' });
report('C claims Pat', claimed.ok && claimed.memberId === pat?.id, outcome(claimed));
const spent = await c.rpc('invite_link_preview', { p_token: patLinkB.data });
report("Pat's claim link is spent", (spent.data ?? []).length === 0);

const { data: finalMembers } = await b.from('members').select('display_name, account_id, is_admin, left_at').eq('group_id', groupId);
const summary = (finalMembers ?? [])
  .map((m) => `${m.display_name}${m.is_admin ? ' [Admin]' : ''}${m.left_at ? ' [left]' : ''}${m.account_id ? '' : ' [Placeholder]'}`)
  .join(', ');
console.log(`Members now: ${summary}`);

console.log(failures === 0 ? 'All steps passed.' : `${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
