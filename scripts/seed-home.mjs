// Seeds Home and Activity for screenshots (ticket 12) against the hosted Supabase project. Uses
// only the publishable key from .env and new guest accounts. Prints step names and ok flags only.
//
//   node --env-file=.env --import tsx scripts/seed-home.mjs [session-file]
//
// The viewer, Alex Rivera, is an Admin of "Smoke Test 12 Sunday Team …" and a plain Member of
// "Smoke Test 12 Hospitality …" (Ben's). It leaves:
// - Alex's next Assignment (Sound, Sunday) Pending: the hero, with Confirm / Can't make it;
// - a Coverage Request Alex can cover in each Group (Ben's Sound, Casey's Host);
// - Replacement Duty for Alex: Dana declined a one-off Setup Event two days out, past the
//   "find a replacement by" deadline, and the Sunday Team gives Replacement Duty to Admins;
// - a Skip Date with a reason (added by Casey), a confirmation, and other history.
// Casey Kim administers nothing (the plain-Member Home); Evan Park is only in Hospitality and
// serves nothing (the empty, caught-up Home). With a session file path, the sessions and ids
// are written there (never printed).
import { writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { stateFromRows } from '../src/db/groupRows.ts';
import { addDays } from '../src/schedule/format.ts';
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
const today = localDate(new Date().toISOString(), ZONE);

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
const E = await guest('Evan Park');
const F = await guest('Fran Ortiz'); // in no group at all

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const ok = (r) => r.ok === true;

async function load(who, groupId) {
  const { data, error } = await who.client.rpc('group_state_rows', { p_group_id: groupId });
  if (error) throw error;
  return stateFromRows(data);
}
const startsAt = (state, a) => state.events.find((e) => e.id === a.eventId).startsAt;
const turnsOf = (state, memberId, responsibilityId) =>
  state.assignments
    .filter((a) => a.memberId === memberId && a.responsibilityId === responsibilityId && !a.coverageRequest)
    .filter((a) => Date.parse(startsAt(state, a)) > Date.now())
    .sort((x, y) => Date.parse(startsAt(state, x)) - Date.parse(startsAt(state, y)));

// ---------------------------------------------------------------------------
// Sunday Team (Alex is the Admin)

const teamName = `Smoke Test 12 Sunday Team ${stamp}`;
const team = await call(A.client, { action: 'createGroup', name: teamName, memberName: 'Alex Rivera', timeZone: ZONE });
if (!report('Alex creates the Sunday Team', ok(team))) process.exit(1);
const teamId = team.groupId;
const T = (who, command) => call(who.client, { action: 'command', groupId: teamId, command });
const ids = { alex: team.memberId };

report('adds Sound (needs confirmation)', ok(await T(A, { type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true } })));
report('adds Greeter', ok(await T(A, { type: 'addResponsibility', responsibility: { id: 'greeter', name: 'Greeter', headcount: 1, requiresConfirmation: false } })));
report('adds Setup', ok(await T(A, { type: 'addResponsibility', responsibility: { id: 'setup', name: 'Setup', headcount: 1, requiresConfirmation: false } })));
report('makes Sound the Primary Responsibility', ok(await T(A, { type: 'setPrimaryResponsibility', responsibilityId: 'sound' })));
report('Replacement Duty goes to Admins', ok(await T(A, { type: 'changeSettings', settings: { replacementDuty: 'admins' } })));

const teamLink = await A.client.rpc('group_invite_link', { p_group_id: teamId });
for (const [who, name] of [[B, 'Ben Turner'], [C, 'Casey Kim'], [D, 'Dana Wells']]) {
  const joined = await call(who.client, { action: 'join', token: teamLink.data, memberName: name });
  report(`${name} joins the Sunday Team`, ok(joined));
  ids[name.split(' ')[0].toLowerCase()] = joined.memberId;
}
let qualified = true;
for (const m of [ids.alex, ids.ben, ids.casey, ids.dana]) qualified = ok(await T(A, { type: 'qualifyMember', memberId: m, responsibilityId: 'sound' })) && qualified;
for (const m of [ids.ben, ids.casey, ids.dana]) qualified = ok(await T(A, { type: 'qualifyMember', memberId: m, responsibilityId: 'greeter' })) && qualified;
qualified = ok(await T(A, { type: 'qualifyMember', memberId: ids.dana, responsibilityId: 'setup' })) && qualified;
report('qualifies Members (Sound: all four; Greeter: Ben, Casey, Dana; Setup: Dana)', qualified);
report('Sound queue: Alex, Ben, Casey, Dana', ok(await T(A, { type: 'reorderQueue', responsibilityId: 'sound', queue: [ids.alex, ids.ben, ids.casey, ids.dana] })));
report(
  'adds a weekly Sunday 9:00 AM Event Series (Sound, Greeter)',
  ok(
    await T(A, {
      type: 'addEventSeries',
      series: {
        id: 'sun',
        name: 'Sunday gathering',
        responsibilityIds: ['sound', 'greeter'],
        repeat: { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '09:00', timeZone: ZONE, startsOn: addDays(today, 1) },
      },
    }),
  ),
);

let s = await load(A, teamId);
const alexSound = turnsOf(s, ids.alex, 'sound');
const benSound = turnsOf(s, ids.ben, 'sound');
const caseySound = turnsOf(s, ids.casey, 'sound');
const danaSound = turnsOf(s, ids.dana, 'sound');
report('Events and Assignments were generated', alexSound.length >= 2 && benSound.length >= 1 && caseySound.length >= 1);

// History and states.
report('Alex asks for confirmation of his next Sound turn and Casey’s', ok(await T(A, { type: 'requestConfirmation', assignmentIds: [alexSound[0].id, caseySound[0].id, danaSound[0].id] })));
report('Dana confirms her Sound turn', ok(await T(D, { type: 'confirm', assignmentId: danaSound[0].id })));
report('Ben can’t make his Sound turn (a Coverage Request Alex can cover)', ok(await T(B, { type: 'decline', assignmentId: benSound[0].id })));

// Replacement Duty: a one-off Setup Event two days out, declined by Dana.
const setupAt = new Date(Math.ceil((Date.now() + 2 * DAY) / (60 * 60 * 1000)) * 60 * 60 * 1000).toISOString();
report('adds a one-off Setup Event in about two days', ok(await T(A, { type: 'addEvents', events: [{ id: 'setup-1', seriesId: null, startsAt: setupAt, responsibilityIds: ['setup'] }] })));
s = await load(A, teamId);
const setup = s.assignments.find((a) => a.eventId === 'setup-1');
report('Dana holds the Setup turn', setup?.memberId === ids.dana);
report('Dana can’t make Setup (past the deadline: Replacement Duty for the Admins)', ok(await T(D, { type: 'decline', assignmentId: setup.id })));

// A Skip Date with a reason, a few weeks out (after Alex's first turns).
const sundays = s.events.filter((e) => e.seriesId === 'sun').sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
const skip = sundays[5];
report('Casey marks a Sunday as a Skip Date ("Building closed")', !!skip && ok(await T(C, { type: 'addSkipDate', eventId: skip.id, reason: 'Building closed' })));

// ---------------------------------------------------------------------------
// Hospitality (Ben is the Admin; Alex and Casey are Members; Evan serves nothing)

const hospName = `Smoke Test 12 Hospitality ${stamp}`;
const hosp = await call(B.client, { action: 'createGroup', name: hospName, memberName: 'Ben Turner', timeZone: ZONE });
if (!report('Ben creates Hospitality', ok(hosp))) process.exit(1);
const hospId = hosp.groupId;
const H = (who, command) => call(who.client, { action: 'command', groupId: hospId, command });
const hids = { ben: hosp.memberId };
report('adds Host', ok(await H(B, { type: 'addResponsibility', responsibility: { id: 'host', name: 'Host', headcount: 1, requiresConfirmation: false } })));
report('makes Host the Primary Responsibility', ok(await H(B, { type: 'setPrimaryResponsibility', responsibilityId: 'host' })));
const hospLink = await B.client.rpc('group_invite_link', { p_group_id: hospId });
for (const [who, name] of [[A, 'Alex Rivera'], [C, 'Casey Kim'], [E, 'Evan Park']]) {
  const joined = await call(who.client, { action: 'join', token: hospLink.data, memberName: name });
  report(`${name} joins Hospitality`, ok(joined));
  hids[name.split(' ')[0].toLowerCase()] = joined.memberId;
}
let hq = true;
for (const m of [hids.ben, hids.casey, hids.alex]) hq = ok(await H(B, { type: 'qualifyMember', memberId: m, responsibilityId: 'host' })) && hq;
report('qualifies Ben, Casey and Alex for Host', hq);
report('Host queue: Ben, Casey, Alex', ok(await H(B, { type: 'reorderQueue', responsibilityId: 'host', queue: [hids.ben, hids.casey, hids.alex] })));
report(
  'adds a weekly Wednesday 6:30 PM Event Series',
  ok(
    await H(B, {
      type: 'addEventSeries',
      series: {
        id: 'wed',
        name: 'Welcome night',
        responsibilityIds: ['host'],
        repeat: { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [3], weekOfMonth: null, startTime: '18:30', timeZone: ZONE, startsOn: addDays(today, 3) },
      },
    }),
  ),
);
const hs = await load(B, hospId);
const caseyHost = turnsOf(hs, hids.casey, 'host');
report('Casey can’t make her Host turn (another request Alex can cover)', caseyHost.length > 0 && ok(await H(C, { type: 'decline', assignmentId: caseyHost[0].id })));

if (sessionFile) {
  writeFileSync(
    sessionFile,
    JSON.stringify({
      storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
      sessions: { alex: A.session, ben: B.session, casey: C.session, dana: D.session, evan: E.session, fran: F.session },
      groups: { team: teamId, hospitality: hospId },
    }),
  );
  report('saved the sessions for screenshots', true);
}
console.log(failures === 0 ? 'All steps ok' : `${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
