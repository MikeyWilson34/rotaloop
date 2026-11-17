// Live check of notifications (ticket 11) against the hosted Supabase project. Prints step
// names and ok flags only.
//
//   node --env-file=.env --import tsx scripts/smoke-notifications.mjs
//
// Uses the publishable key from .env and three new guest accounts. The scheduled run is
// triggered the way pg_cron does it, `select public.request_notification_run()`, through the
// linked Supabase CLI (`npx supabase db query --remote`), so this script never sees a
// service-role key. Its fake Web Push subscriptions use real P-256 keys (so the server's
// encryption runs) and endpoints on httpbin.org that answer 201 (accepted) or 410 (gone),
// standing in for a push service.
//
// It leaves a Group named "Smoke Test 11 <timestamp>" behind.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { reminderDueAt } from '../src/notify/plan.ts';
import { addDays } from '../src/schedule/format.ts';
import { localDate, localTime, zonedTimeToInstant } from '../src/schedule/expandSeries.ts';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (run with --env-file=.env)');
  process.exit(1);
}
const ACCEPTS = 'https://httpbin.org/status/201';
const GONE = 'https://httpbin.org/status/410';

let failures = 0;
function report(step, ok) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}`);
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function guest(name) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously({ options: { data: { display_name: name } } });
  report(`guest "${name}" signs in`, !error);
  if (error) process.exit(1);
  const done = await client.from('profiles').update({ display_name: name, onboarding_completed_at: new Date().toISOString() }).eq('id', data.user.id);
  report(`guest "${name}" finishes onboarding`, !done.error);
  return { client, userId: data.user.id };
}

async function call(client, body) {
  const { data, error } = await client.functions.invoke('group-command', { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { ok: false, reason: 'serverError' };
  }
}

/** A browser-like PushSubscription with real keys, pointing at `endpoint` (+ a unique query). */
function fakeSubscription(endpoint) {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return {
    endpoint: `${endpoint}?smoke=${randomBytes(6).toString('hex')}`,
    keys: { p256dh: raw.toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

const log = async (who) => (await who.client.from('notification_log').select('*').order('id')).data ?? [];
const devices = async (who) => (await who.client.from('push_tokens').select('token, kind')).data ?? [];

/** Waits for the background notify call that follows a command. */
async function waitFor(check, ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1500)) if (await check()) return true;
  return false;
}

/** Runs the 15-minute job now, as pg_cron does; returns its JSON report. */
async function runScheduledJob() {
  const sql = (q) =>
    // One quoted argument (npx needs a shell on Windows); the queries contain no double quotes.
    execFileSync('npx', ['supabase', 'db', 'query', '--remote', '--yes', `"${q}"`], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const id = /"request_id":\s*(\d+)/.exec(sql('select public.request_notification_run() as request_id'))?.[1];
  if (!id) return null;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const out = sql(`select status_code, content::text as content from net._http_response where id = ${id}`);
    const status = /"status_code":\s*(\d+)/.exec(out)?.[1];
    if (status) {
      const content = /"content":\s*"((?:[^"\\]|\\.)*)"/.exec(out)?.[1];
      return { status: Number(status), body: content ? JSON.parse(JSON.parse(`"${content}"`)) : null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

const A = await guest('Alex Rivera');
const B = await guest('Ben Turner');
const C = await guest('Cara Diaz');

const ZONE = 'America/Chicago';
const groupName = `Smoke Test 11 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const created = await call(A.client, { action: 'createGroup', name: groupName, memberName: 'Alex Rivera', timeZone: ZONE });
if (!report(`creates "${groupName}"`, created.ok)) process.exit(1);
const { groupId, memberId: alex } = created;
const command = (who, c) => call(who.client, { action: 'command', groupId, command: c });
report('adds Sound (needs confirmation)', (await command(A, { type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true } })).ok);
const link = await A.client.rpc('group_invite_link', { p_group_id: groupId });
const ben = (await call(B.client, { action: 'join', token: link.data, memberName: 'Ben Turner' })).memberId;
const cara = (await call(C.client, { action: 'join', token: link.data, memberName: 'Cara Diaz' })).memberId;
report('Ben and Cara join', !!ben && !!cara);
let qualified = true;
// Rotation order Ben, Cara, Alex: Ben holds the first Event, Cara the second.
for (const memberId of [ben, cara, alex]) qualified = (await command(A, { type: 'qualifyMember', memberId, responsibilityId: 'sound' })).ok && qualified;
report('qualifies Ben, Cara and Alex for Sound', qualified);

// Ben's reminder: "1 day before" at a local Chicago time that passed 5 minutes ago, for an
// Event exactly a day after it. The scheduled run must plan it now, at that local time.
const now = new Date();
const dueLocal = new Date(now.getTime() - 5 * 60_000).toISOString();
const reminderTime = localTime(dueLocal, ZONE);
const eventDate = addDays(localDate(dueLocal, ZONE), 1);
const firstStart = zonedTimeToInstant(eventDate, reminderTime, ZONE);
const secondStart = new Date(Date.parse(firstStart) + 4 * 86_400_000).toISOString();
report(
  'adds two one-off Events (tomorrow and in 5 days)',
  (await command(A, {
    type: 'addEvents',
    events: [
      { id: 'e1', seriesId: null, startsAt: firstStart, responsibilityIds: ['sound'] },
      { id: 'e2', seriesId: null, startsAt: secondStart, responsibilityIds: ['sound'] },
    ],
  })).ok,
);
const prefs = await B.client.from('profiles').update({ time_zone: ZONE, reminder_days_before: [1], reminder_time: reminderTime }).eq('id', B.userId);
report("sets Ben's reminder: 1 day before at a Chicago time", !prefs.error);

const rows = (await A.client.rpc('group_state_rows', { p_group_id: groupId })).data;
const seatOf = (eventId) => rows.assignments.find((a) => a.event_id === eventId && a.responsibility_id === 'sound');
report('Ben holds the first Event, Cara the second', seatOf('e1')?.member_id === ben && seatOf('e2')?.member_id === cara);

// Web Push subscriptions: Alex's and Cara's push service accepts, Ben's says 410 Gone.
for (const [who, endpoint] of [[A, ACCEPTS], [B, GONE], [C, ACCEPTS]]) {
  const { error } = await who.client.rpc('register_web_push', { p_subscription: fakeSubscription(endpoint) });
  report('registers a Web Push subscription', !error);
}
report('a bad subscription is refused', !!(await A.client.rpc('register_web_push', { p_subscription: { endpoint: 'http://x', keys: {} } })).error);
report('each guest sees only their own device', (await devices(A)).length === 1 && (await devices(B)).length === 1);

// --- A Decline: the Qualified Members are told right away, never the decliner.
const declined = await command(C, { type: 'decline', assignmentId: seatOf('e2').id, reason: 'Traveling' });
report('Cara declines her Sound turn', declined.ok);
const asked = (rows) => rows.filter((r) => r.kind === 'coverageRequest' && r.assignment_id === seatOf('e2').id);
report('Alex gets a Coverage Request notification', await waitFor(async () => asked(await log(A)).length === 1));
report('Ben gets one too', await waitFor(async () => asked(await log(B)).length === 1));
report('Cara (the decliner) gets none', (await log(C)).every((r) => r.kind !== 'coverageRequest'));
const [alexRow] = asked(await log(A));
report('it says who and what, links to Cover', alexRow?.title.startsWith('Can you cover Sound,') && alexRow.body.includes("Cara Diaz can't make Sound") && alexRow.body.includes('“Traveling”') && alexRow.url === `/assignment/${groupId}/${seatOf('e2').id}?action=cover`);
report("Alex's push service accepted it (delivered to 1 device)", alexRow?.delivered === 1);
const [benRow] = asked(await log(B));
report("Ben's push service said 410: nothing delivered", benRow?.delivered === 0);
report("…and Ben's dead subscription was removed", await waitFor(async () => (await devices(B)).length === 0));
report("Alex's subscription stays", (await devices(A)).length === 1);
report('Members cannot write the log', !!(await A.client.from('notification_log').insert({ dedupe_key: 'x', account_id: A.userId, kind: 'reminder', title: 't', body: 'b', url: '/' })).error);

// --- The scheduled run: Ben's reminder at his local time, exactly once.
const first = await runScheduledJob();
report('the scheduled run answers 200 ok', first?.status === 200 && first.body?.ok === true);
const reminders = (rows) => rows.filter((r) => r.kind === 'reminder' && r.assignment_id === seatOf('e1').id);
const [reminder] = reminders(await log(B));
report('Ben has a reminder for tomorrow', !!reminder && reminder.offset_key === '1d' && reminder.title === 'Tomorrow: Sound');
const due = reminderDueAt(firstStart, 1, { reminderTime, timeZone: ZONE });
report(`it is due at his chosen time in ${ZONE}, on the day before`, localTime(due, ZONE) === reminderTime && localDate(due, ZONE) === addDays(eventDate, -1) && Date.parse(due) <= Date.parse(reminder?.sent_at ?? 0));
const confirmations = (await log(B)).filter((r) => r.kind === 'confirmationRequested');
report('the run asked Ben to confirm (his turn entered the confirmation window)', confirmations.length === 1);
report('Ben had no device left: logged, nothing delivered', reminder?.delivered === 0);
const second = await runScheduledJob();
report('a second run answers 200 ok', second?.status === 200 && second.body?.ok === true);
report('…and sends Ben nothing new', reminders(await log(B)).length === 1 && (await log(B)).filter((r) => r.kind === 'confirmationRequested').length === 1);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
