// Live seed for the schedule views (ticket 08) against the hosted Supabase project. Uses only
// the publishable key from .env and two new guest accounts. Prints step names and ok flags only.
//
//   node --env-file=.env scripts/seed-schedule.mjs [session-file]
//
// It creates a Group named "Smoke Test 08 <timestamp>" with two Responsibilities, two
// Placeholders and a second guest Member, a weekly Event Series, one Decline that is Covered
// (so a Make-up Turn is owed), one Skip Date and one Guest Cover. When a session file path is
// given, the first guest's session is written there (for signed-in screenshots); it is never
// printed.
import { writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

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

const groupName = `Smoke Test 08 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const created = await call(A.client, { action: 'createGroup', name: groupName, memberName: 'Alex Rivera', timeZone: ZONE });
if (!report(`creates "${groupName}"`, created.ok)) process.exit(1);
const { groupId, memberId: alex } = created;
const command = (client, c) => call(client, { action: 'command', groupId, command: c });

report(
  'adds Responsibility Sound (needs confirmation)',
  (await command(A.client, { type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true } })).ok,
);
report(
  'adds Responsibility Greeter',
  (await command(A.client, { type: 'addResponsibility', responsibility: { id: 'greeter', name: 'Greeter', headcount: 1, requiresConfirmation: false } })).ok,
);
report('makes Sound the Primary Responsibility', (await command(A.client, { type: 'setPrimaryResponsibility', responsibilityId: 'sound' })).ok);
for (const name of ['Pat Morgan', 'Sam Lee']) {
  report(`adds Placeholder ${name}`, (await command(A.client, { type: 'addMember', member: { name } })).ok);
}

const link = await A.client.rpc('group_invite_link', { p_group_id: groupId });
report('reads the Group invite link', !link.error && !!link.data);
const joined = await call(B.client, { action: 'join', token: link.data, memberName: 'Ben Turner' });
report('second guest joins with the link', joined.ok);
const ben = joined.memberId;

const { data: members } = await A.client.from('members').select('id, display_name').eq('group_id', groupId);
const id = (name) => members.find((m) => m.display_name === name)?.id;
const [pat, sam] = [id('Pat Morgan'), id('Sam Lee')];
const qualify = { sound: [alex, ben, pat], greeter: [sam, pat, ben, alex] };
let qualifiedOk = !!pat && !!sam && !!ben;
for (const [responsibilityId, ids] of Object.entries(qualify)) {
  for (const memberId of ids) {
    qualifiedOk = (await command(A.client, { type: 'qualifyMember', memberId, responsibilityId })).ok && qualifiedOk;
  }
}
report('qualifies Members for Sound and Greeter', qualifiedOk);

const repeat = {
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0],
  weekOfMonth: null,
  startTime: '09:00',
  timeZone: ZONE,
  startsOn: localDate(new Date().toISOString(), ZONE),
};
report(
  'adds a weekly Sunday 9:00 AM Event Series',
  (await command(A.client, { type: 'addEventSeries', series: { id: 'sun', name: 'Sunday gathering', responsibilityIds: ['sound', 'greeter'], repeat } })).ok,
);

async function load() {
  const [events, assignments] = await Promise.all([
    A.client.from('events').select('id, starts_at, skip_date_marked_at').eq('group_id', groupId).order('starts_at'),
    A.client.from('assignments').select('id, event_id, responsibility_id, member_id, make_up_turn_id, cover_kind').eq('group_id', groupId),
  ]);
  return { events: events.data ?? [], assignments: assignments.data ?? [] };
}
let state = await load();
report('Events and Assignments were generated', state.events.length >= 8 && state.assignments.length >= 16);
const seatedAt = (eventId, memberId) => state.assignments.some((a) => a.event_id === eventId && a.member_id === memberId);
const eventIndex = (eventId) => state.events.findIndex((e) => e.id === eventId);

// One Decline that is Covered: Ben can't make his first Sound turn; Alex covers it (Pay It Back).
const bensSound = state.assignments
  .filter((a) => a.responsibility_id === 'sound' && a.member_id === ben && !seatedAt(a.event_id, alex))
  .sort((x, y) => eventIndex(x.event_id) - eventIndex(y.event_id))[0];
report('Ben declines a Sound turn', !!bensSound && (await command(B.client, { type: 'decline', assignmentId: bensSound.id })).ok);
report('Alex covers it', (await command(A.client, { type: 'cover', assignmentId: bensSound.id })).ok);
state = await load();
report('a Make-up Turn is placed (Ben owes Alex)', state.assignments.some((a) => a.make_up_turn_id));

// One Skip Date: the fourth Event.
const skipEvent = state.events[3];
report('Ben adds a Skip Date', (await command(B.client, { type: 'addSkipDate', eventId: skipEvent.id })).ok);
state = await load();

// One Guest Cover: a Placeholder's Greeter turn, declined and covered by a guest (by Alex, the Admin).
const placeholderGreeter = state.assignments
  .filter((a) => a.responsibility_id === 'greeter' && (a.member_id === sam || a.member_id === pat))
  .sort((x, y) => eventIndex(x.event_id) - eventIndex(y.event_id))[0];
report('Alex declines a Placeholder Greeter turn for them', !!placeholderGreeter && (await command(A.client, { type: 'decline', assignmentId: placeholderGreeter.id })).ok);
report(
  'Alex records a Guest Cover',
  (await command(A.client, { type: 'markCovered', assignmentId: placeholderGreeter.id, by: { guestName: 'Jordan Blake' } })).ok,
);

// Confirmation states: Alex's next own Sound turn is asked to confirm (Pending), the one after is confirmed.
state = await load();
const alexSound = state.assignments
  .filter((a) => a.responsibility_id === 'sound' && a.member_id === alex && a.cover_kind === null)
  .sort((x, y) => eventIndex(x.event_id) - eventIndex(y.event_id));
report('asks Alex to confirm a Sound turn', !!alexSound[0] && (await command(A.client, { type: 'requestConfirmation', assignmentIds: [alexSound[0].id] })).ok);
report('Alex confirms a later Sound turn', !!alexSound[1] && (await command(A.client, { type: 'confirm', assignmentId: alexSound[1].id })).ok);

const history = await A.client.from('schedule_history').select('id').eq('group_id', groupId);
report('schedule history is readable', !history.error && (history.data?.length ?? 0) >= 10);
const embedded = await A.client.from('events').select('id, assignments(id)').eq('group_id', groupId).limit(1);
report('Events embed their Assignments under RLS', !embedded.error && Array.isArray(embedded.data?.[0]?.assignments));

if (sessionFile) {
  writeFileSync(
    sessionFile,
    JSON.stringify({
      storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
      session: A.session,
      groupId,
      coveredAssignmentId: bensSound?.id,
      guestCoverAssignmentId: placeholderGreeter?.id,
    }),
  );
  report('saved the viewer session for screenshots', true);
}
console.log(failures === 0 ? 'All steps ok' : `${failures} step(s) failed`);
process.exit(failures === 0 ? 0 : 1);
