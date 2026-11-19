/**
 * The Time Off screen's logic: turning picked days into engine Time Off for each Group, the
 * preview of what saving would change (the engine's `addTimeOff` run on the loaded state,
 * nothing saved), the "Your Time Off" list, and the calendar marks.
 *
 * Time Off is per Member per Group in the engine. The screen shows one combined list but
 * writes to every Group the person belongs to (filtered by "Applies to"). One save shares one
 * batch id across Groups: each Time Off id is `<batch>-r<run>` (or `<batch>-r<run>m<month>`
 * for "Every month"), so the list can show and remove a save as one item.
 *
 * Repeats:
 * - Every week / every other week: one engine Time Off per run of days with
 *   `repeatEveryWeeks` 1 or 2 and the Group's `timeZone`, so it keeps its local days and times
 *   across daylight-saving changes. It repeats until removed.
 * - Every month: the engine only repeats by whole weeks, so each run becomes
 *   MONTHLY_OCCURRENCES separate, non-repeating Time Off entries (the same day of the month,
 *   or the month's last day when it has fewer days), about a year ahead.
 *
 * Pure TypeScript (engine imports only), so it is unit-tested under Node.
 */
import { applyCommand } from '../engine/commands';
import type { Assignment, GroupState, Instant, MemberId, NewTimeOff, TimeOff } from '../engine/types';
import { zonedTimeToInstant } from './expandSeries';
import { addDays, dateIn, daysBetween, formatDayShort, formatMonthDay, safeZone } from './format';

export type RepeatChoice = 'none' | 'weekly' | 'biweekly' | 'monthly';

export const REPEAT_OPTIONS: readonly { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Doesn’t repeat' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every other week' },
  { value: 'monthly', label: 'Every month' },
];

/** How many months ahead "Every month" is written (separate Time Off entries). */
export const MONTHLY_OCCURRENCES = 12;

/** One of the person's Groups with its full engine state. */
export type TimeOffGroup = {
  id: string;
  name: string;
  timeZone: string;
  state: GroupState;
  myMemberId: MemberId;
};

/** "all", or the names of the Responsibilities it applies to (across the person's Groups). */
export type TimeOffScope = 'all' | string[];

export type TimeOffDraft = {
  /** Picked civil dates, "YYYY-MM-DD", sorted. */
  dates: string[];
  repeat: RepeatChoice;
  scope: TimeOffScope;
  note: string;
};

// ---------------------------------------------------------------------------
// Picking days

/** Adds or removes one day (Single days mode). */
export function toggleDate(dates: string[], date: string): string[] {
  return dates.includes(date) ? dates.filter((d) => d !== date) : [...dates, date].sort();
}

/** Every day from `a` to `b` inclusive, in order, whichever comes first (Date range mode). */
export function rangeDates(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type DateRun = { from: string; to: string };

/** Picked days as runs of consecutive days. */
export function dateRuns(dates: string[]): DateRun[] {
  const sorted = [...new Set(dates)].sort();
  const runs: DateRun[] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.to, 1) === d) last.to = d;
    else runs.push({ from: d, to: d });
  }
  return runs;
}

/** The same day of the month `n` months later, or that month's last day. */
export function addMonthsClamped(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// "Applies to"

/** Names of the active Responsibilities the person is Qualified for, across their Groups. */
export function myResponsibilityNames(groups: TimeOffGroup[]): string[] {
  const names: string[] = [];
  for (const g of groups) {
    for (const r of g.state.responsibilities) {
      if (r.removedAt !== null) continue;
      const queue = g.state.rotations.find((x) => x.responsibilityId === r.id)?.queue ?? [];
      if (queue.includes(g.myMemberId) && !names.some((n) => same(n, r.name))) names.push(r.name);
    }
  }
  return names;
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

/**
 * The Responsibility ids for this Group: null for all of them, or the ids whose names were
 * picked. `undefined` when none of the picked Responsibilities is in this Group (it gets no
 * Time Off).
 */
export function scopedResponsibilityIds(group: TimeOffGroup, scope: TimeOffScope): string[] | null | undefined {
  if (scope === 'all') return null;
  const ids = group.state.responsibilities
    .filter((r) => r.removedAt === null && scope.some((name) => same(name, r.name)))
    .map((r) => r.id);
  return ids.length ? ids : undefined;
}

/** Toggles a chip: "All Responsibilities" clears the rest; the last one off goes back to all. */
export function toggleScope(scope: TimeOffScope, chip: 'all' | string): TimeOffScope {
  if (chip === 'all') return 'all';
  const current = scope === 'all' ? [] : scope;
  const next = current.some((n) => same(n, chip)) ? current.filter((n) => !same(n, chip)) : [...current, chip];
  return next.length ? next : 'all';
}

// ---------------------------------------------------------------------------
// Draft -> engine Time Off

/** A fresh batch id, e.g. "to7k2m9q4x". */
export function newBatchId(random: () => number = Math.random): string {
  let s = '';
  while (s.length < 8) s += Math.floor(random() * 36).toString(36);
  return `to${s}`;
}

/** The engine Time Off entries for one Group (empty when "Applies to" leaves it out). */
export function timeOffEntries(draft: TimeOffDraft, group: TimeOffGroup, batchId: string): NewTimeOff[] {
  const responsibilityIds = scopedResponsibilityIds(group, draft.scope);
  if (responsibilityIds === undefined) return [];
  const zone = safeZone(group.timeZone);
  const note = draft.note.trim() || null;
  const at = (date: string) => zonedTimeToInstant(date, '00:00', zone);
  const base = (id: string, from: string, to: string): NewTimeOff => ({
    id,
    memberId: group.myMemberId,
    startsAt: at(from),
    endsAt: at(addDays(to, 1)),
    responsibilityIds,
    note,
  });
  return dateRuns(draft.dates).flatMap((run, i) => {
    const id = `${batchId}-r${i + 1}`;
    if (draft.repeat === 'weekly' || draft.repeat === 'biweekly') {
      return [{ ...base(id, run.from, run.to), repeatEveryWeeks: draft.repeat === 'weekly' ? 1 : 2, timeZone: zone }];
    }
    if (draft.repeat === 'monthly') {
      const length = daysBetween(run.from, run.to);
      return Array.from({ length: MONTHLY_OCCURRENCES }, (_, k) => {
        const from = addMonthsClamped(run.from, k);
        return base(`${id}m${k + 1}`, from, addDays(from, length));
      });
    }
    return [base(id, run.from, run.to)];
  });
}

export type TimeOffPlan = { group: TimeOffGroup; entries: NewTimeOff[] }[];

/** What a save writes: each Group "Applies to" reaches, with its entries. */
export function timeOffPlan(draft: TimeOffDraft, groups: TimeOffGroup[], batchId: string): TimeOffPlan {
  if (draft.dates.length === 0) return [];
  return groups
    .map((group) => ({ group, entries: timeOffEntries(draft, group, batchId) }))
    .filter((p) => p.entries.length > 0);
}

/** "Save 3 days", "Save 1 day", "Save" (button label). */
export function saveLabel(draft: TimeOffDraft): string {
  const n = draft.dates.length;
  if (n === 0) return 'Save';
  return `Save ${n} ${n === 1 ? 'day' : 'days'}`;
}

// ---------------------------------------------------------------------------
// Preview

export type PreviewLine = {
  key: string;
  groupId: string;
  groupName: string;
  startsAt: Instant;
  /** "Sound, Sun, Dec 7". */
  title: string;
  /** "Ben takes it, and you take Ben's turn on Dec 21." */
  text: string;
  kind: 'route' | 'coverage' | 'other';
};

export type TimeOffPreview = {
  lines: PreviewLine[];
  /** Other people whose Assignments change. */
  othersAffected: number;
  /** Groups where the engine refused the Time Off (reason codes for groupCommandMessage). */
  refused: { groupId: string; groupName: string; reason: string }[];
};

/** Runs the entries on a copy of the Group's state. */
export function applyEntries(
  group: TimeOffGroup,
  entries: NewTimeOff[],
  now: Instant,
): { ok: true; state: GroupState } | { ok: false; reason: string } {
  let state = group.state;
  for (const timeOff of entries) {
    const result = applyCommand(state, { type: 'addTimeOff', timeOff }, { now, actorId: group.myMemberId });
    if (!result.ok) return { ok: false, reason: result.reason };
    state = result.state;
  }
  return { ok: true, state };
}

function memberName(state: GroupState, id: MemberId | null): string {
  return (id && state.members.find((m) => m.id === id)?.name) || 'Someone';
}

/** The net change of each Assignment between two states. */
function netChanges(before: GroupState, after: GroupState): { before: Assignment | null; after: Assignment | null }[] {
  const ids = new Set([...before.assignments, ...after.assignments].map((a) => a.id));
  const out: { before: Assignment | null; after: Assignment | null }[] = [];
  for (const id of ids) {
    const b = before.assignments.find((a) => a.id === id) ?? null;
    const a = after.assignments.find((x) => x.id === id) ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ before: b, after: a });
  }
  return out;
}

/** What saving would change for the person, per affected Assignment of theirs. */
export function timeOffPreview(plan: TimeOffPlan, now: Instant, viewerTimeZone: string): TimeOffPreview {
  const lines: PreviewLine[] = [];
  const refused: TimeOffPreview['refused'] = [];
  const others = new Set<string>();
  for (const { group, entries } of plan) {
    const applied = applyEntries(group, entries, now);
    if (!applied.ok) {
      refused.push({ groupId: group.id, groupName: group.name, reason: applied.reason });
      continue;
    }
    const me = group.myMemberId;
    const before = group.state;
    const after = applied.state;
    const changes = netChanges(before, after);
    for (const c of changes) {
      for (const m of [c.before?.memberId, c.after?.memberId]) if (m && m !== me) others.add(`${group.id}/${m}`);
    }
    const eventOf = (state: GroupState, id: string) => state.events.find((e) => e.id === id);
    const dateOf = (state: GroupState, id: string) => {
      const e = eventOf(state, id);
      return e ? dateIn(e.startsAt, viewerTimeZone) : null;
    };
    for (const c of changes) {
      const was = c.before;
      if (!was || was.memberId !== me || was.coverageRequest) continue;
      const same =
        c.after && c.after.eventId === was.eventId && c.after.memberId === was.memberId && !c.after.coverageRequest;
      if (same) continue;
      const event = eventOf(before, was.eventId);
      if (!event) continue;
      const responsibility = before.responsibilities.find((r) => r.id === was.responsibilityId)?.name ?? 'Job';
      const title = `${responsibility}, ${formatDayShort(dateIn(event.startsAt, viewerTimeZone))}`;
      const line = { key: `${group.id}/${was.id}`, groupId: group.id, groupName: group.name, startsAt: event.startsAt, title };
      const now_ = c.after;
      if (now_?.coverageRequest && !now_.coverageRequest.cover) {
        const why =
          group.state.settings.timeOffHandling === 'askVolunteer'
            ? `${group.name} asks for a volunteer`
            : 'no one free to swap with';
        lines.push({ ...line, text: `Becomes a Coverage Request (${why}).`, kind: 'coverage' });
        continue;
      }
      // Who takes the seat at this Event now, and where the person's turn went.
      const partner = changes.find(
        (p) =>
          p.after &&
          p.after.eventId === was.eventId &&
          p.after.responsibilityId === was.responsibilityId &&
          p.after.memberId !== me &&
          p.before?.eventId !== was.eventId,
      );
      const taker = partner?.after?.memberId ? memberName(after, partner.after.memberId) : null;
      const moved = now_ && now_.memberId === me && now_.eventId !== was.eventId ? dateOf(after, now_.eventId) : null;
      let text: string;
      if (taker && moved) {
        const swapped = partner?.before?.eventId === now_?.eventId;
        text = swapped
          ? `${taker} takes it, and you take ${taker}’s turn on ${formatMonthDay(moved)}.`
          : `${taker} takes it, and you move to ${formatMonthDay(moved)}.`;
      } else if (taker) {
        text = `${taker} takes it.`;
      } else if (moved) {
        text = `You move to ${formatMonthDay(moved)}.`;
      } else if (!now_) {
        text = 'You’re no longer scheduled.';
      } else {
        text = 'Your turn changes.';
      }
      lines.push({ ...line, text, kind: taker || moved ? 'route' : 'other' });
    }
  }
  lines.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key));
  return { lines, othersAffected: others.size, refused };
}

/** The toast after saving. */
export function savedToast(preview: TimeOffPreview): string {
  const routed = preview.lines.filter((l) => l.kind !== 'coverage').length;
  const requests = preview.lines.length - routed;
  if (routed === 0 && requests === 0) return 'Dates off saved. We’ll schedule around it.';
  const parts: string[] = [];
  if (routed) parts.push(`Routed around ${routed} ${routed === 1 ? 'Assignment' : 'Assignments'}`);
  if (requests) parts.push(`${requests} ${requests === 1 ? 'Coverage Request' : 'Coverage Requests'} sent`);
  return `Dates off saved. ${parts.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// "Your Time Off"

/** The batch a Time Off id belongs to: "to7k2m9q4x-r2m3" → "to7k2m9q4x". Other ids are their own batch. */
export function batchOf(timeOffId: string): string {
  const m = /^(.+)-r\d+(?:m\d+)?$/.exec(timeOffId);
  return m ? m[1] : timeOffId;
}

const isMonthly = (id: string) => /-r\d+m\d+$/.test(id);

function isCurrent(t: TimeOff, now: Instant): boolean {
  if (t.removedAt !== null) return false;
  if (t.repeatEveryWeeks) return t.repeatUntil === null || Date.parse(t.repeatUntil) > Date.parse(now);
  return Date.parse(t.endsAt) > Date.parse(now);
}

export type TimeOffItem = {
  key: string;
  /** "Sun, Dec 7", "Dec 7 – Dec 13", "3 days from Dec 7", plus ", repeats weekly" etc. */
  label: string;
  /** "All Responsibilities · Family trip". */
  detail: string;
  /** Every engine Time Off of this save, in every Group. */
  entries: { groupId: string; timeOffId: string }[];
  firstStartsAt: Instant;
};

/** The person's own run of days for one Time Off, in its zone. */
function runOf(t: TimeOff, zone: string): DateRun {
  return { from: dateIn(t.startsAt, zone), to: dateIn(new Date(Date.parse(t.endsAt) - 1).toISOString(), zone) };
}

/** The person's current Time Off across their Groups, one item per save. */
export function timeOffItems(groups: TimeOffGroup[], now: Instant): TimeOffItem[] {
  const batches = new Map<string, { group: TimeOffGroup; timeOff: TimeOff }[]>();
  for (const group of groups) {
    for (const t of group.state.timeOff) {
      if (t.memberId !== group.myMemberId || !isCurrent(t, now)) continue;
      const key = batchOf(t.id);
      const list = batches.get(key);
      if (list) list.push({ group, timeOff: t });
      else batches.set(key, [{ group, timeOff: t }]);
    }
  }
  const items: TimeOffItem[] = [];
  for (const [key, all] of batches) {
    const first = all[0].group.id;
    const own = all.filter((x) => x.group.id === first).sort((a, b) => Date.parse(a.timeOff.startsAt) - Date.parse(b.timeOff.startsAt));
    const monthly = own.some((x) => isMonthly(x.timeOff.id));
    const sample = own[0].timeOff;
    const zone = safeZone(sample.timeZone ?? own[0].group.timeZone);
    const runs = own
      .filter((x) => !monthly || /m1$/.test(x.timeOff.id) || !isMonthly(x.timeOff.id))
      .map((x) => runOf(x.timeOff, zone));
    const shownRuns = runs.length ? runs : [runOf(sample, zone)];
    const days = shownRuns.reduce((n, r) => n + daysBetween(r.from, r.to) + 1, 0);
    let label: string;
    if (shownRuns.length === 1) {
      const r = shownRuns[0];
      label = r.from === r.to ? formatDayShort(r.from) : `${formatMonthDay(r.from)} – ${formatMonthDay(r.to)}`;
    } else {
      label = `${days} days from ${formatMonthDay(shownRuns[0].from)}`;
    }
    const weeks = sample.repeatEveryWeeks;
    if (weeks === 1) label += ', repeats weekly';
    else if (weeks === 2) label += ', every other week';
    else if (weeks) label += `, every ${weeks} weeks`;
    else if (monthly) label += ', monthly';
    const scopeNames = [
      ...new Set(
        all.flatMap(({ group, timeOff }) =>
          timeOff.responsibilityIds === null
            ? []
            : timeOff.responsibilityIds.map((id) => group.state.responsibilities.find((r) => r.id === id)?.name ?? ''),
        ),
      ),
    ].filter(Boolean);
    const allScope = all.some((x) => x.timeOff.responsibilityIds === null);
    const groupNames = [...new Set(all.map((x) => x.group.name))];
    const detail = [
      allScope || scopeNames.length === 0 ? 'All jobs' : scopeNames.join(', '),
      groups.length > 1 ? groupNames.join(', ') : '',
      sample.note ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    items.push({
      key,
      label,
      detail,
      entries: all.map((x) => ({ groupId: x.group.id, timeOffId: x.timeOff.id })),
      firstStartsAt: own[0].timeOff.startsAt,
    });
  }
  return items.sort((a, b) => Date.parse(a.firstStartsAt) - Date.parse(b.firstStartsAt) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Calendar marks

/** Days between `from` and `to` (inclusive) that the person's current Time Off covers. */
export function timeOffDates(groups: TimeOffGroup[], from: string, to: string, now: Instant): Set<string> {
  const out = new Set<string>();
  const add = (run: DateRun) => {
    for (let d = run.from < from ? from : run.from; d <= run.to && d <= to; d = addDays(d, 1)) out.add(d);
  };
  for (const group of groups) {
    for (const t of group.state.timeOff) {
      if (t.memberId !== group.myMemberId || !isCurrent(t, now)) continue;
      const zone = safeZone(t.timeZone ?? group.timeZone);
      const run = runOf(t, zone);
      if (!t.repeatEveryWeeks) {
        add(run);
        continue;
      }
      const step = 7 * t.repeatEveryWeeks;
      const until = t.repeatUntil ? dateIn(t.repeatUntil, zone) : to;
      for (let k = 0; ; k++) {
        const start = addDays(run.from, k * step);
        if (start > to || start > until) break;
        add({ from: start, to: addDays(run.to, k * step) });
      }
    }
  }
  return out;
}

/** Days the person serves (their own seats, not open Coverage Requests they asked for). */
export function servingDates(groups: TimeOffGroup[], viewerTimeZone: string, now: Instant): Set<string> {
  const out = new Set<string>();
  const t = Date.parse(now);
  for (const g of groups) {
    for (const a of g.state.assignments) {
      if (a.memberId !== g.myMemberId || (a.coverageRequest && !a.coverageRequest.cover)) continue;
      const e = g.state.events.find((x) => x.id === a.eventId);
      if (e && !e.skipDate && Date.parse(e.startsAt) > t) out.add(dateIn(e.startsAt, viewerTimeZone));
    }
  }
  return out;
}
