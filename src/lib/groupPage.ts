/**
 * What the group page and its settings show (simplify ticket 06, prototype `PAGES.group` and
 * `PAGES.settings`): "Coming up" by date with the viewer's own turns marked, swaps and breaks
 * in plain words; the members list with stand-ins; the group's jobs as sentence rows; and the
 * group's dates off. Also the commands that editing a job sends.
 *
 * A Job is one Responsibility with its own Event Series (see groupCreate.ts). Pure TypeScript:
 * no React, Supabase or clock reads, so it is unit-tested under Node.
 */
import type { ClientCommand } from '../db/protocol';
import { planSchedule } from '../engine/schedule';
import { headcountsNeeded } from '../engine/state';
import type { EventSeries, GroupState, HeadcountReply, MemberId, RepeatPattern, Responsibility } from '../engine/types';
import { dateOf, dayNumber, localDate, localTime, seriesEventId, weekdayOf, zonedTimeToInstant } from '../schedule/expandSeries';
import { dateIn } from '../schedule/format';
import { answerOf, headcountCounts, headcountText, type HeadcountCounts } from '../schedule/headcount';
import { eventViews, type ScheduleGroup } from '../schedule/views';
import { jobPattern, jobTimeText, repeatDays, repeatText, type JobDraft, type JobRepeat } from './groupCreate';
import { newId, todayIn } from './groupSetup';

// ---------------------------------------------------------------------------
// People

/** "Sam" for "Sam Lee". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function memberById(state: GroupState, id: MemberId | null) {
  return id === null ? undefined : state.members.find((m) => m.id === id);
}

/** "you" for the viewer, else the first name ("a former member" when unknown). */
function who(state: GroupState, id: MemberId | null, me: MemberId | null): string | null {
  if (id === null) return null;
  if (id === me) return 'you';
  const m = memberById(state, id);
  return m ? firstName(m.name) : 'a former member';
}

// ---------------------------------------------------------------------------
// Coming up

export type TurnPerson =
  | { kind: 'member'; memberId: MemberId; name: string; label: string; isMe: boolean; isStandIn: boolean }
  /** A cover from outside the group: a typed name ("Not in group"). */
  | { kind: 'guest'; name: string; label: string }
  | { kind: 'open' };

export type TurnRow = {
  key: string;
  assignmentId: string;
  eventId: string;
  jobName: string;
  startsAt: string;
  person: TurnPerson;
  /** The viewer does this turn: the row is tinted. */
  mine: boolean;
  /** Nobody has it yet: someone couldn't make it and no one has covered. */
  needsCover: boolean;
  /** Who couldn't make it, when someone covers ("you" or a first name). */
  coveringFor: string | null;
  /** This turn is the other half of a cover: whose turn it was ("you" or a first name). */
  swappedWith: string | null;
  /** Someone rests on this date so they don't serve twice in a row ("you" or a first name). */
  breakFor: string | null;
  /** The person who holds the turn is a stand-in (not on the app): anyone can act for them. */
  standInId: MemberId | null;
  /**
   * Set for a date of a headcount job (ticket 09): there is no turn (`assignmentId` is empty);
   * the row shows "2 coming · 0 not · 3 no reply" and the viewer's own answer.
   */
  headcount?: {
    responsibilityId: string;
    counts: HeadcountCounts;
    /** "2 coming · 0 not · 3 no reply". */
    summary: string;
    answer: HeadcountReply | null;
  };
};

export type ComingUpDay =
  | { kind: 'off'; date: string; key: string }
  | { kind: 'turns'; date: string; key: string; rows: TurnRow[] };

/**
 * The group's upcoming dates (in the viewer's time zone), soonest first. A date where every
 * Event is a group date off is one "off" day; otherwise its turns, in job order.
 */
export function comingUp(group: ScheduleGroup, now: string, viewerTimeZone: string): ComingUpDay[] {
  const { state, myMemberId: me } = group;
  const rests = restsByTurn(state);
  const events = eventViews([group], now, viewerTimeZone);
  const days: ComingUpDay[] = [];
  const byDate = new Map<string, typeof events>();
  for (const e of events) {
    if (Date.parse(e.startsAt) < Date.parse(now) && !e.skipDate) continue; // already started
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }
  for (const [date, list] of byDate) {
    const live = list.filter((e) => !e.skipDate);
    if (live.length === 0) {
      days.push({ kind: 'off', date, key: `off:${date}` });
      continue;
    }
    const rows: TurnRow[] = [];
    for (const event of live) {
      for (const slot of event.slots) {
        const a = state.assignments.find((x) => x.id === slot.assignmentId);
        if (!a) continue;
        const request = a.coverageRequest;
        const cover = request?.cover ?? null;
        const needsCover = request !== null && cover === null;
        let person: TurnPerson = { kind: 'open' };
        if (cover?.kind === 'guest') person = { kind: 'guest', name: cover.guestName, label: firstName(cover.guestName) };
        else if (!needsCover && a.memberId !== null) {
          const m = memberById(state, a.memberId);
          person = {
            kind: 'member',
            memberId: a.memberId,
            name: m?.name ?? 'Former member',
            label: a.memberId === me ? 'You' : firstName(m?.name ?? 'Former member'),
            isMe: a.memberId === me,
            isStandIn: !!m && m.accountId === null,
          };
        }
        const askedBy = request ? (request.requestedBy ?? a.turnOf) : null;
        const makeUp = a.makeUpTurnId ? state.makeUpTurns.find((t) => t.id === a.makeUpTurnId) : undefined;
        const holder = person.kind === 'member' ? person.memberId : null;
        const rested = holder ? rests.get(`${a.eventId}|${a.responsibilityId}|${holder}`) : undefined;
        rows.push({
          key: slot.key,
          assignmentId: a.id,
          eventId: a.eventId,
          jobName: slot.responsibilityName,
          startsAt: event.startsAt,
          person,
          mine: person.kind === 'member' && person.isMe,
          needsCover,
          coveringFor: cover && askedBy !== null && askedBy !== holder ? who(state, askedBy, me) : null,
          swappedWith: makeUp ? who(state, makeUp.creditorId, me) : null,
          breakFor: rested ? who(state, rested, me) : null,
          standInId: person.kind === 'member' && person.isStandIn ? person.memberId : null,
        });
      }
    }
    for (const event of live) {
      const source = state.events.find((e) => e.id === event.eventId);
      if (!source) continue;
      for (const job of headcountsNeeded(state, source)) {
        const counts = headcountCounts(state, event.eventId, job.id);
        rows.push({
          key: `${group.id}/hc:${event.eventId}:${job.id}`,
          assignmentId: '',
          eventId: event.eventId,
          jobName: job.name,
          startsAt: event.startsAt,
          person: { kind: 'open' },
          mine: false,
          needsCover: false,
          coveringFor: null,
          swappedWith: null,
          breakFor: null,
          standInId: null,
          headcount: {
            responsibilityId: job.id,
            counts,
            summary: headcountText(counts),
            answer: answerOf(state, event.eventId, job.id, me),
          },
        });
      }
    }
    days.push({ kind: 'turns', date, key: `turns:${date}`, rows });
  }
  return days;
}

/**
 * Who rests at which turn (`event|job|holder` → the Member resting), replaying the engine's
 * plan. Only turns the plan and the saved schedule agree on get one.
 */
function restsByTurn(state: GroupState): Map<string, MemberId> {
  const out = new Map<string, MemberId>();
  let plan: ReturnType<typeof planSchedule>;
  try {
    plan = planSchedule(state);
  } catch {
    return out;
  }
  for (const seat of plan) {
    if (seat.restedFor && seat.memberId) out.set(`${seat.eventId}|${seat.responsibilityId}|${seat.memberId}`, seat.restedFor);
  }
  return out;
}

/** The small grey line under a job's name: "9:00 AM · covering for Sam · swapped with you · break for Tom". */
export function turnDetails(row: TurnRow, time: string): string[] {
  const parts = [time];
  if (row.headcount) parts.push(row.headcount.summary);
  if (row.coveringFor) parts.push(`covering for ${row.coveringFor}`);
  if (row.breakFor) parts.push(`break for ${row.breakFor}`);
  return parts;
}

// ---------------------------------------------------------------------------
// Members

export type MemberItem = {
  id: MemberId;
  name: string;
  isMe: boolean;
  /** Not on the app: added by name, someone in the group keeps track for them. */
  isStandIn: boolean;
};

/** Active members in join order, the viewer marked. */
export function memberItems(state: GroupState, me: MemberId | null): MemberItem[] {
  return state.members
    .filter((m) => m.leftAt === null)
    .map((m) => ({ id: m.id, name: m.name, isMe: m.id === me, isStandIn: m.accountId === null }));
}

// ---------------------------------------------------------------------------
// Jobs

export type JobView = {
  responsibilityId: string;
  /** The job's own Event Series (null when it has none, e.g. an older group). */
  seriesId: string | null;
  /** The series is this job's alone, so renaming the job renames it too. */
  ownSeries: boolean;
  name: string;
  draft: JobDraft;
  /** "every Sunday · 10:00am". */
  description: string;
};

function activeSeriesFor(state: GroupState, responsibilityId: string): EventSeries | undefined {
  const series = state.eventSeries.filter((s) => s.removedAt === null && s.responsibilityIds.includes(responsibilityId));
  return series.find((s) => s.responsibilityIds.length === 1) ?? series[0];
}

/** The sentence row's "when" for a stored pattern (an older custom pattern reads as weekly). */
export function repeatFromPattern(p: RepeatPattern): Omit<JobRepeat, 'date'> {
  const sorted = [...p.daysOfWeek].sort((a, b) => a - b);
  const weekdays = sorted.length ? sorted : [0];
  const weekday = weekdays[0];
  if (p.frequency === 'monthly') return { kind: 'month', weekday, nth: p.weekOfMonth ?? 1 };
  if (p.frequency === 'biweekly' || (p.frequency === 'custom' && p.intervalWeeks === 2)) {
    return { kind: '2week', weekday, weekdays, nth: 1 };
  }
  return { kind: 'week', weekday, weekdays, nth: 1 };
}

/** The group's jobs in its order, each as the sentence row it is edited with. */
export function jobViews(state: GroupState, groupTimeZone: string, now: Date): JobView[] {
  const today = todayIn(groupTimeZone, now);
  return state.responsibilities
    .filter((r) => r.removedAt === null)
    .map((r) => {
      const series = activeSeriesFor(state, r.id);
      const draft = draftOf(state, r, series, groupTimeZone, today, now);
      return {
        responsibilityId: r.id,
        seriesId: series?.id ?? null,
        ownSeries: !!series && series.responsibilityIds.length === 1,
        name: r.name,
        draft,
        description: `${repeatText(draft.repeat)} · ${jobTimeText(draft.time)}`,
      };
    });
}

function draftOf(
  state: GroupState,
  r: Responsibility,
  series: EventSeries | undefined,
  zone: string,
  today: string,
  now: Date,
): JobDraft {
  const weekAhead = dateOf(dayNumber(today) + 7);
  if (series?.repeat) {
    return {
      name: r.name,
      repeat: { ...repeatFromPattern(series.repeat), date: weekAhead },
      time: series.repeat.startTime,
      type: r.kind,
    };
  }
  // A one-off: its next date (or its last one, when it has passed).
  const events = state.events
    .filter((e) => (series ? e.seriesId === series.id : (e.responsibilityIds ?? []).includes(r.id)))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const event = events.find((e) => Date.parse(e.startsAt) > now.getTime()) ?? events[events.length - 1];
  const date = event ? localDate(event.startsAt, zone) : weekAhead;
  return {
    name: r.name,
    repeat: { kind: 'once', weekday: weekdayOf(dayNumber(date)), nth: 1, date },
    time: event ? localTime(event.startsAt, zone) : '10:00',
    type: r.kind,
  };
}

function sameWhen(a: JobDraft, b: JobDraft): boolean {
  if (a.time !== b.time || a.repeat.kind !== b.repeat.kind) return false;
  if (a.repeat.kind === 'once') return a.repeat.date === b.repeat.date;
  if (repeatDays(a.repeat).join() !== repeatDays(b.repeat).join()) return false;
  return a.repeat.kind !== 'month' || a.repeat.nth === b.repeat.nth;
}

export type JobCheck = { ok: true; name: string } | { ok: false; message: string };

/** A job's name is needed and unique in the group; a one-off must be in the future. */
export function checkJob(state: GroupState, draft: JobDraft, editingId: string | null, timeZone: string, now: Date): JobCheck {
  const name = draft.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Give the job a name, like Greeter or Coffee.' };
  if (name.length > 80) return { ok: false, message: 'Keep job names under 80 characters.' };
  const clash = state.responsibilities.find(
    (r) => r.removedAt === null && r.id !== editingId && r.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return { ok: false, message: `There's already a job called ${clash.name}. Give this one its own name.` };
  if (draft.repeat.kind === 'once' && Date.parse(zonedTimeToInstant(draft.repeat.date, draft.time, timeZone)) <= now.getTime()) {
    return { ok: false, message: 'That date has passed. Pick a later one.' };
  }
  return { ok: true, name };
}

/**
 * The commands saving an edited job sends, in order: its name, then when it happens. A new
 * "when" replaces its upcoming dates (the server lists them for a repeating job).
 */
export function jobEditCommands(
  state: GroupState,
  job: JobView,
  draft: JobDraft,
  timeZone: string,
  now: Date,
): ClientCommand[] {
  const commands: ClientCommand[] = [];
  const name = draft.name.trim().replace(/\s+/g, ' ');
  const changes = {
    ...(name !== job.name ? { name } : {}),
    ...(draft.type !== job.draft.type ? { kind: draft.type } : {}),
  };
  if (Object.keys(changes).length) {
    commands.push({ type: 'editResponsibility', responsibilityId: job.responsibilityId, changes });
  }
  const today = todayIn(timeZone, now);
  const renameSeries = job.ownSeries && name !== job.name ? { name } : {};
  if (!job.seriesId) {
    // No dates yet (an older group): give the job its own series.
    commands.push(...seriesCommands(newId('s', state.eventSeries.map((s) => s.id)), job.responsibilityId, name, draft, timeZone, today));
    return commands;
  }
  if (sameWhen(job.draft, draft)) {
    if (Object.keys(renameSeries).length) commands.push({ type: 'editEventSeries', seriesId: job.seriesId, changes: renameSeries });
    return commands;
  }
  const repeat = jobPattern(draft, timeZone, today);
  if (repeat) {
    commands.push({ type: 'editEventSeries', seriesId: job.seriesId, changes: { ...renameSeries, repeat } });
  } else {
    const startsAt = zonedTimeToInstant(draft.repeat.date, draft.time, timeZone);
    commands.push({
      type: 'editEventSeries',
      seriesId: job.seriesId,
      changes: { ...renameSeries, repeat: null },
      replaceFutureEvents: [{ id: seriesEventId(job.seriesId, startsAt), seriesId: job.seriesId, startsAt }],
    });
  }
  return commands;
}

function seriesCommands(
  seriesId: string,
  responsibilityId: string,
  name: string,
  draft: JobDraft,
  timeZone: string,
  today: string,
): ClientCommand[] {
  const repeat = jobPattern(draft, timeZone, today);
  const series = { id: seriesId, name, responsibilityIds: [responsibilityId], repeat };
  if (repeat) return [{ type: 'addEventSeries', series }];
  const startsAt = zonedTimeToInstant(draft.repeat.date, draft.time, timeZone);
  return [{ type: 'addEventSeries', series, events: [{ id: seriesEventId(seriesId, startsAt), seriesId, startsAt }] }];
}

/** Adding a job: everyone in the group does it, in join order; its dates are filled in. */
export function newJobCommands(
  state: GroupState,
  draft: JobDraft,
  timeZone: string,
  now: Date,
  random?: () => number,
): ClientCommand[] {
  const name = draft.name.trim().replace(/\s+/g, ' ');
  const taken = [...state.responsibilities.map((r) => r.id), ...state.eventSeries.map((s) => s.id)];
  const rId = newId('r', taken, random);
  const sId = newId('s', [...taken, rId], random);
  const everyone = state.members.filter((m) => m.leftAt === null).map((m) => m.id);
  return [
    {
      type: 'addResponsibility',
      responsibility: { id: rId, name, kind: draft.type, headcount: 1, requiresConfirmation: false },
      // A headcount job has no turns: everyone is asked "Coming?" instead.
      ...(draft.type === 'headcount' ? {} : { qualifiedMemberIds: everyone }),
    },
    ...seriesCommands(sId, rId, name, draft, timeZone, todayIn(timeZone, now)),
  ];
}

/** Deleting a job: its series (upcoming dates go) and the job itself (history stays). */
export function deleteJobCommands(job: JobView): ClientCommand[] {
  return [
    ...(job.seriesId && job.ownSeries ? [{ type: 'removeEventSeries' as const, seriesId: job.seriesId }] : []),
    { type: 'removeResponsibility', responsibilityId: job.responsibilityId },
  ];
}

// ---------------------------------------------------------------------------
// The group's dates off

export type GroupDateOff = { date: string; eventIds: string[] };

/** Upcoming dates the whole group has off (every Event that day skipped), soonest first. */
export function groupDatesOff(state: GroupState, timeZone: string, now: Date): GroupDateOff[] {
  return byLocalDate(state, timeZone, now)
    .filter((d) => d.events.every((e) => e.skipDate))
    .map((d) => ({ date: d.date, eventIds: d.events.map((e) => e.id) }));
}

/** Upcoming dates something happens that can still be made a group date off, soonest first. */
export function dateOffCandidates(state: GroupState, timeZone: string, now: Date, limit = 12): GroupDateOff[] {
  return byLocalDate(state, timeZone, now)
    .filter((d) => d.events.some((e) => !e.skipDate))
    .slice(0, limit)
    .map((d) => ({ date: d.date, eventIds: d.events.filter((e) => !e.skipDate).map((e) => e.id) }));
}

function byLocalDate(state: GroupState, timeZone: string, now: Date) {
  const days = new Map<string, GroupState['events']>();
  const upcoming = state.events
    .filter((e) => Date.parse(e.startsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const e of upcoming) {
    const date = dateIn(e.startsAt, timeZone);
    days.set(date, [...(days.get(date) ?? []), e]);
  }
  return [...days].map(([date, events]) => ({ date, events }));
}

// ---------------------------------------------------------------------------
// Turn order (feedback-2 ticket 02, prototype `currentOrder` and the `turns` sheet)

export type TurnOrderPerson = { memberId: MemberId; name: string; isStandIn: boolean };

export type TurnOrderJob = {
  responsibilityId: string;
  name: string;
  /** First name of whoever has the job's next date (null when nothing is coming up). */
  nextName: string | null;
  /** People with upcoming turns in date order, then everyone else in the order they joined. */
  order: TurnOrderPerson[];
  /** The job's upcoming dates (group time zone, YYYY-MM-DD), soonest first, dates off left out. */
  dates: string[];
};

/**
 * The group's Take turns jobs as the "Turn order" section shows them. Only people who take turns
 * at the job (its Rotation) are listed, so the saved order names exactly them.
 */
export function turnOrderJobs(state: GroupState, timeZone: string, now: Date): TurnOrderJob[] {
  const at = now.getTime();
  const eventsById = new Map(state.events.map((e) => [e.id, e]));
  return state.responsibilities
    .filter((r) => r.removedAt === null && r.kind === 'turns')
    .map((r) => {
      const inLine = new Set(state.rotations.find((x) => x.responsibilityId === r.id)?.queue ?? []);
      const upcoming = state.assignments
        .filter((a) => {
          const e = eventsById.get(a.eventId);
          return a.responsibilityId === r.id && !!e && !e.skipDate && Date.parse(e.startsAt) > at;
        })
        .sort((a, b) => Date.parse(eventsById.get(a.eventId)!.startsAt) - Date.parse(eventsById.get(b.eventId)!.startsAt));

      const ids: MemberId[] = [];
      for (const a of upcoming) {
        const owner = a.turnOf ?? a.memberId;
        if (owner && inLine.has(owner) && !ids.includes(owner)) ids.push(owner);
      }
      for (const m of state.members) if (inLine.has(m.id) && !ids.includes(m.id)) ids.push(m.id);
      const order = ids.map((id) => {
        const m = memberById(state, id);
        return { memberId: id, name: m?.name ?? 'Former member', isStandIn: !!m && m.accountId === null };
      });

      const dates: string[] = [];
      const seen = new Set<string>();
      for (const a of upcoming) {
        if (seen.has(a.eventId)) continue;
        seen.add(a.eventId);
        dates.push(dateIn(eventsById.get(a.eventId)!.startsAt, timeZone));
      }

      const next = upcoming[0];
      const guest = next?.coverageRequest?.cover?.kind === 'guest' ? next.coverageRequest.cover.guestName : null;
      const nextMember = next?.memberId ? memberById(state, next.memberId) : undefined;
      const nextName = guest ? firstName(guest) : nextMember ? firstName(nextMember.name) : null;
      return { responsibilityId: r.id, name: r.name, nextName, order, dates };
    });
}

/** Moves the person at `index` one place earlier (-1) or later (+1); out of range changes nothing. */
export function moveInOrder<T>(order: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= order.length || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Saving the Turn order: the job's Rotation follows it from the next date. */
export function turnOrderCommand(
  job: TurnOrderJob,
  order: TurnOrderPerson[],
): Extract<ClientCommand, { type: 'reorderQueue' }> {
  return { type: 'reorderQueue', responsibilityId: job.responsibilityId, queue: order.map((p) => p.memberId) };
}
