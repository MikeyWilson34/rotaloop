// Live smoke test for Confirm, Decline, Cover and Mark covered (ticket 09) against the hosted
// Supabase project. Uses only the publishable key from .env and four new guest accounts. Prints
// step names and ok / rejection reasons only.
//
//   node --env-file=.env --import tsx scripts/smoke-coverage.mjs [session-file]
//
// It creates a Group named "Smoke Test 09 <timestamp>" (Sound, needs confirmation; Pay It Back;
// Events on Sundays and Wednesdays), then: B confirms; B declines (a Coverage Request); A and C
// try to cover at the same moment (exactly one wins, the other gets alreadyCovered); the Make-up
// Turn exists; D declines a one-off Event two days out, which is already past the "find a
// replacement by" deadline (3 days), so D holds Replacement Duty and marks it covered with a
// Guest; the withdraw check (the engine has no withdraw command). It leaves one Assignment in each
// state for screenshots. With a session file path, the four guests' sessions and the ids are
// written there (never printed).
import { writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { stateFromRows } from '../src/db/groupRows.ts';
import { replacementDutyHolder } from '../src/engine/status.ts';
import { localDate } from '../src/schedule/expandSeries.ts';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (run with --env-file=.env)');
  process.exit(1);
}
const sessionFile = process.argv[2];
const ZONE = 'America/Chicago';
const DAY = 24 * 60 * 60 * 1000;

let failures = 0;
function report(step, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? ` (${detail})` : ''}`);
  return ok;
}
const why = (r) => (r.ok ? 'ok' : r.reason);

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
  return { client, session: data.session };
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
const C = await guest('Casey Kim');
const D = await guest('Dana Wells');

const groupName = `Smoke Test 09 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const created = await call(A.client, { action: 'createGroup', name: groupName, memberName: 'Alex Rivera', timeZone: ZONE });
if (!report(`creates "${groupName}"`, created.ok)) process.exit(1);
const { groupId, memberId: alex } = created;
const command = (who, c) => call(who.client, { action: 'command', groupId, command: c });

report(
  'adds Responsibility Sound (needs confirmation)',
  (await command(A, { type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true } })).ok,
);
const link = await A.client.rpc('group_invite_link', { p_group_id: groupId });
const ids = { alex };
for (const [who, name] of [[B, 'Ben Turner'], [C, 'Casey Kim'], [D, 'Dana Wells']]) {
  const joined = await call(who.client, { action: 'join', token: link.data, memberName: name });
  report(`${name} joins with the link`, joined.ok);
  ids[name.split(' ')[0].toLowerCase()] = joined.memberId;
}
const { ben, casey, dana } = ids;
let qualified = true;
for (const memberId of [alex, ben, casey, dana]) {
  qualified = (await command(A, { type: 'qualifyMember', memberId, responsibilityId: 'sound' })).ok && qualified;
}
report('qualifies all four for Sound', qualified);
const repeat = {
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0, 3],
  weekOfMonth: null,
  startTime: '09:00',
  timeZone: ZONE,
  startsOn: localDate(new Date().toISOString(), ZONE),
};
report(
  'adds an Event Series on Sundays and Wednesdays at 9:00 AM',
  (await command(A, { type: 'addEventSeries', series: { id: 'main', name: 'Gathering', responsibilityIds: ['sound'], repeat } })).ok,
);

async function load(who = A) {
  const { data, error } = await who.client.rpc('group_state_rows', { p_group_id: groupId });
  if (error) throw error;
  return stateFromRows(data);
}
let state = await load();
report('Events and Assignments were generated', state.events.length >= 16 && state.assignments.length >= 16, `${state.events.length} Events`);
const queue = () => state.rotations.find((r) => r.responsibilityId === 'sound').queue;
const startsAt = (a) => state.events.find((e) => e.id === a.eventId).startsAt;

// --- Short notice: D declines a one-off Event two days out (already past the 3-day deadline).
async function shortNoticeEventForDana(id, inMs) {
  report(`puts Dana first in the queue (${id})`, (await command(A, { type: 'reorderQueue', responsibilityId: 'sound', queue: [dana, ...queue().filter((m) => m !== dana)] })).ok);
  const at = new Date(Math.ceil((Date.now() + inMs) / (60 * 60 * 1000)) * 60 * 60 * 1000).toISOString();
  report(`adds a one-off Event in about two days (${id})`, (await command(A, { type: 'addEvents', events: [{ id, seriesId: null, startsAt: at, responsibilityIds: ['sound'] }] })).ok);
  state = await load();
  return state.assignments.find((a) => a.eventId === id);
}

const e1 = await shortNoticeEventForDana('short-1', 2 * DAY);
report('the one-off Event is Dana’s', e1?.memberId === dana);
report('D declines → Coverage Request', why(await command(D, { type: 'decline', assignmentId: e1.id })) === 'ok');
state = await load();
const e1Now = state.assignments.find((a) => a.id === e1.id);
const holder = replacementDutyHolder(e1Now, startsAt(e1Now), state.settings, new Date().toISOString());
report('past the deadline: Replacement Duty is on the Member who declined', holder === 'assignedMember', holder ?? 'none yet');
const caseyMark = await command(C, { type: 'markCovered', assignmentId: e1.id, by: { guestName: 'Someone' } });
report('C (no duty, not Admin) can’t mark it covered', !caseyMark.ok, why(caseyMark));
report('D marks it covered with a Guest', why(await command(D, { type: 'markCovered', assignmentId: e1.id, by: { guestName: 'Jordan Blake' } })) === 'ok');
state = await load();
const guestCovered = state.assignments.find((a) => a.id === e1.id);
report(
  'Guest Cover recorded with no Make-up Turn',
  guestCovered.coverageRequest?.cover?.kind === 'guest' && !state.makeUpTurns.some((t) => t.coverAssignmentId === e1.id),
);

// A second short-notice request left open (Find a replacement, for screenshots). Dana's place was
// used by the first one, so whoever holds this one declines it.
report('adds a second one-off Event in about two days', (await command(A, { type: 'addEvents', events: [{ id: 'short-2', seriesId: null, startsAt: new Date(Math.ceil((Date.now() + 2 * DAY + 3 * 60 * 60 * 1000) / (60 * 60 * 1000)) * 60 * 60 * 1000).toISOString(), responsibilityIds: ['sound'] }] })).ok);
state = await load();
const e2 = state.assignments.find((a) => a.eventId === 'short-2');
const byMember = { [alex]: ['alex', A], [ben]: ['ben', B], [casey]: ['casey', C], [dana]: ['dana', D] };
const [e2Holder, e2Client] = byMember[e2?.memberId] ?? [null, null];
report('its holder declines it (left open: Find a replacement)', !!e2Client && why(await command(e2Client, { type: 'decline', assignmentId: e2.id })) === 'ok', e2Holder ?? 'nobody');

// --- B confirms, then can't make it; A and C race to cover.
const farEnough = (a) => Date.parse(startsAt(a)) > Date.now() + 4 * DAY;
const bensTurns = () =>
  state.assignments
    .filter((a) => a.memberId === ben && a.coverageRequest === null && a.makeUpTurnId === null && farEnough(a))
    .sort((x, y) => Date.parse(startsAt(x)) - Date.parse(startsAt(y)));
state = await load();
const b1 = bensTurns()[0];
report('A asks B to confirm a Sound turn (Pending)', why(await command(A, { type: 'requestConfirmation', assignmentIds: [b1.id] })) === 'ok');
report('B confirms', why(await command(B, { type: 'confirm', assignmentId: b1.id })) === 'ok');
report('B declines after all → Coverage Request', why(await command(B, { type: 'decline', assignmentId: b1.id })) === 'ok');
const [fromA, fromC] = await Promise.all([
  command(A, { type: 'cover', assignmentId: b1.id }),
  command(C, { type: 'cover', assignmentId: b1.id }),
]);
const results = [why(fromA), why(fromC)];
report(
  'A and C cover at the same moment: exactly one wins, the other gets alreadyCovered',
  results.filter((r) => r === 'ok').length === 1 && results.includes('alreadyCovered'),
  `A: ${results[0]}, C: ${results[1]}`,
);
const winner = fromA.ok ? alex : casey;
state = await load();
const turn = state.makeUpTurns.find((t) => t.coverAssignmentId === b1.id);
const paying = turn && state.assignments.find((a) => a.makeUpTurnId === turn.id);
report(
  'Pay It Back: B owes the winner a Make-up Turn, placed on the winner’s next turn',
  turn?.status === 'outstanding' && turn.debtorId === ben && turn.creditorId === winner && paying?.memberId === ben,
);

// --- One Assignment in each remaining state, and the withdraw check.
state = await load();
const [b2, b3, b4, b5] = bensTurns();
report('A asks B to confirm another turn (left Pending)', !!b2 && why(await command(A, { type: 'requestConfirmation', assignmentIds: [b2.id] })) === 'ok');
report('B confirms a turn early (Confirmed)', !!b3 && why(await command(B, { type: 'confirm', assignmentId: b3.id })) === 'ok');
report('B declines another turn (left open)', !!b5 && why(await command(B, { type: 'decline', assignmentId: b5.id })) === 'ok');
const withdraw = await command(B, { type: 'confirm', assignmentId: b5.id });
report(
  'withdraw: the engine has no withdraw command; confirm on the request is refused',
  withdraw.ok === false && withdraw.reason === 'alreadyNeedsCoverage',
  why(withdraw),
);

// --- Rebalance still works (a separate Group, so B's Make-up Turn stays outstanding here).
const other = await call(A.client, { action: 'createGroup', name: `${groupName} rebalance`, memberName: 'Alex Rivera', timeZone: ZONE });
const otherCommand = (c) => call(A.client, { action: 'command', groupId: other.groupId, command: c });
report('rebalance group created', other.ok);
report('adds a Responsibility there', (await otherCommand({ type: 'addResponsibility', responsibility: { id: 'host', name: 'Host', headcount: 1, requiresConfirmation: false } })).ok);
report('qualifies the Admin', (await otherCommand({ type: 'qualifyMember', memberId: other.memberId, responsibilityId: 'host' })).ok);
report('Admin rebalances', why(await otherCommand({ type: 'rebalance', responsibilityId: 'host' })) === 'ok');

if (sessionFile) {
  writeFileSync(
    sessionFile,
    JSON.stringify({
      storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
      sessions: { alex: A.session, ben: B.session, casey: C.session, dana: D.session },
      groupId,
      winner: fromA.ok ? 'alex' : 'casey',
      findReplacementHolder: e2Holder,
      assignments: {
        pending: b2?.id,
        confirmed: b3?.id,
        scheduled: b4?.id,
        openRequest: b5?.id,
        covered: b1.id,
        makeUpTurn: paying?.id,
        guestCover: e1.id,
        findReplacement: e2?.id,
      },
    }),
  );
  report('saved the sessions for screenshots', true);
}
console.log(failures === 0 ? 'All steps ok' : `${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
