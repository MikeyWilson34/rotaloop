/**
 * The 3-screen group setup (simplify ticket 03): name, "What needs doing, and when?", "Who's in?".
 * A Job is one thing to the person setting up (name + when + type). Here it becomes the existing
 * engine shapes: one Responsibility and one Event Series per Job, with the old setup questions
 * answered by defaults (everyone does every Job, join-order rotation, one person per turn, no
 * confirmation step). Pure: unit-tested under Node.
 */
import type { GroupSettings, NewEvent, NewEventSeries, NewResponsibility, RepeatPattern } from '../engine';
import type { ClientCommand, GroupCommandRequest } from '../db/protocol';
import { dayNumber, dateOf, isValidTimeZone, seriesEventId, weekdayOf, zonedTimeToInstant } from '../schedule/expandSeries';
import { NAME_MAX, newId, todayIn, WEEKDAY_LONG } from './groupSetup';

/** How often a Job happens. `nth` is 1-4, or -1 for the last, of the month (monthly only). */
export type RepeatKind = 'week' | '2week' | 'month' | 'once';
export type JobRepeat = { kind: RepeatKind; weekday: number; nth: number; /** One-off date, "YYYY-MM-DD". */ date: string };

/**
 * - `turns`: one person each time, rotating fairly.
 * - `headcount`: everyone is asked "Coming?" before each date (no rotation).
 */
export type JobType = 'turns' | 'headcount';

export type JobDraft = {
  name: string;
  repeat: JobRepeat;
  /** "HH:MM", 24-hour. */
  time: string;
  type: JobType;
};

export const DEFAULT_JOB_TIME = '10:00';

/** A blank Job row: every Sunday at 10:00am, take turns. A one-off date starts a week out. */
export function newJobDraft(today: string): JobDraft {
  return {
    name: '',
    repeat: { kind: 'week', weekday: 0, nth: 1, date: dateOf(dayNumber(today) + 7) },
    time: DEFAULT_JOB_TIME,
    type: 'turns',
  };
}

export const REPEAT_KIND_OPTIONS: readonly { value: RepeatKind; label: string }[] = [
  { value: 'week', label: 'Every week' },
  { value: '2week', label: 'Every 2 weeks' },
  { value: 'month', label: 'Once a month' },
  { value: 'once', label: 'Just once' },
];

export const NTH_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

export const JOB_TYPE_OPTIONS: readonly { value: JobType; label: string; hint: string }[] = [
  { value: 'turns', label: 'Take turns', hint: 'One person each time, rotating fairly.' },
  { value: 'headcount', label: 'Headcount', hint: 'Everyone gets asked "Coming?" before each date.' },
];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Dec 6" for "2026-12-06". */
function monthDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

/** The "when" in the sentence row: "every Sunday", "every other Sunday", "1st Sunday monthly", "once, Dec 6". */
export function repeatText(r: JobRepeat): string {
  const day = WEEKDAY_LONG[r.weekday];
  switch (r.kind) {
    case 'week':
      return `every ${day}`;
    case '2week':
      return `every other ${day}`;
    case 'month':
      return `${(NTH_OPTIONS.find((o) => o.value === r.nth)?.label ?? '1st').toLowerCase()} ${day} monthly`;
    case 'once':
      return `once, ${monthDay(r.date)}`;
  }
}

/** "10:00" → "10:00am", "18:30" → "6:30pm" (the sentence row's style). */
export function jobTimeText(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

/** The time picker's parts: hour 1-12, minute "00"/"15"/"30"/"45", am/pm. */
export type TimeParts = { hour: number; minute: string; ampm: 'am' | 'pm' };
export const TIME_MINUTES = ['00', '15', '30', '45'] as const;

export function timeParts(hhmm: string): TimeParts {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h % 12 || 12, minute: String(m).padStart(2, '0'), ampm: h >= 12 ? 'pm' : 'am' };
}

export function timeFromParts(p: TimeParts): string {
  const hour = (p.hour % 12) + (p.ampm === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${p.minute}`;
}

/** Rows with a name are the Jobs; blank rows are ignored. */
export function namedJobs(jobs: JobDraft[]): JobDraft[] {
  return jobs.filter((j) => j.name.trim() !== '');
}

export type JobsCheck = { ok: true } | { ok: false; message: string };

/** Step 2 can go on when at least one Job is named, names are unique and short, and one-offs are in the future. */
export function checkJobs(jobs: JobDraft[], timeZone: string, now: Date): JobsCheck {
  const named = namedJobs(jobs);
  if (named.length === 0) return { ok: false, message: 'Name at least one job, like Greeter or Coffee.' };
  const seen = new Set<string>();
  for (const job of named) {
    const name = job.name.trim();
    if (name.length > NAME_MAX) return { ok: false, message: `Keep job names under ${NAME_MAX} characters.` };
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, message: `There are two jobs called ${name}. Give each its own name.` };
    seen.add(key);
    if (job.repeat.kind === 'once' && Date.parse(oneOffInstant(job, timeZone)) <= now.getTime()) {
      return { ok: false, message: `${name} is set for a time that has passed. Pick a later date.` };
    }
  }
  return { ok: true };
}

function zoneOrUtc(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

function oneOffInstant(job: JobDraft, timeZone: string): string {
  return zonedTimeToInstant(job.repeat.date, job.time, zoneOrUtc(timeZone));
}

/** The engine's repeat pattern for a repeating Job (null for a one-off). */
export function jobPattern(job: JobDraft, timeZone: string, today: string): RepeatPattern | null {
  const base = { daysOfWeek: [job.repeat.weekday], startTime: job.time, timeZone: zoneOrUtc(timeZone), intervalWeeks: null };
  switch (job.repeat.kind) {
    case 'week':
      return { ...base, frequency: 'weekly', weekOfMonth: null, startsOn: today };
    case '2week':
      // Counts from the first matching day on or after today, so that day is the first date.
      return { ...base, frequency: 'biweekly', weekOfMonth: null, startsOn: firstOnOrAfter(today, job.repeat.weekday) };
    case 'month':
      return { ...base, frequency: 'monthly', weekOfMonth: job.repeat.nth, startsOn: today };
    case 'once':
      return null;
  }
}

function firstOnOrAfter(date: string, weekday: number): string {
  const day = dayNumber(date);
  return dateOf(day + ((weekday - weekdayOf(day) + 7) % 7));
}

/**
 * The defaults that replace the old setup questions (spec "Defaults replacing setup
 * questions"). A cover is always a swap (Pay It Back); dates off are routed around; when
 * nobody volunteers, the Admins see "Needs cover".
 */
export const SIMPLE_GROUP_SETTINGS: GroupSettings = {
  coveragePolicy: 'payItBack',
  timeOffHandling: 'routeAround',
  allowDoubling: false,
  replacementDuty: 'admins',
  replacementDeadlineMs: 3 * 24 * 60 * 60 * 1000,
};

export type CreateGroupInput = {
  name: string;
  /** The creator's name in the Group. */
  memberName: string;
  timeZone: string;
  jobs: JobDraft[];
  now: Date;
  random?: () => number;
};

/** The `createGroup` request for the setup: one Responsibility and one Event Series per named Job. */
export function createGroupRequest(input: CreateGroupInput): Extract<GroupCommandRequest, { action: 'createGroup' }> {
  const timeZone = zoneOrUtc(input.timeZone);
  const today = todayIn(timeZone, input.now);
  const taken: string[] = [];
  const responsibilities: NewResponsibility[] = [];
  const eventSeries: NewEventSeries[] = [];
  const events: NewEvent[] = [];
  for (const job of namedJobs(input.jobs)) {
    const name = job.name.trim();
    const rId = newId('r', taken, input.random);
    taken.push(rId);
    const sId = newId('s', taken, input.random);
    taken.push(sId);
    // Headcount Jobs are created as take-turns Jobs for now: the data model has no Job type
    // yet. See .scratch/simplify/issues/09-headcount-jobs.md.
    responsibilities.push({ id: rId, name, headcount: 1, requiresConfirmation: false });
    const repeat = jobPattern(job, timeZone, today);
    eventSeries.push({ id: sId, name, responsibilityIds: [rId], repeat });
    if (!repeat) {
      const startsAt = oneOffInstant(job, timeZone);
      events.push({ id: seriesEventId(sId, startsAt), seriesId: sId, startsAt });
    }
  }
  return {
    action: 'createGroup',
    name: input.name.trim(),
    memberName: input.memberName.trim() || 'Admin',
    timeZone,
    settings: SIMPLE_GROUP_SETTINGS,
    primaryResponsibilityId: null,
    responsibilities,
    eventSeries,
    events,
    // Everyone does every Job, starting with the person setting it up.
    creatorQualifiedFor: responsibilities.map((r) => r.id),
  };
}

/**
 * "Who's in?": each typed name becomes a Placeholder Member (a stand-in, not on the app yet)
 * who does every Job, after the creator in join order. They can claim their spot later.
 */
export function placeholderCommands(
  people: string[],
  responsibilityIds: string[],
): Extract<ClientCommand, { type: 'addMember' }>[] {
  return people.map((name) => ({ type: 'addMember', member: { name }, qualifiedFor: [...responsibilityIds] }));
}

/** Adds a typed name to "Who's in?": trimmed, not blank, not a repeat. Returns the new list, or an error. */
export function addPersonName(
  people: string[],
  typed: string,
  creatorName: string,
): { ok: true; people: string[] } | { ok: false; message: string } {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Type a name first.' };
  if (name.length > NAME_MAX) return { ok: false, message: `Keep names under ${NAME_MAX} characters.` };
  const key = name.toLowerCase();
  if (creatorName.trim().toLowerCase() === key) return { ok: false, message: "That's you. You're already in." };
  const existing = people.find((p) => p.toLowerCase() === key);
  if (existing) return { ok: false, message: `${existing} is already on the list.` };
  return { ok: true, people: [...people, name] };
}
