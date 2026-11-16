// Live end-to-end check of Time Off and Skip Dates (ticket 10) against the hosted Supabase
// project. Uses only the publishable key from .env and three new guest accounts. Prints step
// names and ok flags only.
//
//   node --env-file=.env --import tsx scripts/smoke-time-off-skip.mjs [session-file]
//
// It leaves its data behind: a Group named "Smoke Test 10 <timestamp>" (America/Chicago) with
// a weekly Sunday 10:00 series. When a session file path is given, the Admin guest's session is
// written there for signed-in screenshots; it is never printed.
import { writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { stateFromRows } from '../src/db/groupRows.ts';
import { toTimeOff } from '../src/engine/state.ts';
import { timeOffCovers } from '../src/engine/time.ts';
import { expandSeries, localDate, localTime, zonedTimeToInstant } from '../src/schedule/expandSeries.ts';
import { timeOffEntries, timeOffPlan, timeOffPreview } from '../src/schedule/timeOff.ts';

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

const groupName = `Smoke Test 10 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const created = await call(A.client, { action: 'createGroup', name: groupName, memberName: 'Alex Rivera', timeZone: ZONE });
if (!report(`creates "${groupName}"`, created.ok)) process.exit(1);
const { groupId, memberId: alex } = created;
const command = (who, c) => call(who.client, { action: 'command', groupId, command: c });

report(
  'adds Responsibility Sound',
  (await command(A, { type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: false } })).ok,
);
report('adds Placeholder Dana Park', (await command(A, { type: 'addMember', member: { name: 'Dana Park' } })).ok);
const link = await A.client.rpc('group_invite_link', { p_group_id: groupId });
const ben = (await call(B.client, { action: 'join', token: link.data, memberName: 'Ben Turner' })).memberId;
const cara = (await call(C.client, { action: 'join', token: link.data, memberName: 'Cara Diaz' })).memberId;
report('Ben and Cara join with the invite link', !!ben && !!cara);
const { data: memberRows } = await A.client.from('members').select('id, display_name').eq('group_id', groupId);
const dana = memberRows.find((m) => m.display_name === 'Dana Park')?.id;
let qualified = !!dana;
for (const memberId of [alex, ben, cara, dana]) {
  qualified = (await command(A, { type: 'qualifyMember', memberId, responsibilityId: 'sound' })).ok && qualified;
}
report('qualifies Alex, Ben, Cara and Dana for Sound', qualified);

const today = localDate(new Date().toISOString(), ZONE);
const repeat = { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '10:00', timeZone: ZONE, startsOn: today };
report(
  'adds a weekly Sunday 10:00 series (Events made on the server)',
  (await command(A, { type: 'addEventSeries', series: { id: 'sun', name: 'Sunday mornings', responsibilityIds: ['sound'], repeat } })).ok,
);

/** The full engine state as a Member sees it (the app's preview input). */
async function load(who) {
  const { data, error } = await who.client.rpc('group_state_rows', { p_group_id: groupId });
  if (error) throw error;
  return stateFromRows(data);
}
const now = () => new Date().toISOString();
const future = (state) =>
  state.events.filter((e) => Date.parse(e.startsAt) > Date.now()).sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
/** Who serves Sound at each upcoming Event: member id, "open:<id>" for a Coverage Request, or "skip". */
const lineup = (state) =>
  future(state).map((e) => {
    if (e.skipDate) return 'skip';
    const a = state.assignments.find((x) => x.eventId === e.id && x.responsibilityId === 'sound');
    if (!a) return 'none';
    return a.coverageRequest && !a.coverageRequest.cover ? `open:${a.memberId}` : a.memberId;
  });
const asGroup = (state, memberId) => ({ id: groupId, name: groupName, timeZone: ZONE, state, myMemberId: memberId });
const dayOf = (e) => localDate(e.startsAt, ZONE);
const people = (changes) => new Set(changes.flatMap((c) => [c.before?.memberId, c.after?.memberId]).filter(Boolean));

// --- Time Off routes around: exactly two people swap -----------------------------------------
let state = await load(B);
const bensTurn = future(state).find((e) => state.assignments.some((a) => a.eventId === e.id && a.memberId === ben));
const bensDay = bensTurn ? dayOf(bensTurn) : null;
const draft = { dates: [bensDay], repeat: 'none', scope: 'all', note: 'Family trip' };
const preview = timeOffPreview(timeOffPlan(draft, [asGroup(state, ben)], 'smoke'), now(), ZONE);
report('preview (engine on loaded state): Ben\'s turn goes to the next in line, he takes theirs', preview.lines.length === 1 && preview.lines[0].kind === 'route' && preview.othersAffected === 1);
const [benOff] = timeOffEntries(draft, asGroup(state, ben), `to${Date.now().toString(36)}`);
const routed = await command(B, { type: 'addTimeOff', timeOff: benOff });
const swapped = people(routed.changes ?? []);
report('Ben (a Member) adds Time Off on a day he serves', routed.ok);
report('exactly two people swapped (Ben and the next in line)', routed.ok && swapped.size === 2 && swapped.has(ben));
state = await load(B);
report('Ben no longer serves that day, and the note is stored', !lineup(state).includes(undefined) &&
  state.assignments.every((a) => a.eventId !== bensTurn.id || a.memberId !== ben) &&
  state.timeOff.some((t) => t.memberId === ben && t.note === 'Family trip'));

// --- askVolunteer: Time Off makes a Coverage Request -------------------------------------------
report('Admin switches Time Off handling to "ask for a volunteer"', (await command(A, { type: 'changeSettings', settings: { timeOffHandling: 'askVolunteer' } })).ok);
state = await load(C);
const carasTurn = future(state).find((e) => state.assignments.some((a) => a.eventId === e.id && a.memberId === cara && !a.coverageRequest));
const caraDraft = { dates: [dayOf(carasTurn)], repeat: 'none', scope: 'all', note: '' };
const caraPreview = timeOffPreview(timeOffPlan(caraDraft, [asGroup(state, cara)], 'smoke'), now(), ZONE);
report('preview says it becomes a Coverage Request', caraPreview.lines.length === 1 && caraPreview.lines[0].kind === 'coverage');
const [caraOff] = timeOffEntries(caraDraft, asGroup(state, cara), `to${Date.now().toString(36)}c`);
const asked = await command(C, { type: 'addTimeOff', timeOff: caraOff });
state = await load(C);
const caraSeat = state.assignments.find((a) => a.eventId === carasTurn.id && a.responsibilityId === 'sound');
report('Cara\'s new Time Off makes a Coverage Request (reason timeOff)', asked.ok && caraSeat?.coverageRequest?.reason === 'timeOff' && !caraSeat.coverageRequest.cover);
report('Admin switches back to "route around"', (await command(A, { type: 'changeSettings', settings: { timeOffHandling: 'routeAround' } })).ok);

// --- Skip Date with a reason: everyone moves forward one Event; then removed: restored ---------
state = await load(B);
const upcoming = future(state);
const skipIndex = 5;
const skipEvent = upcoming[skipIndex];
const before = lineup(state);
const reason = 'Holiday: Building closed';
const skipped = await command(B, { type: 'addSkipDate', eventId: skipEvent.id, reason });
report('Ben (a Member) adds a Skip Date with a reason', skipped.ok);
state = await load(B);
const after = lineup(state);
const tail = (list, from) => list.slice(from).filter((x) => x !== 'skip');
report(
  'everyone from the Skip Date on moves forward one Event (no turn used up)',
  after[skipIndex] === 'skip' &&
    JSON.stringify(after.slice(0, skipIndex)) === JSON.stringify(before.slice(0, skipIndex)) &&
    JSON.stringify(tail(after, skipIndex + 1)) === JSON.stringify(before.slice(skipIndex, skipIndex + tail(after, skipIndex + 1).length)),
);
const { data: skipRow } = await B.client.from('events').select('skip_date_reason, skip_date_marked_by').eq('group_id', groupId).eq('id', skipEvent.id).single();
report('the reason is stored on the Event', skipRow?.skip_date_reason === reason && skipRow?.skip_date_marked_by === ben);
const { data: skipHistory } = await C.client.from('schedule_history').select('cause').eq('group_id', groupId).eq('cause_type', 'addSkipDate');
report('the reason is kept in the schedule history', skipHistory?.some((h) => h.cause?.reason === reason));
const removed = await command(C, { type: 'removeSkipDate', eventId: skipEvent.id });
state = await load(C);
report('Cara (another Member) removes it: the Rotation is restored', removed.ok && JSON.stringify(lineup(state)) === JSON.stringify(before));

// --- Repeating Time Off across the March 2027 DST change ---------------------------------------
const dstChange = (() => {
  for (let y = Number(today.slice(0, 4)); ; y++) {
    const march = new Date(Date.UTC(y, 2, 1));
    const secondSunday = 1 + ((7 - march.getUTCDay()) % 7) + 7;
    const date = `${y}-03-${String(secondSunday).padStart(2, '0')}`;
    if (date > today) return date;
  }
})();
state = await load(A);
const until = new Date(Date.parse(`${dstChange}T23:00:00Z`) + 21 * 86_400_000).toISOString();
const extension = expandSeries({
  seriesId: 'sun',
  pattern: repeat,
  existing: state.events.map((e) => ({ id: e.id, seriesId: e.seriesId, startsAt: e.startsAt })),
  now: now(),
  until,
});
report(`extends the series past the ${dstChange} DST change (as the daily job will)`, (await command(A, { type: 'addEvents', events: extension })).ok && extension.length > 0);

// "Every Sunday 9:30-10:30 AM" for Dana, from the 8th upcoming Sunday (before the change).
state = await load(A);
const from = future(state)[7];
const start = zonedTimeToInstant(dayOf(from), '09:30', ZONE);
const end = zonedTimeToInstant(dayOf(from), '10:30', ZONE);
const weekly = { id: `to${Date.now().toString(36)}w-r1`, memberId: dana, startsAt: start, endsAt: end, repeatEveryWeeks: 1, timeZone: ZONE };
report('Admin adds Dana\'s weekly Time Off, Sundays 9:30-10:30 AM Chicago time', (await command(A, { type: 'addTimeOff', timeOff: weekly })).ok);
state = await load(A);
const covered = future(state).filter((e) => e.startsAt >= from.startsAt && !e.skipDate);
const beforeDst = covered.filter((e) => dayOf(e) < dstChange);
const afterDst = covered.filter((e) => dayOf(e) >= dstChange);
const danaServes = (e) => state.assignments.some((a) => a.eventId === e.id && a.memberId === dana && !a.coverageRequest);
report('every Event is at 10:00 local on both sides of the change', covered.every((e) => localTime(e.startsAt, ZONE) === '10:00') && afterDst.length >= 3);
report('Dana serves no Sunday before the change', beforeDst.length > 0 && !beforeDst.some(danaServes));
report('Dana serves no Sunday after the change (the repeat keeps its local time)', !afterDst.some(danaServes));
report('the Time Off is stored with the Group time zone', state.timeOff.some((t) => t.memberId === dana && t.timeZone === ZONE && t.repeatEveryWeeks === 1));
const utcOnly = toTimeOff({ ...weekly, timeZone: null });
report('(without the zone, whole UTC weeks would miss the Sundays after the change)', afterDst.every((e) => !timeOffCovers(utcOnly, e, 'sound')));
report('Dana still holds her place: she serves again once the Time Off ends (queue unchanged)', state.rotations[0].queue.includes(dana));

if (sessionFile) {
  writeFileSync(
    sessionFile,
    JSON.stringify({ storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`, session: A.session, groupId }),
  );
  report('saved the Admin session for screenshots', true);
}
console.log(failures === 0 ? 'All steps passed.' : `${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
