/**
 * What Home shows (ticket 12), derived from the person's Groups: the greeting, the "Your next
 * Assignment" hero, "Needs your attention", the "Your groups" cards (with Admin-only health
 * stats) and their filters.
 *
 * Pure TypeScript: no React, Supabase or clock reads (callers pass `now` and the viewer's
 * time zone), so it is unit-tested under Node. It builds on the schedule views
 * (src/schedule/views.ts) and the coverage rules (src/coverage/actions.ts).
 */
import { assignmentActions, isOpenRequest } from '../coverage/actions';
import { firstName, qualifiedToAsk } from '../coverage/sheets';
import { replacementDutyHolder } from '../engine/status';
import type { Assignment, Event, GroupState, Instant, MemberId } from '../engine/types';
import { localTime } from '../schedule/expandSeries';
import {
  dateIn,
  formatDayLong,
  formatDayShort,
  formatMonthDay,
  formatTimeIn,
  groupZoneNote,
  relativeDay,
} from '../schedule/format';
import { movedNotice, type HistoryContext, type HistoryRecord } from '../schedule/history';
import { eventView, nextEvent, type DisplayStatus, type EventView, type ScheduleGroup, type SlotView } from '../schedule/views';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Pending in the next 3 weeks" on an Admin's group card. */
export const PENDING_WINDOW_DAYS = 21;
/** "Recent changes" on an Admin's group card: the last 7 days of schedule history. */
export const RECENT_CHANGES_DAYS = 7;

// ---------------------------------------------------------------------------
// Inputs

/** One of the person's Groups as Home sees it: the schedule plus recent history. */
export type HomeGroup = ScheduleGroup & {
  /**
   * Recent schedule history (any order), for "moved" notices and the Admin's "recent
   * changes". Routine entries (the schedule filled, Events added by the daily job) may be
   * left out by the caller.
   */
  history: HistoryRecord[];
};

export type HomeContext = {
  now: Instant;
  viewerTimeZone: string;
  /**
   * The person's reminder settings as a sentence (notificationPrefs' reminderSummary), for the
   * hero's "You're all set." line. Defaults to "We'll remind you before the Event."
   */
  reminderText?: string;
};

function me(group: ScheduleGroup) {
  return group.state.members.find((m) => m.id === group.myMemberId && m.leftAt === null) ?? null;
}

/** The viewer is an Admin of the Group. */
export function isAdminOf(group: ScheduleGroup): boolean {
  return me(group)?.isAdmin ?? false;
}

function qualifiedFor(state: GroupState, memberId: MemberId | null, responsibilityId: string): boolean {
  if (memberId === null) return false;
  return state.rotations.find((r) => r.responsibilityId === responsibilityId)?.queue.includes(memberId) ?? false;
}

function requiresConfirmation(state: GroupState, responsibilityId: string): boolean {
  return state.responsibilities.find((r) => r.id === responsibilityId)?.requiresConfirmation ?? false;
}

const started = (startsAt: Instant, now: Instant) => Date.parse(startsAt) <= Date.parse(now);

/** "9:00 AM", plus "(10:00 AM Chicago time)" when the Group's clock reads differently. */
export function timeText(startsAt: Instant, groupTimeZone: string, viewerTimeZone: string): string {
  const note = groupZoneNote(startsAt, groupTimeZone, viewerTimeZone);
  return `${formatTimeIn(startsAt, viewerTimeZone)}${note ? ` (${note})` : ''}`;
}

/** "AR" for "Alex Rivera", "B" for "Ben". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Every upcoming Assignment seat of the Group, with its Event, soonest first. */
function upcomingSlots(group: ScheduleGroup, ctx: HomeContext): { event: EventView; slot: SlotView; assignment: Assignment }[] {
  const out: { event: EventView; slot: SlotView; assignment: Assignment }[] = [];
  const byId = new Map(group.state.assignments.map((a) => [a.id, a]));
  for (const e of group.state.events) {
    if (e.skipDate || started(e.startsAt, ctx.now)) continue;
    const view = eventView(group, e, ctx.now, ctx.viewerTimeZone);
    for (const slot of view.slots) {
      const assignment = byId.get(slot.assignmentId);
      if (assignment) out.push({ event: view, slot, assignment });
    }
  }
  return out.sort((a, b) => Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt));
}

function historyContext(group: HomeGroup, ctx: HomeContext): HistoryContext {
  return { state: group.state, myMemberId: group.myMemberId, timeZone: ctx.viewerTimeZone };
}

/** The Make-up Turn an Assignment pays: who covered the viewer, and on which date. */
function makeUpTurnPaid(state: GroupState, assignment: Assignment, viewerTimeZone: string) {
  const turn = assignment.makeUpTurnId ? state.makeUpTurns.find((t) => t.id === assignment.makeUpTurnId) : undefined;
  if (!turn) return null;
  const creditor = state.members.find((m) => m.id === turn.creditorId)?.name ?? 'Someone';
  const covered = state.assignments.find((a) => a.id === turn.coverAssignmentId);
  const event = covered && state.events.find((e) => e.id === covered.eventId);
  return { creditor: firstName(creditor), coverDate: event ? dateIn(event.startsAt, viewerTimeZone) : null };
}

/** "Ben covered you on Nov 22, so you're taking Ben's turn." */
function makeUpSentence(paid: { creditor: string; coverDate: string | null }, tail: string): string {
  const on = paid.coverDate ? ` on ${formatMonthDay(paid.coverDate)}` : '';
  return `${paid.creditor} covered you${on}, so ${tail}`;
}

// ---------------------------------------------------------------------------
// Greeting

/** "Good morning, Alex" (by the viewer's clock), or without a name when there is none. */
export function greeting(name: string | null | undefined, ctx: HomeContext): string {
  const hour = Number(localTime(ctx.now, ctx.viewerTimeZone).slice(0, 2));
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name ? firstName(name) : '';
  return first ? `${part}, ${first}` : part;
}

/** "Monday, November 16": today in the viewer's time zone. */
export function todayLabel(ctx: HomeContext): string {
  return formatDayLong(dateIn(ctx.now, ctx.viewerTimeZone));
}

// ---------------------------------------------------------------------------
// Hero: "Your next Assignment"

export type HeroMode =
  /** Pending (or Unconfirmed): Confirm / Can't make it. */
  | 'confirm'
  /** Confirmed, covering, or no confirmation needed: "You're all set". */
  | 'allSet'
  /** Needs confirmation later: "Nothing to do yet". */
  | 'later';

export type HeroView = {
  key: string;
  groupId: string;
  groupName: string;
  assignmentId: string;
  responsibilityName: string;
  date: string;
  /** "Sunday, November 22". */
  dateLabel: string;
  /** "9:00 AM", with the Group's time when it differs. */
  timeLabel: string;
  /** "In 6 days". */
  relative: string;
  status: DisplayStatus;
  /** "You're covering" instead of the status label. */
  pillLabel: string | null;
  /** Everyone else serving at that Event (first names), for the "With …" line. */
  with: { name: string; initials: string }[];
  /** "With Ben, Cal & 1 more", or null. */
  withLabel: string | null;
  /** Moved and Make-up Turn notes. */
  notes: string[];
  makeUpTurn: boolean;
  mode: HeroMode;
  /** The line next to the check mark when there's nothing to answer. */
  doneText: string;
};

/** "With Ben", "With Ben, Cal", "With Ben, Cal & 2 more". */
export function withLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `With ${shown} & ${names.length - 2} more` : `With ${shown}`;
}

type Candidate = { group: HomeGroup; event: EventView; slot: SlotView; assignment: Assignment };

/**
 * The viewer's own upcoming Assignments (including ones they cover), soonest first. Their
 * open Coverage Requests are left out: they aren't serving those unless someone covers.
 */
function myUpcoming(groups: HomeGroup[], ctx: HomeContext): Candidate[] {
  const out: Candidate[] = [];
  for (const group of groups) {
    if (!group.myMemberId) continue;
    for (const s of upcomingSlots(group, ctx)) {
      if (s.slot.mine && !isOpenRequest(s.assignment)) out.push({ group, ...s });
    }
  }
  return out.sort(
    (a, b) =>
      Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt) ||
      a.group.name.localeCompare(b.group.name) ||
      a.slot.key.localeCompare(b.slot.key),
  );
}

function awaitingConfirmation(c: Candidate, ctx: HomeContext): boolean {
  return (
    assignmentActions({
      assignment: c.assignment,
      eventStartsAt: c.event.startsAt,
      requiresConfirmation: requiresConfirmation(c.group.state, c.assignment.responsibilityId),
      qualified: qualifiedFor(c.group.state, c.group.myMemberId, c.assignment.responsibilityId),
      me: c.group.myMemberId,
      isAdmin: isAdminOf(c.group),
      settings: c.group.state.settings,
      now: ctx.now,
    }).state === 'minePending'
  );
}

/** The viewer's next Assignment across all their Groups, or null when nothing is coming up. */
export function selectHero(groups: HomeGroup[], ctx: HomeContext): HeroView | null {
  const next = myUpcoming(groups, ctx)[0];
  if (!next) return null;
  const { group, event, slot, assignment } = next;
  const today = dateIn(ctx.now, ctx.viewerTimeZone);
  const others = event.slots
    .filter((s) => s.assignmentId !== slot.assignmentId)
    .flatMap((s) => {
      if (s.who.kind === 'member' && !s.who.isMe) return [s.who.name];
      if (s.who.kind === 'guest') return [s.who.name];
      return [];
    });
  const unique = [...new Set(others)];

  const notes: string[] = [];
  const moved = movedNotice(group.history, slot.assignmentId, historyContext(group, ctx));
  if (moved) notes.push(moved);
  const paid = makeUpTurnPaid(group.state, assignment, ctx.viewerTimeZone);
  if (paid) notes.push(`Make-up Turn: ${makeUpSentence(paid, `you're taking ${paid.creditor}'s turn.`)}`);

  const mode: HeroMode = awaitingConfirmation(next, ctx)
    ? 'confirm'
    : slot.status === 'scheduled' && requiresConfirmation(group.state, assignment.responsibilityId) && assignment.confirmation === 'notYetRequested'
      ? 'later'
      : 'allSet';
  const doneText =
    mode === 'later'
      ? "Nothing to do yet. We'll ask you to confirm closer to the Event."
      : `You're all set. ${ctx.reminderText ?? "We'll remind you before the Event."}`;

  return {
    key: slot.key,
    groupId: group.id,
    groupName: group.name,
    assignmentId: slot.assignmentId,
    responsibilityName: slot.responsibilityName,
    date: event.date,
    dateLabel: formatDayLong(event.date),
    timeLabel: timeText(event.startsAt, group.timeZone, ctx.viewerTimeZone),
    relative: relativeDay(event.date, today),
    status: slot.status,
    pillLabel: slot.covering ? "You're covering" : null,
    with: unique.map((name) => ({ name: firstName(name), initials: initialsOf(name) })),
    withLabel: withLabel(unique.map(firstName)),
    notes,
    makeUpTurn: slot.makeUpTurn,
    mode,
    doneText,
  };
}

// ---------------------------------------------------------------------------
// Needs your attention

export type AttentionKind =
  /** Replacement Duty is mine: nobody covered by the deadline. */
  | 'replacementDuty'
  /** Someone's Coverage Request I'm Qualified to cover. */
  | 'cover'
  /** My own open Coverage Request. */
  | 'myRequest'
  /** A Make-up Turn waiting for my confirmation. */
  | 'makeUp'
  /** My Assignment moved and needs confirming again. */
  | 'moved'
  /** Any other Assignment waiting for my confirmation. */
  | 'confirm';

export type AttentionActionKind = 'cover' | 'markCovered' | 'confirm' | 'decline' | 'details' | 'viewRequest' | 'withdraw';

export type AttentionAction = {
  kind: AttentionActionKind;
  label: string;
  variant: 'primary' | 'positive' | 'secondary' | 'quiet';
};

export type AttentionTone = 'bad' | 'warn' | 'info';
export type AttentionIcon = 'alert' | 'repeat' | 'send' | 'clock' | 'calendar' | 'handshake';

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  tone: AttentionTone;
  icon: AttentionIcon;
  title: string;
  sub: string;
  groupId: string;
  groupName: string;
  assignmentId: string;
  responsibilityName: string;
  startsAt: Instant;
  date: string;
  actions: AttentionAction[];
};

/** Same-day order: the most urgent kind first. */
const KIND_RANK: Record<AttentionKind, number> = {
  replacementDuty: 0,
  cover: 1,
  myRequest: 2,
  makeUp: 3,
  moved: 4,
  confirm: 5,
};

const A = {
  details: { kind: 'details', label: 'Details', variant: 'secondary' },
  cover: { kind: 'cover', label: 'I can cover', variant: 'primary' },
  markCovered: { kind: 'markCovered', label: 'Mark covered', variant: 'primary' },
  confirm: { kind: 'confirm', label: 'Confirm', variant: 'positive' },
  decline: { kind: 'decline', label: "Can't make it", variant: 'secondary' },
  viewRequest: { kind: 'viewRequest', label: 'View request', variant: 'secondary' },
  withdraw: { kind: 'withdraw', label: 'I can make it after all', variant: 'quiet' },
} as const satisfies Record<string, AttentionAction>;

export type AttentionOptions = {
  /** The hero's key: its Confirm is on the hero, so it isn't repeated here. */
  heroKey?: string | null;
  /** The server can take back a Decline (`withdrawDecline`): offer "I can make it after all" on my own Declines. */
  canWithdraw?: boolean;
};

/**
 * Everything waiting on the viewer, soonest Event first: Replacement Duty they hold, Coverage
 * Requests they can cover, their own open requests, and their Assignments awaiting
 * confirmation (Make-up Turns and moved ones called out). One item per Assignment.
 */
export function attentionItems(groups: HomeGroup[], ctx: HomeContext, options: AttentionOptions = {}): AttentionItem[] {
  const items: (AttentionItem & { order: number })[] = [];
  let order = 0;
  for (const group of groups) {
    const meId = group.myMemberId;
    if (!meId || !me(group)) continue;
    const admin = isAdminOf(group);
    const hctx = historyContext(group, ctx);
    const today = dateIn(ctx.now, ctx.viewerTimeZone);
    const slots = upcomingSlots(group, ctx);
    const mySeatAt = new Set(slots.filter((s) => s.slot.mine && !isOpenRequest(s.assignment)).map((s) => s.event.eventId));

    for (const { event, slot, assignment } of slots) {
      const base = {
        key: `${slot.key}`,
        groupId: group.id,
        groupName: group.name,
        assignmentId: slot.assignmentId,
        responsibilityName: slot.responsibilityName,
        startsAt: event.startsAt,
        date: event.date,
      };
      const day = formatDayShort(event.date);
      const rel = relativeDay(event.date, today).toLowerCase();
      const r = slot.responsibilityName;
      const push = (item: Omit<AttentionItem, keyof typeof base>) => items.push({ ...base, ...item, order: order++ });

      if (isOpenRequest(assignment)) {
        const request = assignment.coverageRequest!;
        const requester = request.requestedBy ?? assignment.turnOf;
        const iAsked = requester === meId;
        const holder = replacementDutyHolder(assignment, event.startsAt, group.state.settings, ctx.now);
        const iHoldDuty = (holder === 'assignedMember' && iAsked) || (holder === 'admins' && admin);
        const withdraw = options.canWithdraw && iAsked && request.reason === 'declined' ? [A.withdraw] : [];
        const requesterName = firstName(group.state.members.find((m) => m.id === requester)?.name ?? 'Someone');
        if (iHoldDuty) {
          push({
            kind: 'replacementDuty',
            tone: 'bad',
            icon: 'alert',
            title: iAsked ? `Nobody's free for your ${r} turn` : `Nobody's free for ${r} (${requesterName})`,
            sub: `${group.name} · ${day} · ${rel}. No one volunteered in time, so please find a replacement.`,
            actions: [A.markCovered, A.details, ...withdraw],
          });
        } else if (iAsked) {
          const asked = qualifiedToAsk(group.state, assignment.responsibilityId, [meId]).length;
          push({
            kind: 'myRequest',
            tone: 'warn',
            icon: 'send',
            title: `Finding cover for your ${r}`,
            sub: `${group.name} · ${day} · ${asked} ${asked === 1 ? 'person' : 'people'} asked · nobody yet`,
            actions: [A.viewRequest, ...withdraw],
          });
        } else if (
          qualifiedFor(group.state, meId, assignment.responsibilityId) &&
          (group.state.settings.allowDoubling || !mySeatAt.has(event.eventId))
        ) {
          push({
            kind: 'cover',
            tone: 'bad',
            icon: 'repeat',
            title: `${requesterName} needs someone for ${r}`,
            sub: `${group.name} · ${day}`,
            actions: [A.cover, A.details],
          });
        }
        continue;
      }

      if (!slot.mine || slot.key === options.heroKey) continue;
      if (!awaitingConfirmation({ group, event, slot, assignment }, ctx)) continue;
      const paid = makeUpTurnPaid(group.state, assignment, ctx.viewerTimeZone);
      const moved = movedNotice(group.history, slot.assignmentId, hctx);
      if (paid) {
        push({
          kind: 'makeUp',
          tone: 'warn',
          icon: 'handshake',
          title: 'Confirm your Make-up Turn',
          sub: `${group.name} · ${makeUpSentence(paid, `you'll take ${paid.creditor}'s ${r} turn on ${day}.`)}`,
          actions: [A.confirm, A.decline],
        });
      } else if (moved) {
        push({
          kind: 'moved',
          tone: 'warn',
          icon: 'calendar',
          title: `Your ${r} turn moved`,
          sub: `${group.name} · ${moved} Please confirm again.`,
          actions: [A.confirm, A.decline],
        });
      } else {
        push({
          kind: 'confirm',
          tone: 'warn',
          icon: 'clock',
          title: `Confirm ${r} for ${group.name}`,
          sub: `${day} · ${rel}`,
          actions: [A.confirm, A.decline],
        });
      }
    }
  }
  return items
    .sort(
      (a, b) =>
        Date.parse(a.startsAt) - Date.parse(b.startsAt) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.order - b.order,
    )
    .map(({ order: _order, ...item }) => item);
}

// ---------------------------------------------------------------------------
// Your groups

export type GroupHealth = {
  /** Open Coverage Requests on upcoming Events (including ones past the deadline). */
  openCoverage: number;
  /** Of those, the ones past the "find a replacement by" deadline. */
  findingReplacement: number;
  /** Assignments awaiting confirmation at Events in the next 3 weeks. */
  pendingSoon: number;
  /** Schedule history entries in the last 7 days (routine ones left out). */
  recentChanges: number;
  /** Upcoming Skip Dates (civil dates in the viewer's zone), soonest first. */
  skipDates: string[];
  /** Something for an Admin to look at: open coverage or pending confirmations. */
  needsAttention: boolean;
};

/** History entries that don't count as "changes": the schedule filling itself in. */
export function isRoutineHistory(entry: Pick<HistoryRecord, 'cause' | 'actorId'>): boolean {
  return entry.cause.type === 'fillSchedule' || (entry.cause.type === 'addEvents' && entry.actorId === null);
}

/** An Admin's health stats for one Group. */
export function groupHealth(group: HomeGroup, ctx: HomeContext): GroupHealth {
  const t = Date.parse(ctx.now);
  let openCoverage = 0;
  let findingReplacement = 0;
  let pendingSoon = 0;
  for (const { event, slot } of upcomingSlots(group, ctx)) {
    if (slot.status === 'needsCoverage' || slot.status === 'findReplacement') openCoverage++;
    if (slot.status === 'findReplacement') findingReplacement++;
    if (slot.status === 'pending' && Date.parse(event.startsAt) - t <= PENDING_WINDOW_DAYS * DAY_MS) pendingSoon++;
  }
  const since = t - RECENT_CHANGES_DAYS * DAY_MS;
  const recentChanges = group.history.filter((h) => {
    const at = Date.parse(h.at);
    return at >= since && at <= t && !isRoutineHistory(h);
  }).length;
  const skipDates = group.state.events
    .filter((e: Event) => e.skipDate && !started(e.startsAt, ctx.now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((e) => dateIn(e.startsAt, ctx.viewerTimeZone));
  return {
    openCoverage,
    findingReplacement,
    pendingSoon,
    recentChanges,
    skipDates,
    needsAttention: openCoverage + pendingSoon > 0,
  };
}

/** "Skip Nov 26, Dec 27" (at most `max` dates, then "+N"), or "No Skip Dates". */
export function skipDatesLabel(dates: string[], max = 2): string {
  if (dates.length === 0) return 'No Skip Dates';
  const shown = dates.slice(0, max).map((d) => formatMonthDay(d));
  return `Skip ${shown.join(', ')}${dates.length > max ? ` +${dates.length - max}` : ''}`;
}

export type GroupCardView = {
  groupId: string;
  name: string;
  isAdmin: boolean;
  /** "Sun, Nov 22 · Worship Lead: Ben", "Sun, Nov 22", or "No upcoming Events". */
  nextLine: string;
  /** The viewer's next turn here, or null ("No turns soon"). */
  myNext: { label: string; status: DisplayStatus; pillLabel: string | null } | null;
  /** Admins only; null for a regular Member (Members never see group health). */
  health: GroupHealth | null;
};

/** One card per Group, by name. */
export function groupCards(groups: HomeGroup[], ctx: HomeContext): GroupCardView[] {
  return [...groups]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .map((group) => {
      const admin = isAdminOf(group);
      const next = nextEvent(group, ctx.now, ctx.viewerTimeZone);
      let nextLine = 'No upcoming Events';
      if (next) {
        const primaryId = group.state.primaryResponsibilityId;
        const primary = group.state.responsibilities.find((r) => r.id === primaryId && r.removedAt === null);
        const holders = primary ? next.slots.filter((s) => s.responsibilityId === primary.id).map((s) => s.whoLabel) : [];
        nextLine = primary && holders.length
          ? `${formatDayShort(next.date)} · ${primary.name}: ${holders.join(', ')}`
          : formatDayShort(next.date);
      }
      const mine = upcomingSlots(group, ctx).find((s) => s.slot.mine);
      return {
        groupId: group.id,
        name: group.name,
        isAdmin: admin,
        nextLine,
        myNext: mine
          ? {
              label: `You · ${formatMonthDay(mine.event.date)}`,
              status: mine.slot.status,
              pillLabel: mine.slot.covering ? 'Covering' : null,
            }
          : null,
        health: admin ? groupHealth(group, ctx) : null,
      };
    });
}

export type GroupFilter = 'all' | 'managed' | 'attention';

/** The filter chips show only to someone who administers at least one Group. */
export function showGroupFilters(cards: GroupCardView[]): boolean {
  return cards.some((c) => c.isAdmin);
}

export function filterGroupCards(cards: GroupCardView[], filter: GroupFilter): GroupCardView[] {
  if (filter === 'managed') return cards.filter((c) => c.isAdmin);
  if (filter === 'attention') return cards.filter((c) => c.isAdmin && c.health?.needsAttention);
  return cards;
}

export function groupFilterCounts(cards: GroupCardView[]): Record<GroupFilter, number> {
  return {
    all: cards.length,
    managed: filterGroupCards(cards, 'managed').length,
    attention: filterGroupCards(cards, 'attention').length,
  };
}

/** A filter from the URL, falling back to All (and to All for someone who manages nothing). */
export function parseGroupFilter(value: string | undefined, cards: GroupCardView[]): GroupFilter {
  if (!showGroupFilters(cards)) return 'all';
  return value === 'managed' || value === 'attention' ? value : 'all';
}
