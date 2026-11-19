/**
 * What Home shows (simplify ticket 05), derived from the person's Groups: only the next
 * 7 days. The big card is the viewer's first turn this week; under it "Needs you" (covers they
 * can take and anything waiting on them, this week only) and "This week" (their other turns).
 * With nothing due, a calm card names their next turn. Then "Your groups": one card per Group
 * with the viewer's next turn there.
 *
 * Pure TypeScript: no React, Supabase or clock reads (callers pass `now` and the viewer's
 * time zone), so it is unit-tested under Node. It builds on the schedule views
 * (src/schedule/views.ts) and the coverage rules (src/coverage/actions.ts).
 */
import { assignmentActions, isOpenRequest } from '../coverage/actions';
import { firstName, qualifiedToAsk } from '../coverage/sheets';
import { replacementDutyHolder } from '../engine/status';
import type { Assignment, GroupState, HeadcountReply, Instant, MemberId } from '../engine/types';
import { localTime } from '../schedule/expandSeries';
import {
  dateIn,
  daysBetween,
  formatDayLong,
  formatDayShort,
  formatMonthDay,
  formatTimeIn,
  groupZoneNote,
  relativeDay,
} from '../schedule/format';
import {
  answerOf,
  headcountCounts,
  headcountText,
  upcomingHeadcounts,
  type HeadcountCounts,
  type HeadcountDate,
} from '../schedule/headcount';
import { movedNotice, type HistoryContext, type HistoryRecord } from '../schedule/history';
import { eventView, type EventView, type ScheduleGroup, type SlotView } from '../schedule/views';

/** Home looks this many days ahead (today plus the next 7, like the prototype's `WEEK`). */
export const HOME_DAYS = 7;

// ---------------------------------------------------------------------------
// Inputs

/** One of the person's Groups as Home sees it: the schedule plus recent history. */
export type HomeGroup = ScheduleGroup & {
  /** Recent schedule history (any order), for "moved" items in "Needs you". */
  history: HistoryRecord[];
};

export type HomeContext = {
  now: Instant;
  viewerTimeZone: string;
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

const todayOf = (ctx: HomeContext) => dateIn(ctx.now, ctx.viewerTimeZone);

/** The date (in the viewer's zone) falls in Home's window: today through 7 days from now. */
export function inHomeWindow(date: string, today: string): boolean {
  const n = daysBetween(today, date);
  return n >= 0 && n <= HOME_DAYS;
}

type Slot = { event: EventView; slot: SlotView; assignment: Assignment };

/** Every upcoming seat of the Group, with its Event, soonest first. */
function upcomingSlots(group: ScheduleGroup, ctx: HomeContext): Slot[] {
  const out: Slot[] = [];
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

/** The swap a turn pays back: who covered the viewer, and on which date. */
function swapPaid(state: GroupState, assignment: Assignment, viewerTimeZone: string) {
  const turn = assignment.makeUpTurnId ? state.makeUpTurns.find((t) => t.id === assignment.makeUpTurnId) : undefined;
  if (!turn) return null;
  const creditor = state.members.find((m) => m.id === turn.creditorId)?.name ?? 'Someone';
  const covered = state.assignments.find((a) => a.id === turn.coverAssignmentId);
  const event = covered && state.events.find((e) => e.id === covered.eventId);
  return { creditor: firstName(creditor), coverDate: event ? dateIn(event.startsAt, viewerTimeZone) : null };
}

/** "Ben covered you on Nov 22, so you're taking Ben's turn." */
function swapSentence(paid: { creditor: string; coverDate: string | null }, tail: string): string {
  const on = paid.coverDate ? ` on ${formatMonthDay(paid.coverDate)}` : '';
  return `${paid.creditor} covered you${on}, so ${tail}`;
}

// ---------------------------------------------------------------------------
// Header

/** "Good morning, Alex" (by the viewer's clock), or without a name when there is none. */
export function greeting(name: string | null | undefined, ctx: HomeContext): string {
  const hour = Number(localTime(ctx.now, ctx.viewerTimeZone).slice(0, 2));
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name ? firstName(name) : '';
  return first ? `${part}, ${first}` : part;
}

/** "Monday, November 16": today in the viewer's time zone. */
export function todayLabel(ctx: HomeContext): string {
  return formatDayLong(todayOf(ctx));
}

// ---------------------------------------------------------------------------
// The viewer's turns

/** One of the viewer's turns, as the big card and the "This week" rows show it. */
export type TurnView = {
  /** `${groupId}/${assignmentId}`. */
  key: string;
  groupId: string;
  groupName: string;
  assignmentId: string;
  /** The Job's name. */
  responsibilityName: string;
  /** The civil date in the viewer's zone. */
  date: string;
  startsAt: Instant;
  /** "Sun, Nov 22". */
  dayLabel: string;
  /** "9:00 AM", with the Group's time when it differs. */
  timeLabel: string;
  /** "Today", "Tomorrow", "In 4 days". */
  relative: string;
  /** The viewer asked for cover and nobody has taken it yet. */
  needsCover: boolean;
  /** The viewer is covering someone else's turn. */
  covering: boolean;
  /**
   * Set for a date of a headcount job (ticket 09): not a turn (`assignmentId` is empty), but
   * a "Coming?" question with the viewer's answer and the group's counts.
   */
  headcount?: HeadcountView;
};

export type HeadcountView = {
  eventId: string;
  responsibilityId: string;
  answer: HeadcountReply | null;
  counts: HeadcountCounts;
  /** "2 coming · 0 not · 3 no reply". */
  summary: string;
};

export type HeroMode =
  /** The usual: one red "Can't make it". */
  | 'cantMakeIt'
  /** A Job that still asks for confirmation (older groups): Confirm / Can't make it. */
  | 'confirm'
  /** The viewer asked for cover: "Needs cover. We'll tell you when someone takes it." */
  | 'needsCover'
  /** A headcount date (ticket 09) not answered yet: green Yes / red No. */
  | 'headcount';

export type HeroNote = { tone: 'ok' | 'warn'; strong?: string; text: string };

/** The big navy card: the viewer's first turn in the next 7 days. */
export type HeroView = TurnView & {
  mode: HeroMode;
  /** One short line under the date ("You're covering for Ben. Thank you!"), or null. */
  note: HeroNote | null;
};

type Mine = Slot & { group: HomeGroup };

/**
 * The viewer's own upcoming turns across their Groups (including ones they cover and ones
 * they asked cover for), soonest first.
 */
function myTurns(groups: HomeGroup[], ctx: HomeContext): Mine[] {
  const out: Mine[] = [];
  for (const group of groups) {
    if (!group.myMemberId || !me(group)) continue;
    for (const s of upcomingSlots(group, ctx)) if (s.slot.mine) out.push({ group, ...s });
  }
  return out.sort(
    (a, b) =>
      Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt) ||
      a.group.name.localeCompare(b.group.name) ||
      a.slot.key.localeCompare(b.slot.key),
  );
}

function turnView(m: Mine, ctx: HomeContext): TurnView {
  const { group, event, slot, assignment } = m;
  return {
    key: slot.key,
    groupId: group.id,
    groupName: group.name,
    assignmentId: slot.assignmentId,
    responsibilityName: slot.responsibilityName,
    date: event.date,
    startsAt: event.startsAt,
    dayLabel: formatDayShort(event.date),
    timeLabel: timeText(event.startsAt, group.timeZone, ctx.viewerTimeZone),
    relative: relativeDay(event.date, todayOf(ctx)),
    needsCover: isOpenRequest(assignment),
    covering: slot.covering,
  };
}

type MyHeadcount = { group: HomeGroup; date: HeadcountDate };

/** Every upcoming headcount date in the viewer's Groups: each one asks them "Coming?". */
function myHeadcounts(groups: HomeGroup[], ctx: HomeContext): MyHeadcount[] {
  const out: MyHeadcount[] = [];
  for (const group of groups) {
    if (!group.myMemberId || !me(group)) continue;
    for (const date of upcomingHeadcounts(group.state, ctx.now)) out.push({ group, date });
  }
  return out;
}

function headcountTurnView(h: MyHeadcount, ctx: HomeContext): TurnView {
  const { group, date: d } = h;
  const date = dateIn(d.startsAt, ctx.viewerTimeZone);
  const counts = headcountCounts(group.state, d.eventId, d.responsibilityId);
  return {
    key: `${group.id}/hc:${d.eventId}:${d.responsibilityId}`,
    groupId: group.id,
    groupName: group.name,
    assignmentId: '',
    responsibilityName: d.jobName,
    date,
    startsAt: d.startsAt,
    dayLabel: formatDayShort(date),
    timeLabel: timeText(d.startsAt, group.timeZone, ctx.viewerTimeZone),
    relative: relativeDay(date, todayOf(ctx)),
    needsCover: false,
    covering: false,
    headcount: {
      eventId: d.eventId,
      responsibilityId: d.responsibilityId,
      answer: answerOf(group.state, d.eventId, d.responsibilityId, group.myMemberId),
      counts,
      summary: headcountText(counts),
    },
  };
}

function awaitingConfirmation(m: Mine, ctx: HomeContext): boolean {
  return (
    assignmentActions({
      assignment: m.assignment,
      eventStartsAt: m.event.startsAt,
      requiresConfirmation: requiresConfirmation(m.group.state, m.assignment.responsibilityId),
      qualified: qualifiedFor(m.group.state, m.group.myMemberId, m.assignment.responsibilityId),
      me: m.group.myMemberId,
      isAdmin: isAdminOf(m.group),
      settings: m.group.state.settings,
      now: ctx.now,
    }).state === 'minePending'
  );
}

function heroView(m: Mine, ctx: HomeContext): HeroView {
  const turn = turnView(m, ctx);
  if (turn.needsCover) {
    return { ...turn, mode: 'needsCover', note: { tone: 'warn', strong: 'Needs cover.', text: "We'll tell you when someone takes it." } };
  }
  let note: HeroNote | null = null;
  const paid = swapPaid(m.group.state, m.assignment, ctx.viewerTimeZone);
  if (m.slot.covering && m.slot.coveredFor) {
    note = { tone: 'ok', text: `You're covering for ${firstName(m.slot.coveredFor)}. Thank you!` };
  } else if (paid) {
    note = { tone: 'ok', text: swapSentence(paid, `you're taking ${paid.creditor}'s turn.`) };
  }
  return { ...turn, mode: awaitingConfirmation(m, ctx) ? 'confirm' : 'cantMakeIt', note };
}

// ---------------------------------------------------------------------------
// Needs you

export type AttentionKind =
  /** Nobody took a cover in time and finding someone is now on me. */
  | 'replacementDuty'
  /** Someone's cover request I can take. */
  | 'cover'
  /** My own open cover request. */
  | 'myRequest'
  /** A swapped turn waiting for my confirmation. */
  | 'makeUp'
  /** My turn moved and needs confirming again. */
  | 'moved'
  /** Any other turn waiting for my confirmation. */
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
  cover: { kind: 'cover', label: "I'll cover", variant: 'primary' },
  markCovered: { kind: 'markCovered', label: 'Mark covered', variant: 'primary' },
  confirm: { kind: 'confirm', label: 'Confirm', variant: 'positive' },
  decline: { kind: 'decline', label: "Can't make it", variant: 'secondary' },
  viewRequest: { kind: 'viewRequest', label: 'View request', variant: 'secondary' },
  withdraw: { kind: 'withdraw', label: 'I can make it after all', variant: 'quiet' },
} as const satisfies Record<string, AttentionAction>;

export type AttentionOptions = {
  /** The big card's key: its turn is on the card, so it isn't repeated here. */
  heroKey?: string | null;
  /** The server can take back a "Can't make it" (`withdrawDecline`): offer "I can make it after all". */
  canWithdraw?: boolean;
};

/**
 * Everything waiting on the viewer, soonest date first (all dates; `homeWeek` keeps the next
 * 7 days): covers nobody took that are now on them, covers they can take, their own open
 * requests, and their turns awaiting confirmation. One item per turn.
 */
export function attentionItems(groups: HomeGroup[], ctx: HomeContext, options: AttentionOptions = {}): AttentionItem[] {
  const items: (AttentionItem & { order: number })[] = [];
  let order = 0;
  const today = todayOf(ctx);
  for (const group of groups) {
    const meId = group.myMemberId;
    if (!meId || !me(group)) continue;
    const admin = isAdminOf(group);
    const hctx = historyContext(group, ctx);
    const slots = upcomingSlots(group, ctx);
    const mySeatAt = new Set(slots.filter((s) => s.slot.mine && !isOpenRequest(s.assignment)).map((s) => s.event.eventId));

    for (const { event, slot, assignment } of slots) {
      const base = {
        key: slot.key,
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
        const requesterMember = group.state.members.find((m) => m.id === requester);
        const requesterName = firstName(requesterMember?.name ?? 'Someone');
        if (iHoldDuty) {
          push({
            kind: 'replacementDuty',
            tone: 'bad',
            icon: 'alert',
            title: iAsked
              ? `Nobody's free for your ${r} turn`
              : requesterMember
                ? `Nobody's free for ${r} (${requesterName})`
                : `${r} needs cover`,
            sub: `${group.name} · ${day} · ${rel}. No one offered in time, so please find someone.`,
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
            icon: 'alert',
            title: `${requesterName} can't make it`,
            sub: `${r} · ${day} · ${group.name}`,
            actions: [A.cover, A.details],
          });
        }
        continue;
      }

      if (!slot.mine || slot.key === options.heroKey) continue;
      const m: Mine = { group, event, slot, assignment };
      if (!awaitingConfirmation(m, ctx)) continue;
      const paid = swapPaid(group.state, assignment, ctx.viewerTimeZone);
      if (paid) {
        push({
          kind: 'makeUp',
          tone: 'warn',
          icon: 'handshake',
          title: 'Confirm your swapped turn',
          sub: `${group.name} · ${swapSentence(paid, `you'll take ${paid.creditor}'s ${r} turn on ${day}.`)}`,
          actions: [A.confirm, A.decline],
        });
      } else if (movedNotice(group.history, slot.assignmentId, hctx)) {
        push({
          kind: 'moved',
          tone: 'warn',
          icon: 'calendar',
          title: `Your ${r} turn moved`,
          sub: `${group.name} · Now ${day}. Please confirm again.`,
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
// The week

export type HomeWeek = {
  /** The big card: the viewer's first turn in the next 7 days, or null ("Nothing this week"). */
  hero: HeroView | null;
  /** "Needs you": only items dated in the next 7 days; empty means the section is hidden. */
  needsYou: AttentionItem[];
  /** "This week": the viewer's other turns in the next 7 days (not repeated from "Needs you"). */
  thisWeek: TurnView[];
  /** "Greeter · Welcome team · Sun, Nov 29": the viewer's next turn anywhere, or null. */
  nextTurn: string | null;
  /** No big card, but the week has dates already answered: "You're all set". */
  allSet: boolean;
};

export type HomeWeekOptions = Pick<AttentionOptions, 'canWithdraw'>;

type WeekEntry = { startsAt: Instant; date: string; groupName: string; turn?: Mine; headcount?: TurnView };

/** Everything above "Your groups" on Home. */
export function homeWeek(groups: HomeGroup[], ctx: HomeContext, options: HomeWeekOptions = {}): HomeWeek {
  const today = todayOf(ctx);
  const mine = myTurns(groups, ctx);
  const entries: WeekEntry[] = [
    ...mine.map((m) => ({ startsAt: m.event.startsAt, date: m.event.date, groupName: m.group.name, turn: m })),
    ...myHeadcounts(groups, ctx).map((h) => {
      const view = headcountTurnView(h, ctx);
      return { startsAt: view.startsAt, date: view.date, groupName: view.groupName, headcount: view };
    }),
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.groupName.localeCompare(b.groupName));
  const week = entries.filter((e) => inHomeWindow(e.date, today));
  // The big card: the first turn, or the first headcount the viewer hasn't answered yet.
  const first = week.find((e) => e.turn || e.headcount?.headcount?.answer === null) ?? null;
  const hero: HeroView | null = first?.turn
    ? heroView(first.turn, ctx)
    : first?.headcount
      ? { ...first.headcount, mode: 'headcount', note: null }
      : null;
  const needsYou = attentionItems(groups, ctx, { heroKey: hero?.key ?? null, canWithdraw: options.canWithdraw }).filter(
    // My own open requests show as "Needs cover" on the card or in "This week" instead.
    (item) => item.kind !== 'myRequest' && item.key !== hero?.key && inHomeWindow(item.date, today),
  );
  const listed = new Set(needsYou.map((i) => i.key));
  const thisWeek = week
    .filter((e) => e !== first && !(e.turn && listed.has(e.turn.slot.key)))
    .map((e) => (e.turn ? turnView(e.turn, ctx) : (e.headcount as TurnView)));
  const next = mine.find((m) => !isOpenRequest(m.assignment));
  return {
    hero,
    needsYou,
    thisWeek,
    allSet: hero === null && thisWeek.length > 0,
    nextTurn: next ? `${next.slot.responsibilityName} · ${next.group.name} · ${formatDayShort(next.event.date)}` : null,
  };
}

// ---------------------------------------------------------------------------
// Your groups

export type GroupCardView = {
  groupId: string;
  name: string;
  /** "Your next turn: Greeter · Sun, Nov 29" or "No turns coming up". */
  line: string;
};

/** One card per Group, by name, with the viewer's next turn there. */
export function groupCards(groups: HomeGroup[], ctx: HomeContext): GroupCardView[] {
  return [...groups]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .map((group) => {
      const next = me(group) ? upcomingSlots(group, ctx).find((s) => s.slot.mine && !isOpenRequest(s.assignment)) : undefined;
      return {
        groupId: group.id,
        name: group.name,
        line: next ? `Your next turn: ${next.slot.responsibilityName} · ${formatDayShort(next.event.date)}` : 'No turns coming up',
      };
    });
}
