/**
 * What the Decline, Cover and Mark covered sheets say (ticket 09), and the coverage panel on
 * the Assignment screen. The Cover sheet's Make-up Turn date is an engine preview: the `cover`
 * command is applied to the loaded state without saving, and the resulting Make-up Turn's
 * paying Assignment gives the date.
 *
 * Pure TypeScript: no React, Supabase or clock reads; unit-tested under Node.
 */
import { applyCommand } from '../engine/commands';
import { replacementDutyHolder } from '../engine/status';
import type { Assignment, GroupState, Instant, MemberId, RejectionReason } from '../engine/types';
import { dateIn, formatDayShort } from '../schedule/format';

export type SheetContext = {
  state: GroupState;
  groupName: string;
  viewerTimeZone: string;
  /** The viewer's Member id. */
  me: MemberId;
  now: Instant;
};

/** Optional Decline reasons (prototype). Sent as `decline`'s `reason` (see `declineReasonText`). */
export const DECLINE_REASONS = ['Traveling', 'Sick', 'Work conflict', 'Family commitment', 'Other'] as const;

/**
 * Whether the Decline reason and note can be saved: `decline` carries an optional `reason`,
 * stored on the Coverage Request as `note` (ticket 16).
 */
export const DECLINE_REASON_SAVED = true;

/** The longest reason the server accepts. */
export const MAX_DECLINE_REASON = 300;

/**
 * The reason sent with a Decline, as the prototype composes it: "Traveling: back on the 10th",
 * the chip alone, or the note alone. Null when neither was given.
 */
export function declineReasonText(chip: string | null, note: string): string | null {
  const text = [chip, note.trim()].filter(Boolean).join(': ');
  return text ? text.slice(0, MAX_DECLINE_REASON) : null;
}

// ---------------------------------------------------------------------------
// Helpers

function found(state: GroupState, assignmentId: string) {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  const event = assignment && state.events.find((e) => e.id === assignment.eventId);
  if (!assignment || !event) return null;
  const responsibility = state.responsibilities.find((r) => r.id === assignment.responsibilityId);
  return { assignment, event, responsibilityName: responsibility?.name ?? 'Responsibility' };
}

function nameOf(state: GroupState, id: MemberId | null, me: MemberId | null, you = 'You'): string {
  if (id === null) return 'Someone';
  if (id === me) return you;
  return state.members.find((m) => m.id === id)?.name ?? 'A former Member';
}

/** First name, as the prototype uses in sentences ("Ben can't make it"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The Members a Coverage Request asks: active Members of the Responsibility's team with
 * an account (a Placeholder can't be asked or tap "I can cover"), except the given ones.
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

function deadlineOf(state: GroupState, eventStartsAt: Instant): Instant {
  return new Date(Date.parse(eventStartsAt) - state.settings.replacementDeadlineMs).toISOString();
}

// ---------------------------------------------------------------------------
// Decline sheet

export type DeclineSheetView = {
  overline: string;
  title: string;
  message: string;
  /** The viewer is covering it: declining withdraws the Cover. */
  withdrawingCover: boolean;
  /** "Who we'll ask": names, and the line after them. */
  ask: { names: string[]; line: string };
  /** What happens if nobody accepts by the deadline. */
  deadlineNote: string;
  /** The Pay It Back explainer, or the cancelled Make-up Turn when withdrawing a Cover. */
  payItBack: string | null;
  /** "This is a Make-up Turn…" when declining one. */
  makeUpNote: string | null;
  submitLabel: string;
};

export function declineSheetView(ctx: SheetContext, assignmentId: string): DeclineSheetView | null {
  const { state, me, viewerTimeZone } = ctx;
  const f = found(state, assignmentId);
  if (!f) return null;
  const { assignment: a, event, responsibilityName: r } = f;
  const cover = a.coverageRequest?.cover;
  const withdrawingCover = cover?.kind === 'member' && cover.memberId === me;
  const requester = withdrawingCover ? (a.coverageRequest?.requestedBy ?? null) : me;
  const requesterName = requester === me ? 'you' : firstName(nameOf(state, requester, me));

  const ask = qualifiedToAsk(state, a.responsibilityId, [me, requester]).map((id) => nameOf(state, id, me));
  const askLine = ask.length
    ? `On the ${r} team`
    : `No one else is on the ${r} team yet, so it will need a replacement.`;

  const deadline = deadlineOf(state, event.startsAt);
  const admins = state.settings.replacementDuty === 'admins';
  const who = admins
    ? 'the Admins will find a replacement'
    : requester === me
      ? "you'll be asked to find a replacement"
      : `${requesterName} will be asked to find a replacement`;
  const deadlineNote =
    Date.parse(deadline) > Date.parse(ctx.now)
      ? `The first to accept gets it. If nobody does by ${formatDayShort(dateIn(deadline, viewerTimeZone))}, ${who}.`
      : `The first to accept gets it. The "find a replacement by" date has passed, so if nobody accepts, ${who}.`;

  let payItBack: string | null = null;
  if (withdrawingCover) {
    const owed = state.makeUpTurns.find((t) => t.coverAssignmentId === a.id && t.status === 'outstanding');
    if (owed) payItBack = `The Make-up Turn ${requesterName} owes you for this is cancelled.`;
  } else if (state.settings.coveragePolicy === 'payItBack') {
    payItBack = `${ctx.groupName} uses Pay It Back: whoever covers you is owed a Make-up Turn. You'll take their next ${r} turn.`;
  }

  const turn = a.makeUpTurnId ? state.makeUpTurns.find((t) => t.id === a.makeUpTurnId) : undefined;
  const makeUpNote =
    !withdrawingCover && turn && turn.status === 'outstanding'
      ? `This is a Make-up Turn. Declining it settles your debt to ${firstName(nameOf(state, turn.creditorId, me))}; you'll owe whoever covers instead.`
      : null;

  return {
    overline: `${ctx.groupName} · ${formatDayShort(dateIn(event.startsAt, viewerTimeZone))}`,
    title: withdrawingCover ? `Can't cover ${r} after all?` : `Can't make ${r}?`,
    message: withdrawingCover
      ? `The Coverage Request opens again for ${requesterName}, and the ${r} team is asked again.`
      : `No problem. We'll send a Coverage Request to the ${r} team.${DECLINE_REASON_SAVED ? ' A reason is optional but helps.' : ''}`,
    withdrawingCover,
    ask: { names: ask, line: askLine },
    deadlineNote,
    payItBack,
    makeUpNote,
    submitLabel: withdrawingCover ? 'Withdraw my Cover' : 'Send Coverage Request',
  };
}

// ---------------------------------------------------------------------------
// Cover sheet

export type CoverSheetView = {
  overline: string;
  title: string;
  /** The Event's date in the viewer's zone and its start. */
  date: string;
  startsAt: Instant;
  workloadNote: string;
  /** The Pay It Back line from the engine preview, or the Count Real Work note. */
  makeUp: string | null;
  /** The preview's Make-up Turn date (viewer's date), when the engine placed one. */
  makeUpDate: string | null;
  /** Why the engine would refuse this Cover right now, if it would. */
  problem: RejectionReason | null;
  /** Why the Member can't make it, e.g. "Traveling: back on the 10th", or "Time Off". */
  reason: string | null;
};

/** Applies `cover` to the loaded state without saving, as the viewer. */
export function previewCover(ctx: SheetContext, assignmentId: string) {
  return applyCommand(ctx.state, { type: 'cover', assignmentId }, { now: ctx.now, actorId: ctx.me });
}

export function coverSheetView(ctx: SheetContext, assignmentId: string): CoverSheetView | null {
  const { state, me, viewerTimeZone } = ctx;
  const f = found(state, assignmentId);
  if (!f) return null;
  const { assignment: a, event, responsibilityName: r } = f;
  const requester = a.coverageRequest?.requestedBy ?? null;
  const requesterName = requester ? firstName(nameOf(state, requester, me)) : null;

  const preview = previewCover(ctx, assignmentId);
  let makeUp: string | null = null;
  let makeUpDate: string | null = null;
  if (preview.ok) {
    const before = new Set(state.makeUpTurns.map((t) => t.id));
    const turn = preview.state.makeUpTurns.find((t) => !before.has(t.id) && t.coverAssignmentId === a.id);
    if (turn) {
      const paying = preview.state.assignments.find((x) => x.makeUpTurnId === turn.id);
      const payEvent = paying && preview.state.events.find((e) => e.id === paying.eventId);
      const debtor = firstName(nameOf(state, turn.debtorId, me));
      if (payEvent) {
        makeUpDate = dateIn(payEvent.startsAt, viewerTimeZone);
        makeUp = `Pay It Back: ${debtor} will owe you a Make-up Turn. They'll take your ${r} turn on ${formatDayShort(makeUpDate)}.`;
      } else {
        makeUp = `Pay It Back: ${debtor} will owe you a Make-up Turn. They'll take your next ${r} turn.`;
      }
    } else if (state.settings.coveragePolicy === 'countRealWork') {
      makeUp = `${ctx.groupName} uses Count Real Work, so no Make-up Turn is owed.`;
    }
  }

  return {
    overline: ctx.groupName,
    title: requesterName ? `Cover ${r} for ${requesterName}?` : `Cover ${r}?`,
    date: dateIn(event.startsAt, viewerTimeZone),
    startsAt: event.startsAt,
    workloadNote: `Thank you! Covering counts toward your workload in ${ctx.groupName}.`,
    makeUp,
    makeUpDate,
    problem: preview.ok ? null : preview.reason,
    reason: a.coverageRequest?.note ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mark covered sheet

export type MarkCoveredOption = {
  memberId: MemberId;
  name: string;
  /** "Already at this Event", "On the Sound team" or "Group Member". */
  detail: string;
  disabled: boolean;
};

export type MarkCoveredSheetView = {
  overline: string;
  title: string;
  message: string;
  options: MarkCoveredOption[];
  guestNote: string;
};

/** Whether the Member already holds a seat at the Assignment's Event that blocks this one (engine `seatConflict`). */
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

export function markCoveredSheetView(ctx: SheetContext, assignmentId: string): MarkCoveredSheetView | null {
  const { state, me, viewerTimeZone } = ctx;
  const f = found(state, assignmentId);
  if (!f) return null;
  const { assignment: a, event, responsibilityName: r } = f;
  const requester = a.coverageRequest?.requestedBy ?? null;
  const queue = state.rotations.find((x) => x.responsibilityId === a.responsibilityId)?.queue ?? [];
  const options = state.members
    .filter((m) => m.leftAt === null && m.id !== requester)
    .map((m) => {
      const busy = atEventAlready(state, a, m.id);
      const qualified = queue.includes(m.id);
      return {
        memberId: m.id,
        name: m.id === me ? 'You' : m.name,
        detail: busy ? 'Already at this Event' : qualified ? `On the ${r} team` : 'Group Member',
        disabled: busy,
        qualified,
      };
    })
    .sort(
      (x, y) =>
        Number(x.disabled) - Number(y.disabled) ||
        Number(y.qualified) - Number(x.qualified) ||
        x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }),
    )
    .map(({ qualified: _q, ...o }) => o);
  return {
    overline: `${ctx.groupName} · ${formatDayShort(dateIn(event.startsAt, viewerTimeZone))}`,
    title: `Who's covering ${r}?`,
    message: 'Pick anyone in the group, or record someone from outside it.',
    options,
    guestNote: 'A Guest Cover is recorded by name only. It counts toward no one’s workload and creates no Make-up Turn.',
  };
}

// ---------------------------------------------------------------------------
// The coverage panel on the Assignment screen

export type CoveragePanelView = {
  headline: string;
  detail: string;
  /** Names of the team Members asked. */
  asked: string[];
  /** The Coverage Request's reason, shown quoted beside the pill (prototype). */
  reason: string | null;
};

/**
 * The panel under an open Coverage Request (prototype `screenAssignment` coverage card):
 * who can't make it, who was asked, and who is finding a replacement once the deadline passes.
 */
export function coveragePanelView(
  state: GroupState,
  assignment: Assignment,
  eventStartsAt: Instant,
  me: MemberId | null,
  isAdmin: boolean,
  now: Instant,
): CoveragePanelView | null {
  const request = assignment.coverageRequest;
  if (!request || request.cover) return null;
  const r = state.responsibilities.find((x) => x.id === assignment.responsibilityId)?.name ?? 'this Responsibility';
  const requester = request.requestedBy;
  const iDeclined = me !== null && requester === me;
  const asked = qualifiedToAsk(state, assignment.responsibilityId, [requester]).map((id) => nameOf(state, id, me));
  const askedText = `Asked ${asked.length} ${asked.length === 1 ? 'person' : 'people'} on the ${r} team`;
  const holder = replacementDutyHolder(assignment, eventStartsAt, state.settings, now);
  const reason = request.note ?? null;

  if (holder) {
    const admins = holder === 'admins';
    const holderText = admins ? 'the Admins' : iDeclined ? 'you' : firstName(nameOf(state, requester, me));
    const iHold = admins ? isAdmin : iDeclined;
    const headline = iHold
      ? 'Nobody’s free. Please find a replacement.'
      : `Nobody’s free. ${holderText[0].toUpperCase()}${holderText.slice(1)} ${admins ? 'are' : 'is'} finding a replacement.`;
    const informed = isAdmin && !iHold ? ' You’re informed; no action needed.' : '';
    return {
      headline,
      detail: `${askedText}; no one volunteered by the "find a replacement by" date. Replacement Duty is on ${holderText}.${informed}`,
      asked,
      reason,
    };
  }

  let headline: string;
  if (iDeclined) headline = 'We’re finding someone to cover you';
  else if (requester === null) headline = request.reason === 'timeOff' ? 'Needs a volunteer' : 'No one is available yet';
  else headline = `${firstName(nameOf(state, requester, me))} can’t make it`;
  return {
    headline,
    detail: `${askedText}. The first to accept gets it. We’ll remind them once more before the Event.`,
    asked,
    reason,
  };
}

// ---------------------------------------------------------------------------
// After an action

export type DoneAction = 'confirm' | 'decline' | 'withdrawCover' | 'withdrawDecline' | 'cover' | 'markCovered';

/** The inline confirmation after an action worked, e.g. "Confirmed Sound for Sun, Nov 22. Thank you!". */
export function successMessage(
  action: DoneAction,
  responsibilityName: string,
  date: string,
  coveredBy?: string,
): string {
  const day = formatDayShort(date);
  switch (action) {
    case 'confirm':
      return `Confirmed ${responsibilityName} for ${day}. Thank you!`;
    case 'decline':
      return `Coverage Request sent. We’re asking the ${responsibilityName} team to cover ${day}.`;
    case 'withdrawDecline':
      return `You’re back on ${responsibilityName} for ${day}. The Coverage Request is withdrawn.`;
    case 'withdrawCover':
      return `You’re no longer covering ${responsibilityName} on ${day}. The Coverage Request is open again.`;
    case 'cover':
      return `You’re covering ${responsibilityName} on ${day}. Thank you!`;
    case 'markCovered':
      return `Marked covered by ${coveredBy ?? 'them'}.`;
  }
}

/**
 * Who covered an Assignment, for "Already covered by Cal" after losing a Cover race.
 * Null when it isn't covered (any more).
 */
export function coveredByName(state: GroupState, assignmentId: string, me: MemberId | null): string | null {
  const cover = state.assignments.find((a) => a.id === assignmentId)?.coverageRequest?.cover;
  if (!cover) return null;
  if (cover.kind === 'guest') return `${cover.guestName} (guest)`;
  return nameOf(state, cover.memberId, me, 'you');
}
