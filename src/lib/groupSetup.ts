/**
 * Group setup (ticket 07): the view models, form validation and copy behind the
 * Responsibilities editor, the Event Series editor, one-off Events, Group settings and the
 * guided first-setup checklist. Pure: unit-tested under Node.
 */
import type {
  CoveragePolicy,
  GroupState,
  RepeatFrequency,
  RepeatPattern,
  ReplacementDuty,
  TimeOffHandling,
} from '../engine';
import {
  dayNumber,
  isValidTimeZone,
  localDate,
  nextOccurrences,
  samePattern,
  weekdayOf,
  zonedTimeToInstant,
} from '../schedule/expandSeries';

const DAY_MS = 24 * 60 * 60 * 1000;
export const NAME_MAX = 80;
export const HEADCOUNT_MAX = 50;

// ---------------------------------------------------------------------------
// Small helpers

/** Moves the item at `index` by `delta` places (clamped). Returns a new array. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  if (index < 0 || index >= list.length || to === index) return next;
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/** A short id unique among `taken`, e.g. "r-k3x9q2". */
export function newId(prefix: string, taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${prefix}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!used.has(id)) return id;
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Sound", "Sound and Greeter", "Sound, Greeter and Host". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const activeResponsibilities = (state: GroupState) => state.responsibilities.filter((r) => r.removedAt === null);
const activeSeries = (state: GroupState) => state.eventSeries.filter((s) => s.removedAt === null);
const queueOf = (state: GroupState, responsibilityId: string) =>
  state.rotations.find((r) => r.responsibilityId === responsibilityId)?.queue ?? [];

// ---------------------------------------------------------------------------
// Responsibilities

export type ResponsibilityView = {
  id: string;
  name: string;
  headcount: number;
  requiresConfirmation: boolean;
  isPrimary: boolean;
  qualifiedCount: number;
  /** "2 Qualified Members · 2 per Event · Needs confirmation". */
  summary: string;
};

/** Active Responsibilities in fill order. */
export function responsibilityViews(state: GroupState): ResponsibilityView[] {
  return activeResponsibilities(state).map((r) => {
    const qualifiedCount = queueOf(state, r.id).length;
    const parts = [
      plural(qualifiedCount, 'Qualified Member'),
      `${r.headcount} per Event`,
      r.requiresConfirmation ? 'Needs confirmation' : 'No confirmation',
    ];
    return {
      id: r.id,
      name: r.name,
      headcount: r.headcount,
      requiresConfirmation: r.requiresConfirmation,
      isPrimary: state.primaryResponsibilityId === r.id,
      qualifiedCount,
      summary: parts.join(' · '),
    };
  });
}

export type QueueEntry = { memberId: string; name: string; isPlaceholder: boolean };

/** A Responsibility's Rotation: who's next, in order. */
export function rotationQueue(state: GroupState, responsibilityId: string): QueueEntry[] {
  return queueOf(state, responsibilityId).flatMap((id) => {
    const m = state.members.find((x) => x.id === id);
    return m ? [{ memberId: m.id, name: m.name, isPlaceholder: m.accountId === null }] : [];
  });
}

export type QualificationOption = { memberId: string; name: string; qualified: boolean };

/** Every active Member, by name, with whether they're Qualified for the Responsibility. */
export function qualificationOptions(state: GroupState, responsibilityId: string | null): QualificationOption[] {
  const queue = new Set(responsibilityId ? queueOf(state, responsibilityId) : []);
  return state.members
    .filter((m) => m.leftAt === null)
    .map((m) => ({ memberId: m.id, name: m.name, qualified: queue.has(m.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.memberId.localeCompare(b.memberId));
}

export type ResponsibilityForm = { name: string; headcount: string; requiresConfirmation: boolean };

export type ResponsibilityValue = { name: string; headcount: number; requiresConfirmation: boolean };

export type FormResult<V, K extends string> = { ok: true; value: V } | { ok: false; errors: Partial<Record<K, string>> };

export function validateResponsibilityForm(
  form: ResponsibilityForm,
  otherNames: string[] = [],
): FormResult<ResponsibilityValue, 'name' | 'headcount'> {
  const errors: Partial<Record<'name' | 'headcount', string>> = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Give it a name, like Host or Setup.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;
  else if (otherNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = 'There is already a Responsibility with that name.';
  }
  const headcount = Number(form.headcount.trim());
  if (!/^\d+$/.test(form.headcount.trim()) || headcount < 1 || headcount > HEADCOUNT_MAX) {
    errors.headcount = `Enter how many people each Event needs, from 1 to ${HEADCOUNT_MAX}.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, headcount, requiresConfirmation: form.requiresConfirmation } };
}

/** Only the fields that changed (for `editResponsibility`), or null when nothing did. */
export function responsibilityChanges(
  current: ResponsibilityValue,
  next: ResponsibilityValue,
): Partial<ResponsibilityValue> | null {
  const changes: Partial<ResponsibilityValue> = {};
  if (next.name !== current.name) changes.name = next.name;
  if (next.headcount !== current.headcount) changes.headcount = next.headcount;
  if (next.requiresConfirmation !== current.requiresConfirmation) changes.requiresConfirmation = next.requiresConfirmation;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Outstanding Make-up Turns, for one Responsibility or the whole Group. */
export function outstandingMakeUpTurns(state: GroupState, responsibilityId?: string): number {
  return state.makeUpTurns.filter(
    (t) => t.status === 'outstanding' && (responsibilityId === undefined || t.responsibilityId === responsibilityId),
  ).length;
}

// ---------------------------------------------------------------------------
// Times and dates

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * Reads a time of day typed by a person: "9", "9:30", "9.30", "930", "9am", "9:30 PM",
 * "21:00", "noon", "midnight". Returns "HH:MM" (24-hour), or null.
 */
export function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, ':');
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3]?.[0];
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === 'a') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "09:00" → "9:00 AM", "21:30" → "9:30 PM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Reads "YYYY-MM-DD" (also "YYYY/M/D"). Returns "YYYY-MM-DD", or null when not a real date. */
export function parseDate(text: string): string | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "Sun, Nov 22, 2026" for a local date. */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** Today's date in a time zone. */
export function todayIn(timeZone: string, now: Date): string {
  return localDate(now.toISOString(), isValidTimeZone(timeZone) ? timeZone : 'UTC');
}

// ---------------------------------------------------------------------------
// Event Series

export type SeriesForm = {
  name: string;
  frequency: RepeatFrequency;
  /** Custom only: "every N weeks". */
  intervalWeeks: string;
  daysOfWeek: number[];
  /** Monthly only: 1-4, or -1 for the last. */
  weekOfMonth: number;
  /** As typed, e.g. "9:00 AM". */
  time: string;
  timeZone: string;
  /** As typed, "YYYY-MM-DD". */
  startsOn: string;
  responsibilityIds: string[];
};

export const FREQUENCY_OPTIONS: readonly { value: RepeatFrequency; label: string }[] = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every other week' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Every few weeks' },
];

export const WEEK_OF_MONTH_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

/** A new series: weekly on today's weekday at 9:00 AM in the Group's time zone, using every Responsibility. */
export function newSeriesForm(state: GroupState, groupTimeZone: string, now: Date): SeriesForm {
  const today = todayIn(groupTimeZone, now);
  return {
    name: '',
    frequency: 'weekly',
    intervalWeeks: '3',
    daysOfWeek: [weekdayOf(dayNumber(today))],
    weekOfMonth: 1,
    time: '9:00 AM',
    timeZone: groupTimeZone,
    startsOn: today,
    responsibilityIds: activeResponsibilities(state).map((r) => r.id),
  };
}

/** The form for an existing series. */
export function seriesFormFrom(
  series: { name: string; responsibilityIds: string[]; repeat: RepeatPattern | null },
  state: GroupState,
  groupTimeZone: string,
  now: Date,
): SeriesForm {
  const base = newSeriesForm(state, groupTimeZone, now);
  const p = series.repeat;
  const active = new Set(activeResponsibilities(state).map((r) => r.id));
  return {
    ...base,
    name: series.name,
    responsibilityIds: series.responsibilityIds.filter((id) => active.has(id)),
    ...(p
      ? {
          frequency: p.frequency,
          intervalWeeks: String(p.intervalWeeks ?? 3),
          daysOfWeek: [...p.daysOfWeek].sort((a, b) => a - b),
          weekOfMonth: p.weekOfMonth ?? 1,
          time: formatTime(p.startTime),
          timeZone: p.timeZone,
          startsOn: p.startsOn,
        }
      : {}),
  };
}

export type SeriesField = 'name' | 'days' | 'time' | 'timeZone' | 'startsOn' | 'interval' | 'responsibilities';

export type SeriesValue = { name: string; responsibilityIds: string[]; repeat: RepeatPattern };

/** The repeat pattern the form describes, or null if it isn't complete yet (for the live preview). */
export function patternFromForm(form: SeriesForm): RepeatPattern | null {
  const result = validateSeriesForm({ ...form, name: form.name || 'x', responsibilityIds: ['x'] }, ['x']);
  return result.ok ? result.value.repeat : null;
}

export function validateSeriesForm(
  form: SeriesForm,
  activeResponsibilityIds: string[],
): FormResult<SeriesValue, SeriesField> {
  const errors: Partial<Record<SeriesField, string>> = {};
  const name = form.name.trim();
  if (!name) errors.name = 'Give it a name, like Sunday mornings or Practice.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;

  const days = [...new Set(form.daysOfWeek)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) errors.days = 'Pick at least one day.';

  const startTime = parseTime(form.time);
  if (!startTime) errors.time = 'Enter a time like 9:00 AM or 18:30.';

  if (!isValidTimeZone(form.timeZone)) errors.timeZone = 'Pick a time zone.';

  const startsOn = parseDate(form.startsOn);
  if (!startsOn) errors.startsOn = 'Enter a date like 2026-11-22.';

  let intervalWeeks: number | null = null;
  if (form.frequency === 'custom') {
    const n = Number(form.intervalWeeks.trim());
    if (!/^\d+$/.test(form.intervalWeeks.trim()) || n < 1 || n > 52) errors.interval = 'Enter a number of weeks from 1 to 52.';
    else intervalWeeks = n;
  }
  const weekOfMonth = form.frequency === 'monthly' ? form.weekOfMonth : null;
  if (weekOfMonth !== null && ![1, 2, 3, 4, -1].includes(weekOfMonth)) errors.days = 'Pick which week of the month.';

  const responsibilityIds = form.responsibilityIds.filter((id) => activeResponsibilityIds.includes(id));
  if (responsibilityIds.length === 0) errors.responsibilities = 'Pick at least one Responsibility for these Events.';

  if (Object.keys(errors).length > 0 || !startTime || !startsOn) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      responsibilityIds,
      repeat: {
        frequency: form.frequency,
        intervalWeeks,
        daysOfWeek: days,
        weekOfMonth,
        startTime,
        timeZone: form.timeZone,
        startsOn,
      },
    },
  };
}

/** "Every Sunday at 9:00 AM", "Every other Tue and Thu at 6:30 PM", "Last Sunday of the month at 9:00 AM". */
export function describeRepeat(p: RepeatPattern): string {
  const many = p.daysOfWeek.length > 1;
  const days = andList(p.daysOfWeek.map((d) => (many ? WEEKDAY_SHORT[d] : WEEKDAY_LONG[d])));
  const at = `at ${formatTime(p.startTime)}`;
  switch (p.frequency) {
    case 'weekly':
      return `Every ${days} ${at}`;
    case 'biweekly':
      return `Every other ${days} ${at}`;
    case 'custom':
      return p.intervalWeeks === 1 ? `Every ${days} ${at}` : `Every ${p.intervalWeeks} weeks on ${days} ${at}`;
    case 'monthly': {
      const which = WEEK_OF_MONTH_OPTIONS.find((o) => o.value === p.weekOfMonth)?.label ?? '';
      return `${which} ${days} of the month ${at}`;
    }
  }
}

/** The next few start times of a pattern, from now (or its start date), as instants. */
export function previewInstants(p: RepeatPattern, now: Date, count = 4): string[] {
  return nextOccurrences(p, now.toISOString(), count);
}

export type SeriesView = {
  id: string;
  name: string;
  /** "Every Sunday at 9:00 AM" (plus the zone when it differs from the Group's). */
  description: string;
  responsibilityNames: string[];
};

export function seriesViews(state: GroupState, groupTimeZone: string): SeriesView[] {
  const names = new Map(state.responsibilities.map((r) => [r.id, r.name]));
  return activeSeries(state).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.repeat
      ? describeRepeat(s.repeat) + (s.repeat.timeZone !== groupTimeZone ? ` (${s.repeat.timeZone.replace(/_/g, ' ')})` : '')
      : 'No repeat pattern',
    responsibilityNames: s.responsibilityIds.flatMap((id) => {
      const r = state.responsibilities.find((x) => x.id === id && x.removedAt === null);
      return r ? [names.get(id) ?? id] : [];
    }),
  }));
}

/**
 * What saving an edited series sends: only the changed fields. `movesEvents` is true when
 * the days or time changed, so the upcoming Events are replaced (turns follow them to the
 * new dates and need confirming again).
 */
export function seriesEdit(
  current: { name: string; responsibilityIds: string[]; repeat: RepeatPattern | null },
  next: SeriesValue,
): { changes: { name?: string; responsibilityIds?: string[]; repeat?: RepeatPattern }; movesEvents: boolean } | null {
  const changes: { name?: string; responsibilityIds?: string[]; repeat?: RepeatPattern } = {};
  if (next.name !== current.name) changes.name = next.name;
  const sameResponsibilities =
    next.responsibilityIds.length === current.responsibilityIds.length &&
    next.responsibilityIds.every((id) => current.responsibilityIds.includes(id));
  if (!sameResponsibilities) changes.responsibilityIds = next.responsibilityIds;
  const movesEvents = !samePattern(current.repeat, next.repeat);
  if (movesEvents) changes.repeat = next.repeat;
  return Object.keys(changes).length > 0 ? { changes, movesEvents } : null;
}

// ---------------------------------------------------------------------------
// One-off Events

export type OneOffForm = { date: string; time: string; responsibilityIds: string[] };
export type OneOffValue = { startsAt: string; responsibilityIds: string[] };

export function validateOneOffForm(
  form: OneOffForm,
  timeZone: string,
  now: Date,
  activeResponsibilityIds: string[],
): FormResult<OneOffValue, 'date' | 'time' | 'responsibilities'> {
  const errors: Partial<Record<'date' | 'time' | 'responsibilities', string>> = {};
  const date = parseDate(form.date);
  const time = parseTime(form.time);
  if (!date) errors.date = 'Enter a date like 2026-12-05.';
  if (!time) errors.time = 'Enter a time like 6:30 PM or 18:30.';
  const responsibilityIds = form.responsibilityIds.filter((id) => activeResponsibilityIds.includes(id));
  if (responsibilityIds.length === 0) errors.responsibilities = 'Pick at least one Responsibility.';
  let startsAt: string | null = null;
  if (date && time) {
    startsAt = zonedTimeToInstant(date, time, isValidTimeZone(timeZone) ? timeZone : 'UTC');
    if (Date.parse(startsAt) <= now.getTime()) errors.date = 'That time has already passed. Pick a later date or time.';
  }
  if (Object.keys(errors).length > 0 || !startsAt) return { ok: false, errors };
  return { ok: true, value: { startsAt, responsibilityIds } };
}

export type OneOffView = { id: string; startsAt: string; responsibilityNames: string[] };

/** Upcoming one-off Events, soonest first. */
export function upcomingOneOffEvents(state: GroupState, now: Date): OneOffView[] {
  const names = new Map(state.responsibilities.map((r) => [r.id, r.name]));
  return state.events
    .filter((e) => e.seriesId === null && Date.parse(e.startsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((e) => ({
      id: e.id,
      startsAt: e.startsAt,
      responsibilityNames: (e.responsibilityIds ?? []).map((id) => names.get(id) ?? id),
    }));
}

// ---------------------------------------------------------------------------
// Group settings (wording from the prototype's Group Settings tab)

export type Choice<T extends string> = { value: T; label: string; description: string };

export const COVERAGE_POLICY_CHOICES: readonly Choice<CoveragePolicy>[] = [
  { value: 'payItBack', label: 'Pay It Back', description: 'Whoever declines owes the person who covers a Make-up Turn.' },
  {
    value: 'countRealWork',
    label: 'Count Real Work',
    description: 'Covering counts toward workload; declining creates no debt.',
  },
];

export const REPLACEMENT_DUTY_CHOICES: readonly Choice<ReplacementDuty>[] = [
  {
    value: 'assignedMember',
    label: 'Assigned Member',
    description: 'If nobody volunteers by the alert time, the Member who declined finds a replacement.',
  },
  { value: 'admins', label: 'Admins', description: 'If nobody volunteers by the alert time, the Admins find a replacement.' },
];

export const TIME_OFF_CHOICES: readonly Choice<TimeOffHandling>[] = [
  {
    value: 'routeAround',
    label: 'Route around',
    description: 'The next person in line takes the Event; the absent Member keeps their place at the front.',
  },
  { value: 'askVolunteer', label: 'Ask for a volunteer', description: 'The Assignment becomes a Coverage Request.' },
];

export const DOUBLING_COPY = {
  label: 'Allow the same person twice at one Event',
  off: 'Off: one Assignment per person per Event',
  on: 'On: one person can hold two Responsibilities at the same Event',
};

export const REPLACEMENT_DEADLINE_DAYS = [1, 2, 3, 4, 5, 7, 10, 14] as const;

export function deadlineDays(ms: number): number {
  return Math.round(ms / DAY_MS);
}

export function daysToMs(days: number): number {
  return days * DAY_MS;
}

/** "3 days before", "1 day before", "On the day". */
export function deadlineLabel(ms: number): string {
  const days = deadlineDays(ms);
  return days === 0 ? 'On the day' : `${plural(days, 'day')} before`;
}

export const DEADLINE_CHOICES: readonly Choice<string>[] = REPLACEMENT_DEADLINE_DAYS.map((d) => ({
  value: String(d),
  label: deadlineLabel(daysToMs(d)),
  description: '',
}));

export function choiceLabel<T extends string>(choices: readonly Choice<T>[], value: T): string {
  return choices.find((c) => c.value === value)?.label ?? value;
}

/** The warning shown before switching to Count Real Work. */
export function countRealWorkWarning(state: GroupState): string {
  const n = outstandingMakeUpTurns(state);
  const lost =
    n === 0
      ? 'There are no outstanding Make-up Turns right now.'
      : `The ${plural(n, 'outstanding Make-up Turn')} will be cancelled.`;
  return `Covering will count toward workload and declining creates no debt. ${lost} This is recorded in the schedule history.`;
}

// ---------------------------------------------------------------------------
// Group details

export function validateGroupName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give your group a name.';
  if (trimmed.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  return null;
}

// ---------------------------------------------------------------------------
// Guided first setup

export type ChecklistKey = 'responsibilities' | 'qualified' | 'series' | 'invite';
export type ChecklistItem = { key: ChecklistKey; label: string; description: string; done: boolean };

/**
 * The Overview's first-setup checklist. It shows while the Group has no Responsibilities or
 * no Event Series; once both exist it goes away.
 */
export function setupChecklist(state: GroupState): { show: boolean; items: ChecklistItem[] } {
  const responsibilities = activeResponsibilities(state);
  const hasResponsibilities = responsibilities.length > 0;
  const allQualified = hasResponsibilities && responsibilities.every((r) => queueOf(state, r.id).length > 0);
  const hasSeries = activeSeries(state).length > 0;
  const others = state.members.filter((m) => m.leftAt === null).length > 1;
  return {
    show: !hasResponsibilities || !hasSeries,
    items: [
      {
        key: 'responsibilities',
        label: 'Add Responsibilities',
        description: 'The duties your group shares, like Host or Setup.',
        done: hasResponsibilities,
      },
      {
        key: 'qualified',
        label: "Choose who's Qualified",
        description: 'Pick who can take each Responsibility. They rotate in order.',
        done: allQualified,
      },
      {
        key: 'series',
        label: 'Set when Events happen',
        description: 'For example, every Sunday at 9:00 AM.',
        done: hasSeries,
      },
      {
        key: 'invite',
        label: 'Invite people',
        description: 'Share the invite link, or add people by name for now.',
        done: others,
      },
    ],
  };
}

/** The first Responsibility nobody is Qualified for yet (where "Choose who's Qualified" leads). */
export function firstUnstaffedResponsibility(state: GroupState): string | null {
  const r = activeResponsibilities(state).find((x) => queueOf(state, x.id).length === 0) ?? activeResponsibilities(state)[0];
  return r?.id ?? null;
}
