/**
 * Schedule history in plain sentences: what changed, why, and who (or the system) caused
 * it. Every Member can read their Group's history, so these lines name people plainly.
 *
 * Pure TypeScript (engine types only), unit-tested under Node. Entries are the engine's
 * `HistoryEntry` as stored in `schedule_history`; names and dates are looked up in the
 * Group's current state (former Members keep their names there).
 */
import type {
  Assignment,
  AssignmentChange,
  Cause,
  GroupSettings,
  GroupState,
  HistoryEntry,
  Instant,
  MakeUpTurnChange,
  MemberId,
} from '../engine/types';
import { dateIn, formatDayShort, formatMonthDay, formatTimeIn } from './format';

/** A stored history entry (`schedule_history`), with its row id. */
export type HistoryRecord = HistoryEntry & { id: string };

export type HistoryContext = {
  state: GroupState;
  /** The viewer's Member id, so their own actions read "You ...". */
  myMemberId: MemberId | null;
  /** Dates are shown in this time zone (the viewer's). */
  timeZone: string;
};

export type HistoryTone = 'ok' | 'bad' | 'info' | 'warn' | 'neutral';

export type HistoryLine = {
  /** One sentence: what happened and who did it. */
  text: string;
  /** What it did to the schedule, e.g. "3 Assignments changed.", or null. */
  detail: string | null;
  tone: HistoryTone;
};

// ---------------------------------------------------------------------------
// Names and dates

function nameOf(ctx: HistoryContext, id: MemberId | null | undefined, you = 'You'): string {
  if (!id) return 'Someone';
  if (id === ctx.myMemberId) return you;
  return ctx.state.members.find((m) => m.id === id)?.name ?? 'A former Member';
}

/** The actor, as a sentence subject: a Member's name, "You", or "The system" (scheduled jobs). */
function actorName(ctx: HistoryContext, actorId: MemberId | null): string {
  return actorId === null ? 'The system' : nameOf(ctx, actorId);
}

function responsibilityName(ctx: HistoryContext, id: string | null | undefined): string {
  return ctx.state.responsibilities.find((r) => r.id === id)?.name ?? 'a Responsibility';
}

function seriesName(ctx: HistoryContext, id: string): string {
  return ctx.state.eventSeries.find((s) => s.id === id)?.name ?? 'an Event Series';
}

function eventDate(ctx: HistoryContext, eventId: string | null | undefined, short = true): string | null {
  const event = ctx.state.events.find((e) => e.id === eventId);
  if (!event) return null;
  const date = dateIn(event.startsAt, ctx.timeZone);
  return short ? formatDayShort(date) : formatMonthDay(date);
}

const onDate = (date: string | null) => (date ? ` on ${date}` : '');

/** The Assignment a command refers to, as it was in this entry (or now). */
function assignmentIn(entry: HistoryEntry, ctx: HistoryContext, assignmentId: string): Assignment | null {
  const change = entry.changes.find((c) => c.assignmentId === assignmentId);
  return change?.after ?? change?.before ?? ctx.state.assignments.find((a) => a.id === assignmentId) ?? null;
}

function assignmentPhrase(ctx: HistoryContext, a: Assignment | null): string {
  if (!a) return 'an Assignment';
  return `${responsibilityName(ctx, a.responsibilityId)}${onDate(eventDate(ctx, a.eventId))}`;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** Lower-cases a leading "You" mid-sentence. */
const object = (name: string) => (name === 'You' ? 'you' : name);

// ---------------------------------------------------------------------------
// Settings

const POLICY = { payItBack: 'Pay It Back', countRealWork: 'Count Real Work' } as const;
const TIME_OFF = { routeAround: 'Route around', askVolunteer: 'Ask for a volunteer' } as const;
const DUTY = { assignedMember: 'Assigned Member', admins: 'Admins' } as const;

function settingPhrases(settings: Partial<GroupSettings>): string[] {
  const out: string[] = [];
  if (settings.coveragePolicy) out.push(`the Coverage Policy to ${POLICY[settings.coveragePolicy]}`);
  if (settings.timeOffHandling) out.push(`Time Off handling to ${TIME_OFF[settings.timeOffHandling]}`);
  if (settings.replacementDuty) out.push(`Replacement Duty to ${DUTY[settings.replacementDuty]}`);
  if (settings.replacementDeadlineMs !== undefined) {
    const days = Math.round(settings.replacementDeadlineMs / 86_400_000);
    out.push(`"Find a replacement by" to ${days === 0 ? 'on the day' : `${plural(days, 'day')} before`}`);
  }
  if (settings.allowDoubling !== undefined) {
    out.push(settings.allowDoubling ? 'one person to hold two seats at an Event' : 'one seat per person per Event');
  }
  return out;
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// One entry

/** " (Holiday: Building closed)" for a Skip Date's reason (ticket 10), or nothing. */
function skipReasonPhrase(reason: string | null | undefined): string {
  const text = reason?.trim().replace(/[.!\s]+$/, '');
  return text ? ` (${text})` : '';
}

/** ", repeats weekly" for repeating Time Off, or nothing. */
function repeatPhrase(weeks: number | null | undefined): string {
  if (!weeks) return '';
  if (weeks === 1) return ', repeats weekly';
  if (weeks === 2) return ', every other week';
  return `, every ${weeks} weeks`;
}

/** The sentence for an entry's cause. */
function causeText(entry: HistoryEntry, ctx: HistoryContext): { text: string; tone: HistoryTone } {
  const cause: Cause = entry.cause;
  const actor = actorName(ctx, entry.actorId);
  const self = (id: MemberId) => entry.actorId === id;
  switch (cause.type) {
    case 'fillSchedule':
      return { text: 'The schedule was filled from the Rotations.', tone: 'neutral' };
    case 'addEvents': {
      const n = cause.events.length;
      return entry.actorId === null
        ? { text: `${plural(n, 'new Event')} added to the schedule.`, tone: 'neutral' }
        : { text: `${actor} added ${plural(n, 'Event')}.`, tone: 'neutral' };
    }
    case 'addSkipDate':
      return {
        text: `${actor} marked ${eventDate(ctx, cause.eventId) ?? 'an Event'} as a Skip Date${skipReasonPhrase(cause.reason)}. Turns move forward one Event.`,
        tone: 'neutral',
      };
    case 'removeSkipDate':
      return {
        text: `${actor} removed the Skip Date${onDate(eventDate(ctx, cause.eventId))}. The Rotation is restored.`,
        tone: 'neutral',
      };
    case 'addTimeOff': {
      const { memberId, startsAt, endsAt } = cause.timeOff;
      const from = formatMonthDay(dateIn(startsAt, ctx.timeZone));
      const to = formatMonthDay(dateIn(new Date(Date.parse(endsAt) - 1).toISOString(), ctx.timeZone));
      const range = from === to ? from : `${from} – ${to}`;
      const whose = self(memberId) ? '' : ` for ${nameOf(ctx, memberId)}`;
      return { text: `${actor} added Time Off${whose} (${range}${repeatPhrase(cause.timeOff.repeatEveryWeeks)}).`, tone: 'neutral' };
    }
    case 'removeTimeOff': {
      const off = ctx.state.timeOff.find((t) => t.id === cause.timeOffId);
      const whose = off && !self(off.memberId) ? ` for ${nameOf(ctx, off.memberId)}` : '';
      return { text: `${actor} removed Time Off${whose}.`, tone: 'neutral' };
    }
    case 'requestConfirmation': {
      const n = cause.assignmentIds.length;
      return { text: `${n === 1 ? 'An Assignment was' : `${n} Assignments were`} asked to confirm.`, tone: 'warn' };
    }
    case 'confirm': {
      const a = assignmentIn(entry, ctx, cause.assignmentId);
      return { text: `${actor} confirmed ${assignmentPhrase(ctx, a)}.`, tone: 'ok' };
    }
    case 'decline': {
      const change = entry.changes.find((c) => c.assignmentId === cause.assignmentId);
      const a = assignmentIn(entry, ctx, cause.assignmentId);
      if (change?.before?.coverageRequest?.cover) {
        return { text: `${actor} can no longer cover ${assignmentPhrase(ctx, a)}. It needs coverage again.`, tone: 'bad' };
      }
      const holder = change?.before?.memberId ?? a?.memberId ?? null;
      const why = quoted(cause.reason);
      if (holder && entry.actorId !== null && holder !== entry.actorId) {
        // An Admin declining for someone else (e.g. a Placeholder Member).
        const name = nameOf(ctx, holder);
        return {
          text: `${actor} said ${object(name)} can't make ${assignmentPhrase(ctx, a)}${why}. Coverage requested.`,
          tone: 'bad',
        };
      }
      return { text: `${actor} can't make ${assignmentPhrase(ctx, a)}${why}. Coverage requested.`, tone: 'bad' };
    }
    case 'withdrawDecline': {
      // Ticket 16: "Ana can make Sound on Sun, Nov 22 after all; Coverage Request withdrawn."
      const change = entry.changes.find((c) => c.assignmentId === cause.assignmentId);
      const a = assignmentIn(entry, ctx, cause.assignmentId);
      const holder = change?.after?.memberId ?? a?.memberId ?? null;
      const phrase = `can make ${assignmentPhrase(ctx, a)} after all; Coverage Request withdrawn.`;
      if (holder && entry.actorId !== null && holder !== entry.actorId) {
        return { text: `${actor} said ${object(nameOf(ctx, holder))} ${phrase}`, tone: 'ok' };
      }
      return { text: `${actor} ${phrase}`, tone: 'ok' };
    }
    case 'cover': {
      const a = assignmentIn(entry, ctx, cause.assignmentId);
      const forWhom = a?.coverageRequest?.requestedBy ?? a?.turnOf ?? null;
      const tail = forWhom ? ` for ${object(nameOf(ctx, forWhom))}` : '';
      return { text: `${actor} covered ${assignmentPhrase(ctx, a)}${tail}.`, tone: 'info' };
    }
    case 'markCovered': {
      const a = assignmentIn(entry, ctx, cause.assignmentId);
      const by = 'guestName' in cause.by ? `${cause.by.guestName.trim()} (guest)` : object(nameOf(ctx, cause.by.memberId));
      return { text: `${actor} marked ${assignmentPhrase(ctx, a)} covered by ${by}.`, tone: 'info' };
    }
    case 'changeSettings': {
      const parts = settingPhrases(cause.settings);
      return {
        text: parts.length ? `${actor} changed ${joinPhrases(parts)}.` : `${actor} changed the group's settings.`,
        tone: 'neutral',
      };
    }
    case 'rebalance':
      return { text: `${actor} rebalanced the ${responsibilityName(ctx, cause.responsibilityId)} Rotation by workload.`, tone: 'neutral' };
    case 'addMember': {
      const name = cause.member.name;
      if (self(cause.member.id)) return { text: `${name} joined the group.`, tone: 'neutral' };
      const placeholder = !cause.member.accountId;
      return { text: `${actor} added ${name}${placeholder ? ' as a Placeholder Member' : ''}.`, tone: 'neutral' };
    }
    case 'qualifyMember':
      return {
        text: `${actor} made ${object(nameOf(ctx, cause.memberId))} a Qualified Member for ${responsibilityName(ctx, cause.responsibilityId)}.`,
        tone: 'neutral',
      };
    case 'unqualifyMember':
      return {
        text: `${actor} took ${object(nameOf(ctx, cause.memberId))} out of the ${responsibilityName(ctx, cause.responsibilityId)} Rotation.`,
        tone: 'neutral',
      };
    case 'removeMember':
      return self(cause.memberId)
        ? { text: `${actor} left the group. Their future turns moved to others.`, tone: 'warn' }
        : { text: `${actor} removed ${object(nameOf(ctx, cause.memberId))} from the group. Their future turns moved to others.`, tone: 'warn' };
    case 'claimPlaceholder':
      return { text: `${nameOf(ctx, cause.memberId)} joined and took their place in the Rotations.`, tone: 'neutral' };
    case 'renameMember':
      if (!self(cause.memberId)) return { text: `${actor} renamed a Member to ${cause.name}.`, tone: 'neutral' };
      return actor === 'You'
        ? { text: `You changed your name to ${cause.name}.`, tone: 'neutral' }
        : { text: `${cause.name} changed their name.`, tone: 'neutral' };
    case 'setAdmin':
      if (!cause.isAdmin && self(cause.memberId)) return { text: `${actor} stepped down as Admin.`, tone: 'neutral' };
      return cause.isAdmin
        ? { text: `${actor} made ${object(nameOf(ctx, cause.memberId))} an Admin.`, tone: 'neutral' }
        : { text: `${actor} removed ${object(nameOf(ctx, cause.memberId))} as Admin.`, tone: 'neutral' };
    case 'addResponsibility':
      return { text: `${actor} added the Responsibility ${cause.responsibility.name}.`, tone: 'neutral' };
    case 'editResponsibility': {
      const { changes } = cause;
      const parts: string[] = [];
      if (changes.name !== undefined) parts.push(`renamed it ${changes.name}`);
      if (changes.headcount !== undefined) {
        parts.push(`set it to ${changes.headcount} ${changes.headcount === 1 ? 'person' : 'people'} per Event`);
      }
      if (changes.requiresConfirmation !== undefined) {
        parts.push(changes.requiresConfirmation ? 'turned on confirmation' : 'turned off confirmation');
      }
      const name = changes.name !== undefined ? 'a Responsibility' : responsibilityName(ctx, cause.responsibilityId);
      return { text: `${actor} changed ${name}${parts.length ? `: ${joinPhrases(parts)}` : ''}.`, tone: 'neutral' };
    }
    case 'removeResponsibility':
      return { text: `${actor} removed the Responsibility ${responsibilityName(ctx, cause.responsibilityId)}.`, tone: 'warn' };
    case 'reorderResponsibilities':
      return { text: `${actor} changed the order Responsibilities are filled in.`, tone: 'neutral' };
    case 'setPrimaryResponsibility':
      return cause.responsibilityId
        ? { text: `${actor} made ${responsibilityName(ctx, cause.responsibilityId)} the Primary Responsibility.`, tone: 'neutral' }
        : { text: `${actor} cleared the Primary Responsibility.`, tone: 'neutral' };
    case 'reorderQueue':
      return { text: `${actor} reordered the ${responsibilityName(ctx, cause.responsibilityId)} Rotation.`, tone: 'neutral' };
    case 'addEventSeries': {
      const n = cause.events?.length ?? 0;
      return { text: `${actor} added the Event Series ${cause.series.name}${n ? ` (${plural(n, 'Event')})` : ''}.`, tone: 'neutral' };
    }
    case 'editEventSeries': {
      const moved = cause.replaceFutureEvents !== undefined || cause.changes.repeat !== undefined;
      const name = cause.changes.name ?? seriesName(ctx, cause.seriesId);
      return {
        text: `${actor} changed the Event Series ${name}${moved ? '. Turns follow to the new dates' : ''}.`,
        tone: moved ? 'warn' : 'neutral',
      };
    }
    case 'removeEventSeries':
      return { text: `${actor} removed the Event Series ${seriesName(ctx, cause.seriesId)}.`, tone: 'warn' };
    case 'removeEvent':
      return { text: `${actor} removed the Event${onDate(eventDate(ctx, cause.eventId))}.`, tone: 'warn' };
    case 'makeUpTurnPaid': {
      const turn = ctx.state.makeUpTurns.find((t) => t.id === cause.makeUpTurnId);
      if (!turn) return { text: 'A Make-up Turn was paid.', tone: 'ok' };
      return {
        text: `${nameOf(ctx, turn.debtorId)} paid back the ${responsibilityName(ctx, turn.responsibilityId)} Make-up Turn owed to ${object(nameOf(ctx, turn.creditorId))}.`,
        tone: 'ok',
      };
    }
    default:
      return { text: 'The schedule changed.', tone: 'neutral' };
  }
}

/** Causes about one Assignment, where "1 Assignment changed" adds nothing. */
const SINGLE_ASSIGNMENT = new Set(['confirm', 'decline', 'withdrawDecline', 'cover', 'markCovered', 'requestConfirmation']);

function makeUpTurnText(ctx: HistoryContext, changes: MakeUpTurnChange[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    const turn = ctx.state.makeUpTurns.find((t) => t.id === c.makeUpTurnId);
    if (!turn) continue;
    const debtor = nameOf(ctx, turn.debtorId);
    const creditor = object(nameOf(ctx, turn.creditorId));
    const what = responsibilityName(ctx, turn.responsibilityId);
    if (c.before === null && c.after === 'outstanding') {
      out.push(`${debtor} ${debtor === 'You' ? 'owe' : 'owes'} ${creditor} a ${what} Make-up Turn.`);
    } else if (c.after === 'cancelled') {
      out.push(`${debtor === 'You' ? 'Your' : `${debtor}'s`} ${what} Make-up Turn to ${creditor} was cancelled.`);
    } else if (c.after === 'settled') {
      out.push(`${debtor === 'You' ? 'Your' : `${debtor}'s`} ${what} Make-up Turn to ${creditor} is settled.`);
    }
  }
  return out;
}

/**
 * One history entry as a readable line, e.g. "Ben covered Sound on Sun, Nov 22 for Ana."
 * with detail "Ana owes Ben a Sound Make-up Turn."
 */
export function describeHistoryEntry(entry: HistoryEntry, ctx: HistoryContext): HistoryLine {
  const { text, tone } = causeText(entry, ctx);
  const details = makeUpTurnText(ctx, entry.makeUpTurns);
  const n = entry.changes.length;
  if (n > 0 && !SINGLE_ASSIGNMENT.has(entry.cause.type) && entry.cause.type !== 'makeUpTurnPaid') {
    details.unshift(`${plural(n, 'Assignment')} changed.`);
  }
  return { text, detail: details.length ? details.join(' ') : null, tone };
}

// ---------------------------------------------------------------------------
// One Assignment's history

export type AssignmentHistoryLine = {
  key: string;
  at: Instant;
  /** What happened to this Assignment. */
  text: string;
  /** Why: the entry's sentence, when it adds something. */
  detail: string | null;
  tone: HistoryTone;
};

function coverLabel(ctx: HistoryContext, a: Assignment): string | null {
  const cover = a.coverageRequest?.cover;
  if (!cover) return null;
  return cover.kind === 'guest' ? `${cover.guestName} (guest)` : object(nameOf(ctx, cover.memberId));
}

/** A Decline reason as ': “Traveling”', or nothing (ticket 16). */
function quoted(reason: string | null | undefined): string {
  const text = reason?.trim();
  return text ? `: “${text}”` : '';
}

/** "Moved from 9:00 AM to 10:30 AM on Sun, Nov 22" when only the time changed (ticket 16). */
function sameDayMove(ctx: HistoryContext, fromEventId: string, toEventId: string): string | null {
  const from = ctx.state.events.find((e) => e.id === fromEventId);
  const to = ctx.state.events.find((e) => e.id === toEventId);
  if (!from || !to) return null;
  const date = formatDayShort(dateIn(to.startsAt, ctx.timeZone));
  return `Moved from ${formatTimeIn(from.startsAt, ctx.timeZone)} to ${formatTimeIn(to.startsAt, ctx.timeZone)} on ${date}`;
}

/** What one change did to its Assignment, e.g. "Moved from Sun, Nov 22 to Sun, Nov 29". */
export function describeAssignmentChange(change: AssignmentChange, ctx: HistoryContext): { text: string; tone: HistoryTone } {
  const { before, after } = change;
  if (!before && after) {
    const who = after.memberId ? nameOf(ctx, after.memberId) : null;
    if (!who) return { text: 'Added. No one was available yet', tone: 'bad' };
    if (after.makeUpTurnId) return { text: `Assigned to ${object(who)} as a Make-up Turn`, tone: 'info' };
    return { text: `Assigned to ${object(who)} by Rotation`, tone: 'neutral' };
  }
  if (before && !after) return { text: 'Removed from the schedule', tone: 'warn' };
  if (!before || !after) return { text: 'Updated', tone: 'neutral' };

  if (before.eventId !== after.eventId) {
    const from = eventDate(ctx, before.eventId);
    const to = eventDate(ctx, after.eventId);
    const sameDay = from && from === to ? sameDayMove(ctx, before.eventId, after.eventId) : null;
    if (sameDay) return { text: sameDay, tone: 'warn' };
    return { text: from && to ? `Moved from ${from} to ${to}` : to ? `Moved to ${to}` : 'Moved to another Event', tone: 'warn' };
  }
  const coverBefore = before.coverageRequest?.cover ?? null;
  const coverAfter = after.coverageRequest?.cover ?? null;
  if (!coverBefore && coverAfter) return { text: `Covered by ${coverLabel(ctx, after)}`, tone: 'info' };
  if (coverBefore && !coverAfter && after.coverageRequest) return { text: 'Cover withdrawn. Needs coverage again', tone: 'bad' };
  if (!before.coverageRequest && after.coverageRequest) {
    const who = nameOf(ctx, after.coverageRequest.requestedBy ?? after.memberId);
    const reason = after.coverageRequest.reason;
    if (reason === 'declined') return { text: `${who} can't make it${quoted(after.coverageRequest.note)}. Needs coverage`, tone: 'bad' };
    if (reason === 'timeOff') return { text: `${who} ${who === 'You' ? 'are' : 'is'} on Time Off. Needs coverage`, tone: 'bad' };
    return { text: 'No one available. Needs coverage', tone: 'bad' };
  }
  if (before.coverageRequest && !after.coverageRequest) return { text: `Back with ${object(nameOf(ctx, after.memberId))}`, tone: 'neutral' };
  if (before.memberId !== after.memberId) {
    const to = after.memberId ? object(nameOf(ctx, after.memberId)) : 'no one';
    const from = before.memberId ? object(nameOf(ctx, before.memberId)) : 'no one';
    return { text: `Reassigned from ${from} to ${to}`, tone: 'warn' };
  }
  if (!before.makeUpTurnId && after.makeUpTurnId) return { text: 'Now a Make-up Turn', tone: 'info' };
  if (before.makeUpTurnId && !after.makeUpTurnId) return { text: 'No longer a Make-up Turn', tone: 'neutral' };
  if (before.confirmation !== after.confirmation) {
    if (after.confirmation === 'confirmed') return { text: `Confirmed by ${object(nameOf(ctx, after.memberId))}`, tone: 'ok' };
    if (after.confirmation === 'requested') return { text: `${nameOf(ctx, after.memberId)} asked to confirm`, tone: 'warn' };
    if (after.confirmation === 'notYetRequested') return { text: 'Confirmation will be asked for closer to the Event', tone: 'neutral' };
    return { text: 'No confirmation needed', tone: 'neutral' };
  }
  return { text: 'Updated', tone: 'neutral' };
}

/**
 * The timeline of one Assignment, oldest first: each change to it, plus the payment of a
 * Make-up Turn it carried.
 */
export function assignmentHistory(
  entries: HistoryRecord[],
  assignmentId: string,
  ctx: HistoryContext,
): AssignmentHistoryLine[] {
  const assignment = ctx.state.assignments.find((a) => a.id === assignmentId);
  const out: AssignmentHistoryLine[] = [];
  const ordered = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || Number(a.id) - Number(b.id));
  for (const entry of ordered) {
    const change = entry.changes.find((c) => c.assignmentId === assignmentId);
    if (change) {
      const { text, tone } = describeAssignmentChange(change, ctx);
      const why = causeText(entry, ctx).text;
      const routine = entry.cause.type === 'fillSchedule' || (entry.cause.type === 'addEvents' && entry.actorId === null);
      out.push({ key: `${entry.id}:${assignmentId}`, at: entry.at, text, detail: routine ? null : why, tone });
    } else if (
      entry.cause.type === 'makeUpTurnPaid' &&
      assignment?.makeUpTurnId &&
      entry.cause.makeUpTurnId === assignment.makeUpTurnId
    ) {
      out.push({ key: `${entry.id}:paid`, at: entry.at, text: 'Make-up Turn paid', detail: null, tone: 'ok' });
    }
  }
  return out;
}

/**
 * "Moved from Sun, Nov 22 to Sun, Nov 29: Sam marked Sun, Nov 22 as a Skip Date." for the
 * Assignment's latest move, or null when it never moved.
 */
export function movedNotice(entries: HistoryRecord[], assignmentId: string, ctx: HistoryContext): string | null {
  const ordered = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || Number(b.id) - Number(a.id));
  for (const entry of ordered) {
    const change = entry.changes.find((c) => c.assignmentId === assignmentId);
    if (change?.before && change.after && change.before.eventId !== change.after.eventId) {
      const { text } = describeAssignmentChange(change, ctx);
      return `${text}. ${causeText(entry, ctx).text}`;
    }
  }
  return null;
}

/** Newest first, for the Group's "Schedule history" list. */
export function historyLines(entries: HistoryRecord[], ctx: HistoryContext): (HistoryLine & { key: string; at: Instant })[] {
  return [...entries]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || Number(b.id) - Number(a.id))
    .map((entry) => ({ key: entry.id, at: entry.at, ...describeHistoryEntry(entry, ctx) }));
}
