// Live end-to-end check of group setup (ticket 07) against the hosted Supabase project:
// Responsibilities, Placeholders, a repeating Event Series expanded on the server at local
// time across a daylight-saving change, and a headcount change. Uses only the publishable
// key from .env and a new guest account. Prints step names and ok flags only.
//
//   node --env-file=.env scripts/smoke-setup.mjs
//
// It leaves its data behind: a Group named "Smoke Test 07 <timestamp>".
import { createClient } from '@supabase/supabase-js';

import { expandSeries, localDate, localTime } from '../src/schedule/expandSeries.ts';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (run with --env-file=.env)');
  process.exit(1);
}

const ZONE = 'America/Chicago';
let failures = 0;
function report(step, ok) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}`);
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
{
  const { error } = await client.auth.signInAnonymously({ options: { data: { display_name: 'Smoke Admin' } } });
  report('guest signs in', !error);
  if (error) process.exit(1);
}

async function call(body) {
  const { data, error } = await client.functions.invoke('group-command', { body });
  if (data) return data;
  try {
    return await error.context.json();
  } catch {
    return { ok: false, reason: 'serverError' };
  }
}

const groupName = `Smoke Test 07 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const created = await call({ action: 'createGroup', name: groupName, memberName: 'Smoke Admin', timeZone: ZONE });
report(`creates "${groupName}"`, created.ok);
if (!created.ok) process.exit(1);
const { groupId } = created;
const command = (c) => call({ action: 'command', groupId, command: c });

report(
  'adds Responsibility Sound (headcount 1)',
  (await command({ type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true } })).ok,
);
report(
  'adds Responsibility Greeter (headcount 2)',
  (await command({ type: 'addResponsibility', responsibility: { id: 'greeter', name: 'Greeter', headcount: 2, requiresConfirmation: false } })).ok,
);

for (const name of ['Pat', 'Sam', 'Lee', 'Kim']) {
  report(`adds Placeholder ${name}`, (await command({ type: 'addMember', member: { name } })).ok);
}

async function load() {
  const [members, events, assignments, rotations] = await Promise.all([
    client.from('members').select('id, display_name, account_id').eq('group_id', groupId),
    client.from('events').select('id, series_id, starts_at').eq('group_id', groupId).order('starts_at'),
    client.from('assignments').select('id, event_id, responsibility_id, member_id').eq('group_id', groupId),
    client.from('rotations').select('responsibility_id, queue').eq('group_id', groupId),
  ]);
  return { members: members.data ?? [], events: events.data ?? [], assignments: assignments.data ?? [], rotations: rotations.data ?? [] };
}

let state = await load();
const placeholders = state.members.filter((m) => m.account_id === null);
let qualifiedOk = placeholders.length === 4;
for (const m of placeholders) {
  for (const responsibilityId of ['sound', 'greeter']) {
    qualifiedOk = (await command({ type: 'qualifyMember', memberId: m.id, responsibilityId })).ok && qualifiedOk;
  }
}
state = await load();
report(
  'qualifies the Placeholders for Sound and Greeter (queues in order)',
  qualifiedOk && state.rotations.every((r) => r.queue.length === 4 && r.queue.every((id, i) => id === placeholders[i].id)),
);

const today = localDate(new Date().toISOString(), ZONE);
const repeat = {
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0],
  weekOfMonth: null,
  startTime: '10:00',
  timeZone: ZONE,
  startsOn: today,
};
const added = await command({
  type: 'addEventSeries',
  series: { id: 'sun', name: 'Sunday mornings', responsibilityIds: ['sound', 'greeter'], repeat },
});
report('adds a weekly Sunday 10:00 America/Chicago Event Series', added.ok);
state = await load();

const sundayEvents = () => state.events.filter((e) => e.series_id === 'sun');
const allTenLocal = (events) => events.every((e) => localTime(e.starts_at, ZONE) === '10:00');
const allSundays = (events) => events.every((e) => new Date(`${localDate(e.starts_at, ZONE)}T12:00:00Z`).getUTCDay() === 0);
const filled = (events, sound, greeter) =>
  events.every(
    (e) =>
      state.assignments.filter((a) => a.event_id === e.id && a.responsibility_id === 'sound' && a.member_id).length === sound &&
      state.assignments.filter((a) => a.event_id === e.id && a.responsibility_id === 'greeter' && a.member_id).length === greeter,
  );

report('server created about 12 weeks of Events (11-13) in the same request', sundayEvents().length >= 11 && sundayEvents().length <= 13);
report('every Event is a Sunday at 10:00 local time', allTenLocal(sundayEvents()) && allSundays(sundayEvents()));
report('every Event is filled: 1 Sound and 2 Greeters', filled(sundayEvents(), 1, 2));

// The next Chicago DST change (2nd Sunday of March) lies beyond today's 12-week horizon. Add
// the Events the daily horizon job will add as the weeks pass (same expansion function), up to
// two weeks after the change, and check both sides.
const dstChange = (() => {
  for (let y = Number(today.slice(0, 4)); ; y++) {
    const march = new Date(Date.UTC(y, 2, 1));
    const secondSunday = 1 + ((7 - march.getUTCDay()) % 7) + 7;
    const date = `${y}-03-${String(secondSunday).padStart(2, '0')}`;
    if (date > today) return date;
  }
})();
const until = new Date(Date.parse(`${dstChange}T23:00:00Z`) + 14 * 86_400_000).toISOString();
const extension = expandSeries({
  seriesId: 'sun',
  pattern: repeat,
  existing: state.events.map((e) => ({ id: e.id, seriesId: e.series_id, startsAt: e.starts_at })),
  now: new Date().toISOString(),
  until,
});
const extended = await command({ type: 'addEvents', events: extension });
report('extends the series past the next DST change', extended.ok && extension.length > 0);
state = await load();
const before = sundayEvents().filter((e) => localDate(e.starts_at, ZONE) < dstChange);
const after = sundayEvents().filter((e) => localDate(e.starts_at, ZONE) >= dstChange);
const offsetHours = (e) => Math.round((Date.parse(`${localDate(e.starts_at, ZONE)}T${localTime(e.starts_at, ZONE)}:00Z`) - Date.parse(e.starts_at)) / 3_600_000);
report('Events before the change are at 10:00 local (UTC-6)', before.length > 0 && allTenLocal(before) && before.every((e) => offsetHours(e) === -6));
report('Events after the change are at 10:00 local (UTC-5)', after.length >= 2 && allTenLocal(after) && after.every((e) => offsetHours(e) === -5));
report('Events on both sides of the change are filled', filled(sundayEvents(), 1, 2));
report('no duplicate Events', new Set(sundayEvents().map((e) => e.starts_at)).size === sundayEvents().length);

// Headcount changes reconcile the upcoming seats.
const greeterDown = await command({ type: 'editResponsibility', responsibilityId: 'greeter', changes: { headcount: 1 } });
const soundUp = await command({ type: 'editResponsibility', responsibilityId: 'sound', changes: { headcount: 2 } });
state = await load();
report('changes headcount: Greeter 2 -> 1, Sound 1 -> 2', greeterDown.ok && soundUp.ok);
report('every upcoming Event now has 2 Sound and 1 Greeter', filled(sundayEvents(), 2, 1));
report(
  'the change was reported per Assignment (seats removed and added)',
  greeterDown.ok && soundUp.ok && greeterDown.changes.some((c) => c.after === null) && soundUp.changes.some((c) => c.before === null),
);
report('nobody holds two seats at one Event', sundayEvents().every((e) => {
  const ids = state.assignments.filter((a) => a.event_id === e.id && a.member_id).map((a) => a.member_id);
  return new Set(ids).size === ids.length;
}));

// Editing the time moves the upcoming Events (replaceFutureEvents on the server).
const moved = await command({ type: 'editEventSeries', seriesId: 'sun', changes: { repeat: { ...repeat, startTime: '11:30' } } });
state = await load();
report('edits the series time to 11:30: Events move and stay filled', moved.ok && sundayEvents().every((e) => localTime(e.starts_at, ZONE) === '11:30') && filled(sundayEvents(), 2, 1));

console.log(failures === 0 ? 'All steps passed.' : `${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
