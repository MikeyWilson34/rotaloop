// Live end-to-end check of the coverage follow-ups (ticket 16) against the hosted Supabase
// project: Decline reasons, withdrawDecline ("I can make it after all") and the "Time Off"
// reason under askVolunteer. Uses only the publishable key from .env and three new guest
// accounts. Prints step names and ok flags only.
//
//   node --env-file=.env --import tsx scripts/smoke-coverage-followups.mjs [session-file]
//
// It leaves its data behind: a Group named "Smoke Test 16 <timestamp>" (America/Chicago) with a
// weekly Sunday 10:00 series, ending with an open Decline by Ben ("Traveling: back on the 10th")
// for screenshots. When a session file path is given, Ben's and Alex's sessions are written
// there; they are never printed.
import { writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { stateFromRows } from '../src/db/groupRows.ts';
import { localDate } from '../src/schedule/expandSeries.ts';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (run with --env-file=.env)');
  process.exit(1);
}
const sessionFile = process.argv[2];
const ZONE = 'America/Chicago';

let failures = 0;
function report(step, ok) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}`);
  return ok;
}

async function guest(name) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously({ options: { data: { display_name: name } } });
  report(`guest "${name}" signs in`, !error);
  if (error) process.exit(1);
  const profile = await client
    .from('profiles')
    .update({ display_name: name, onboarding_completed_at: new Date().toISOString() })
    .eq('id', data.user.id);
  report(`guest "${name}" finishes onboarding`, !profile.error);
  return { client, session: data.session, userId: data.user.id };
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

const A = await guest('Alex Rivera');
const B = await guest('Ben Turner');
const C = await guest('Cara Diaz');

const groupName = `Smoke Test 16 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const created = await call(A.client, { action: 'createGroup', name: groupName, memberName: 'Alex Rivera', timeZone: ZONE });
if (!report(`creates "${groupName}"`, created.ok)) process.exit(1);
const { groupId, memberId: alex } = created;
const command = (who, c) => call(who.client, { action: 'command', groupId, command: c });

report(
  'adds Responsibility Sound (needs confirmation)',
  (await command(A, { type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true } })).ok,
);
const link = await A.client.rpc('group_invite_link', { p_group_id: groupId });
const ben = (await call(B.client, { action: 'join', token: link.data, memberName: 'Ben Turner' })).memberId;
const cara = (await call(C.client, { action: 'join', token: link.data, memberName: 'Cara Diaz' })).memberId;
report('Ben and Cara join with the invite link', !!ben && !!cara);
let qualified = true;
for (const memberId of [alex, ben, cara]) {
  qualified = (await command(A, { type: 'qualifyMember', memberId, responsibilityId: 'sound' })).ok && qualified;
}
report('qualifies Alex, Ben and Cara for Sound', qualified);
const today = localDate(new Date().toISOString(), ZONE);
const repeat = { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '10:00', timeZone: ZONE, startsOn: today };
report(
  'adds a weekly Sunday 10:00 series',
  (await command(A, { type: 'addEventSeries', series: { id: 'sun', name: 'Sunday mornings', responsibilityIds: ['sound'], repeat } })).ok,
);

async function load(who) {
  const { data, error } = await who.client.rpc('group_state_rows', { p_group_id: groupId });
  if (error) throw error;
  return stateFromRows(data);
}
const startsAt = (state, a) => state.events.find((e) => e.id === a.eventId)?.startsAt ?? '';
/** A Member's upcoming Sound Assignments, soonest first. */
function upcoming(state, memberId) {
  return state.assignments
    .filter((a) => a.memberId === memberId && !a.coverageRequest && Date.parse(startsAt(state, a)) > Date.now() + 3600e3)
    .sort((x, y) => Date.parse(startsAt(state, x)) - Date.parse(startsAt(state, y)));
}
async function row(who, assignmentId) {
  const { data } = await who.client
    .from('assignments')
    .select('member_id, confirmation, coverage_reason, coverage_note, cover_member_id')
    .eq('group_id', groupId)
    .eq('id', assignmentId)
    .single();
  return data;
}

let state = await load(A);
const first = upcoming(state, ben)[0];
if (!report('Ben has an upcoming Assignment', !!first)) process.exit(1);
const id = first.id;

// 1. Decline with a reason.
report('Ben declines with the reason "Traveling"', (await command(B, { type: 'decline', assignmentId: id, reason: 'Traveling' })).ok);
const seenByCara = await row(C, id);
report('the reason is stored and readable by another Member', seenByCara?.coverage_reason === 'declined' && seenByCara?.coverage_note === 'Traveling');
state = await load(C);
report('the reason loads into the engine state (CoverageRequest.note)', state.assignments.find((a) => a.id === id)?.coverageRequest?.note === 'Traveling');
const { data: hist1 } = await A.client
  .from('schedule_history')
  .select('cause')
  .eq('group_id', groupId)
  .order('state_version', { ascending: false })
  .limit(1);
report('the history cause carries the reason', hist1?.[0]?.cause?.type === 'decline' && hist1?.[0]?.cause?.reason === 'Traveling');

// 2. Withdraw: back in the seat.
report('Cara cannot withdraw Ben\'s Decline (notPermitted)', (await command(C, { type: 'withdrawDecline', assignmentId: id })).reason === 'notPermitted');
report('Ben withdraws ("I can make it after all")', (await command(B, { type: 'withdrawDecline', assignmentId: id })).ok);
const back = await row(A, id);
report(
  'Ben is back in the seat, the Coverage Request and reason are cleared, and it counts as confirmed',
  back?.member_id === ben && back?.coverage_reason === null && back?.coverage_note === null && back?.confirmation === 'confirmed',
);
const { data: hist2 } = await A.client
  .from('schedule_history')
  .select('cause, changes')
  .eq('group_id', groupId)
  .order('state_version', { ascending: false })
  .limit(1);
report(
  'history records withdrawDecline with a one-Assignment diff',
  hist2?.[0]?.cause?.type === 'withdrawDecline' && hist2?.[0]?.changes?.length === 1,
);

// 3. Decline again, Cara covers, then the withdraw is rejected.
report('Ben declines again', (await command(B, { type: 'decline', assignmentId: id, reason: 'Sick' })).ok);
report('Cara covers', (await command(C, { type: 'cover', assignmentId: id })).ok);
const late = await command(B, { type: 'withdrawDecline', assignmentId: id });
report('Ben\'s withdraw is rejected: alreadyCovered', late.ok === false && late.reason === 'alreadyCovered');
const covered = await row(A, id);
report('Cara still covers it', covered?.member_id === cara && covered?.cover_member_id === cara);

// 4. Time Off under askVolunteer stores "Time Off".
report('Admin switches Time Off handling to ask for a volunteer', (await command(A, { type: 'changeSettings', settings: { timeOffHandling: 'askVolunteer' } })).ok);
state = await load(A);
const alexTurn = upcoming(state, alex)[0];
if (report('Alex has an upcoming Assignment', !!alexTurn)) {
  const at = Date.parse(startsAt(state, alexTurn));
  const timeOff = {
    id: `to${Date.now().toString(36)}`,
    memberId: alex,
    startsAt: new Date(at - 2 * 3600e3).toISOString(),
    endsAt: new Date(at + 2 * 3600e3).toISOString(),
    timeZone: ZONE,
    note: 'Private note',
  };
  report('Alex adds Time Off over that Event', (await command(A, { type: 'addTimeOff', timeOff })).ok);
  const r = await row(C, alexTurn.id);
  report('it becomes a Coverage Request with the reason "Time Off" (the private note is not shown)', r?.coverage_reason === 'timeOff' && r?.coverage_note === 'Time Off');
}

// 5. An open Decline with a composed reason, left for the screenshots.
state = await load(A);
const shot = upcoming(state, ben)[0];
let shotOk = !!shot && (await command(B, { type: 'decline', assignmentId: shot.id, reason: 'Traveling: back on the 10th' })).ok;
report('Ben declines another turn with "Traveling: back on the 10th" (left open)', shotOk);
const tooLong = await command(B, { type: 'decline', assignmentId: upcoming(state, ben)[1]?.id ?? 'x', reason: 'x'.repeat(301) });
report('a reason over 300 characters is refused (invalidRequest)', tooLong.reason === 'invalidRequest');

if (sessionFile && shot) {
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  writeFileSync(sessionFile, JSON.stringify({ storageKey, groupId, assignmentId: shot.id, ben: B.session, alex: A.session }));
  report('saved sessions for screenshots', true);
}
console.log(failures === 0 ? 'All steps passed.' : `${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
