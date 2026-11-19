/**
 * What the cover flow says (simplify ticket 07): the "Can't make it?" sheet, the "Who is
 * covering?" picker, the note on a turn that needs cover, and the swap sentence shown once a
 * cover is set ("Sam's covering for you on Nov 29. You'll take Sam's next turn on Dec 13.").
 *
 * The swap date comes from the engine: the command is applied to the loaded state without
 * saving, and the history sentence (`coverSentence`, src/schedule/history.ts) reads the turn
 * the engine placed. Activity uses the same sentence, so both always agree.
 *
 * Pure TypeScript: no React, Supabase or clock reads; unit-tested under Node.
 */
import { applyCommand, MAX_GUEST_NAME } from '../engine/commands';
import type { Assignment, Command, GroupState, Instant, MemberId } from '../engine/types';
import { dateIn, formatDayShort, formatTimeIn } from '../schedule/format';
import { coverSentence, NOT_IN_GROUP } from '../schedule/history';

export type SheetContext = {
  state: GroupState;
  groupName: string;
  viewerTimeZone: string;
  /** The Group's time zone: "that day" is the Group's day. Defaults to the viewer's. */
  groupTimeZone?: string;
  /** The viewer's Member id. */
  me: MemberId;
  now: Instant;
};

/** The longest outside cover name the server accepts. */
export const MAX_COVER_NAME = MAX_GUEST_NAME;

// ---------------------------------------------------------------------------
// Helpers

function found(state: GroupState, assignmentId: string) {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  const event = assignment && state.events.find((e) => e.id === assignment.eventId);
  if (!assignment || !event) return null;
  const job = state.responsibilities.find((r) => r.id === assignment.responsibilityId)?.name ?? 'Job';
  return { assignment, event, job };
}

function nameOf(state: GroupState, id: MemberId | null, me: MemberId | null, you = 'You'): string {
  if (id === null) return 'Someone';
  if (id === me) return you;
  return state.members.find((m) => m.id === id)?.name ?? 'A former member';
}

/** First name, as sentences use it ("Ben can't make it"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Whether a Member is a Stand-in: in the group and the rotation, but not on the app. */
export function isStandIn(state: GroupState, memberId: MemberId | null): boolean {
  const m = memberId ? state.members.find((x) => x.id === memberId) : undefined;
  return m !== undefined && m.leftAt === null && m.accountId === null;
}

/**
 * The Members a request for cover reaches in the app: active Members of the job's rotation
 * with an account (a Stand-in isn't on the app), except the given ones.
 */
export function qualifiedToAsk(state: GroupState, responsibilityId: string, except: (MemberId | null)[]): MemberId[] {
  const queue = state.rotations.find((r) => r.responsibilityId === responsibilityId)?.queue ?? [];
  return queue.filter((id) => {
    const m = state.members.find((x) => x.id === id);
    return m !== undefined && m.leftAt === null && m.accountId !== null && !except.includes(id);
  });
}

/** "Ben", "Ben and Cal", "Ben, Cal and Dee", "Ben, Cal, Dee and 2 more". */
export function nameList(names: string[], max = 4): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length > max) return `${names.slice(0, max - 1).join(', ')} and ${names.length - (max - 1)} more`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Whether the Member already holds a seat at the turn's Event that blocks this one (engine `seatConflict`). */
export function atEventAlready(state: GroupState, target: Assignment, memberId: MemberId): boolean {
  return state.assignments.some(
    (a) =>
      a.id !== target.id &&
      a.eventId === target.eventId &&
      a.memberId === memberId &&
      (a.coverageRequest === null || a.coverageRequest.cover !== null) &&
      (a.responsibilityId === target.responsibilityId || !state.settings.allowDoubling),
  );
}

/**
 * Whether the Member already has another job in the group on the turn's day (in the group's
 * time zone): they aren't offered "I'll cover" for it ("You already have another job in Sunday
 * Team that day.").
 */
export function busyThatDay(state: GroupState, target: Assignment, memberId: MemberId, timeZone: string): boolean {
  const event = state.events.find((e) => e.id === target.eventId);
  if (!event) return false;
  const day = dateIn(event.startsAt, timeZone);
  return state.assignments.some((a) => {
    if (a.id === target.id || a.memberId !== memberId) return false;
    if (a.coverageRequest && a.coverageRequest.cover === null) return false;
    const other = state.events.find((e) => e.id === a.eventId);
    return other !== undefined && !other.skipDate && dateIn(other.startsAt, timeZone) === day;
  });
}

export function busyNote(groupName: string): string {
  return `You already have another job in ${groupName} that day.`;
}

// ---------------------------------------------------------------------------
// "Can't make it?"

export type CantMakeItView = {
  title: string;
  /** "Greeter · Sun, Nov 29 · 10:00 AM". */
  details: string;
  message: string;
  /** The viewer is covering it: saying they can't puts it back to the group. */
  withdrawingCover: boolean;
  /** The main button: "Ask the group for cover". */
  askLabel: string;
  /** The second button, "I'll find someone to cover", or null when it isn't offered. */
  findLabel: string | null;
};

/**
 * The "Can't make it?" sheet (prototype `cant`): a details line and two choices, ask the group
 * (`decline`) or "I'll find someone to cover" (`decline` with `coveredBy`). For a covered turn
 * the coverer can only hand it back to the group.
 */
export function cantMakeItView(ctx: SheetContext, assignmentId: string): CantMakeItView | null {
  const f = found(ctx.state, assignmentId);
  if (!f) return null;
  const { assignment: a, event, job } = f;
  const details = `${job} · ${formatDayShort(dateIn(event.startsAt, ctx.viewerTimeZone))} · ${formatTimeIn(event.startsAt, ctx.viewerTimeZone)}`;
  const cover = a.coverageRequest?.cover;
  if (cover) {
    return {
      title: "Can't cover after all?",
      details,
      message: 'We’ll ask the group to cover it again.',
      withdrawingCover: true,
      askLabel: 'Ask the group for cover',
      findLabel: null,
    };
  }
  return {
    title: "Can't make it?",
    details,
    message: 'Pick how to get it covered. Turns stay fair automatically.',
    withdrawingCover: false,
    askLabel: 'Ask the group for cover',
    findLabel: "I'll find someone to cover",
  };
}

// ---------------------------------------------------------------------------
// "Who is covering?"

export type CoverPickOption = {
  memberId: MemberId;
  name: string;
  /** "Stand-in", or why they can't take it. */
  detail: string | null;
  disabled: boolean;
};

export type CoverPickerView = {
  title: string;
  options: CoverPickOption[];
  /** The last row: a typed name of someone not in the group. */
  otherLabel: string;
};

/**
 * Who can cover a turn (prototype `pick`): the group's active Members except whoever can't make
 * it (Stand-ins included), plus "Someone else" (a typed name). A Member already on this date's
 * Event is shown but can't be picked.
 */
export function coverPickerView(ctx: SheetContext, assignmentId: string): CoverPickerView | null {
  const { state, me } = ctx;
  const f = found(state, assignmentId);
  if (!f) return null;
  const { assignment: a } = f;
  const holder = a.coverageRequest ? a.coverageRequest.requestedBy : a.memberId;
  const options = state.members
    .filter((m) => m.leftAt === null && m.id !== holder)
    .map((m) => {
      const busy = atEventAlready(state, a, m.id);
      return {
        memberId: m.id,
        name: m.id === me ? 'You' : m.name,
        detail: busy ? 'Already on another job then' : m.accountId === null ? 'Stand-in' : null,
        disabled: busy,
      };
    })
    .sort(
      (x, y) =>
        Number(x.disabled) - Number(y.disabled) ||
        Number(y.name === 'You') - Number(x.name === 'You') ||
        x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }),
    );
  return { title: 'Who is covering?', options, otherLabel: 'Someone else' };
}

/** A typed outside cover name, trimmed, or null when it can't be saved (empty). */
export function outsideCoverName(text: string): string | null {
  const name = text.trim().replace(/\s+/g, ' ');
  return name ? name.slice(0, MAX_COVER_NAME) : null;
}

// ---------------------------------------------------------------------------
// The note on a turn that needs cover

export type NeedsCoverView = {
  headline: string;
  detail: string;
  /** Why they can't make it, in their words, when given. */
  reason: string | null;
};

/** The panel on a turn that needs cover (prototype `inst` sheet). Null when it doesn't. */
export function needsCoverView(ctx: SheetContext, assignmentId: string, busy: boolean): NeedsCoverView | null {
  const f = found(ctx.state, assignmentId);
  const request = f?.assignment.coverageRequest;
  if (!f || !request || request.cover) return null;
  const requester = request.requestedBy ?? f.assignment.turnOf;
  const reason = request.note ?? null;
  if (requester === ctx.me) {
    return { headline: 'Needs cover', detail: 'We’ll tell you when someone takes it. The first person to tap “I’ll cover” takes it.', reason };
  }
  const who = requester ? `${firstName(nameOf(ctx.state, requester, ctx.me))} can’t make it.` : 'No one is on it yet.';
  return {
    headline: 'Needs cover',
    detail: busy ? `${who} ${busyNote(ctx.groupName)}` : `${who} The first person to tap “I’ll cover” takes it.`,
    reason,
  };
}

// ---------------------------------------------------------------------------
// After a cover

/**
 * The swap sentence for a cover command, from the engine: the command is applied to the loaded
 * state (without saving) as the viewer, and its history entry is told as Activity tells it.
 * Null when the engine would refuse it, or it covers nothing.
 */
export function coverPreviewMessage(
  ctx: SheetContext,
  command: Extract<Command, { type: 'cover' | 'markCovered' | 'decline' }>,
): string | null {
  const result = applyCommand(ctx.state, command, { now: ctx.now, actorId: ctx.me });
  if (!result.ok) return null;
  const hctx = { state: result.state, myMemberId: ctx.me, timeZone: ctx.viewerTimeZone };
  for (const entry of result.history) {
    const sentence = coverSentence(entry, hctx);
    if (sentence) return sentence;
  }
  return null;
}

export type DoneAction = 'confirm' | 'decline' | 'withdrawCover' | 'withdrawDecline' | 'cover' | 'markCovered';

/** The inline confirmation after an action worked, e.g. "Confirmed Sound for Sun, Nov 22. Thank you!". */
export function successMessage(action: DoneAction, job: string, date: string, coveredBy?: string): string {
  const day = formatDayShort(date);
  switch (action) {
    case 'confirm':
      return `Confirmed ${job} for ${day}. Thank you!`;
    case 'decline':
      return `Needs cover. We’ll tell you when someone takes ${job} on ${day}.`;
    case 'withdrawDecline':
      return `You’re back on ${job} for ${day}.`;
    case 'withdrawCover':
      return `You’re no longer covering ${job} on ${day}. We’ve asked the group again.`;
    case 'cover':
      return `You’re covering ${job} on ${day}. Thank you!`;
    case 'markCovered':
      return `${coveredBy ?? 'Someone'} is covering ${job} on ${day}.`;
  }
}

/**
 * Who covered a turn, for "Already covered by Cal." after losing the race to "I'll cover".
 * Null when it isn't covered (any more).
 */
export function coveredByName(state: GroupState, assignmentId: string, me: MemberId | null): string | null {
  const cover = state.assignments.find((a) => a.id === assignmentId)?.coverageRequest?.cover;
  if (!cover) return null;
  if (cover.kind === 'guest') return `${cover.guestName} (${NOT_IN_GROUP.toLowerCase()})`;
  return nameOf(state, cover.memberId, me, 'you');
}
