/**
 * The Activity tab (ticket 12): schedule history across the person's Groups as a feed, newest
 * first, grouped by day, with filters (All / Coverage / Confirmations / Schedule changes),
 * an icon and tone per kind, unread state and where tapping an item goes.
 *
 * Pure TypeScript: no React, Supabase or clock reads; unit-tested under Node. Sentences come
 * from `describeHistoryEntry` (src/schedule/history.ts).
 */
import type { Instant, MemberId } from '../engine/types';
import { dateIn, daysBetween, formatDayShort, formatMonthDay, formatTimeIn } from '../schedule/format';
import { describeHistoryEntry, type HistoryRecord, type HistoryTone } from '../schedule/history';
import { weekStart, type ScheduleGroup } from '../schedule/views';

/** One `schedule_history` row with the Group it belongs to. */
export type FeedEntry = HistoryRecord & { groupId: string };

export type ActivityKind = 'coverage' | 'confirm' | 'change';
export type ActivityFilter = 'all' | ActivityKind;

export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'coverage', label: 'Coverage' },
  { value: 'confirm', label: 'Confirmations' },
  { value: 'change', label: 'Schedule changes' },
];

export type ActivityIcon =
  | 'repeat'
  | 'userCheck'
  | 'checkCircle'
  | 'clock'
  | 'calX'
  | 'calOff'
  | 'userPlus'
  | 'userMinus'
  | 'handshake'
  | 'settings'
  | 'shuffle'
  | 'calendar'
  | 'shield'
  | 'undo'
  | 'activity';

const COVERAGE = new Set(['decline', 'cover', 'markCovered', 'makeUpTurnPaid', 'withdrawDecline']);
const CONFIRM = new Set(['confirm', 'requestConfirmation']);

/** Which filter an entry belongs to. */
export function activityKind(causeType: string): ActivityKind {
  if (COVERAGE.has(causeType)) return 'coverage';
  if (CONFIRM.has(causeType)) return 'confirm';
  return 'change';
}

const ICONS: Record<string, ActivityIcon> = {
  decline: 'repeat',
  withdrawDecline: 'undo',
  cover: 'userCheck',
  markCovered: 'userCheck',
  makeUpTurnPaid: 'handshake',
  confirm: 'checkCircle',
  requestConfirmation: 'clock',
  addSkipDate: 'calX',
  removeSkipDate: 'calX',
  addTimeOff: 'calOff',
  removeTimeOff: 'calOff',
  addMember: 'userPlus',
  claimPlaceholder: 'userPlus',
  removeMember: 'userMinus',
  setAdmin: 'shield',
  addResponsibility: 'settings',
  editResponsibility: 'settings',
  removeResponsibility: 'settings',
  reorderResponsibilities: 'settings',
  setPrimaryResponsibility: 'settings',
  renameMember: 'settings',
  changeSettings: 'settings',
  rebalance: 'shuffle',
  reorderQueue: 'shuffle',
  qualifyMember: 'userCheck',
  unqualifyMember: 'userMinus',
  addEvents: 'calendar',
  removeEvent: 'calendar',
  addEventSeries: 'calendar',
  editEventSeries: 'calendar',
  removeEventSeries: 'calendar',
};

export function activityIcon(causeType: string): ActivityIcon {
  return ICONS[causeType] ?? 'activity';
}

/**
 * Entries worth a line in the feed: not the schedule filling itself in, nor the daily job
 * adding Events (mirrors the server-side filter in src/activity/data.ts).
 */
export function isFeedWorthy(entry: Pick<HistoryRecord, 'cause' | 'actorId'>): boolean {
  const type = entry.cause.type;
  if (type === 'fillSchedule') return false;
  if (type === 'addEvents' && entry.actorId === null) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Unread

/**
 * Unread: newer than when the person last looked at Activity, and not their own action. With
 * no "last seen" yet (first visit on this device), nothing is unread.
 */
export function isUnread(entry: Pick<FeedEntry, 'at' | 'actorId'>, lastSeenAt: Instant | null, myMemberId: MemberId | null): boolean {
  if (!lastSeenAt) return false;
  if (myMemberId !== null && entry.actorId === myMemberId) return false;
  return Date.parse(entry.at) > Date.parse(lastSeenAt);
}

/** The count on the Activity tab: unread, feed-worthy entries across the Groups. */
export function unreadCount(
  entries: Pick<FeedEntry, 'at' | 'actorId' | 'cause' | 'groupId'>[],
  lastSeenAt: Instant | null,
  myMemberIds: Record<string, MemberId | null>,
): number {
  return entries.filter((e) => isFeedWorthy(e) && isUnread(e, lastSeenAt, myMemberIds[e.groupId] ?? null)).length;
}

/** "3", or "99+" past 99. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

// ---------------------------------------------------------------------------
// Items

export type ActivityTarget = { kind: 'assignment'; groupId: string; assignmentId: string } | { kind: 'group'; groupId: string };

const ONE_ASSIGNMENT = new Set(['confirm', 'decline', 'cover', 'markCovered', 'withdrawDecline']);

/** Where tapping an entry goes: the Assignment it's about, or the Group. */
export function activityTarget(entry: FeedEntry, group?: ScheduleGroup): ActivityTarget {
  const cause = entry.cause as { type: string; assignmentId?: string; assignmentIds?: string[] };
  let assignmentId: string | null = null;
  if (ONE_ASSIGNMENT.has(cause.type) && typeof cause.assignmentId === 'string') assignmentId = cause.assignmentId;
  else if (cause.type === 'requestConfirmation' && cause.assignmentIds?.length === 1) assignmentId = cause.assignmentIds[0];
  else if (entry.changes.length === 1 && cause.type !== 'removeEvent') assignmentId = entry.changes[0].assignmentId;
  // An Assignment no longer on the schedule opens the Group instead.
  if (assignmentId && group && !group.state.assignments.some((a) => a.id === assignmentId)) assignmentId = null;
  return assignmentId ? { kind: 'assignment', groupId: entry.groupId, assignmentId } : { kind: 'group', groupId: entry.groupId };
}

export type ActivityItem = {
  key: string;
  groupId: string;
  groupName: string;
  at: Instant;
  /** The day in the viewer's zone. */
  date: string;
  text: string;
  detail: string | null;
  tone: HistoryTone;
  icon: ActivityIcon;
  kind: ActivityKind;
  /** "Sunday Team · 3:04 PM". */
  meta: string;
  /** The time part of `meta`: "3:04 PM" or "Mon 3:04 PM". */
  time: string;
  unread: boolean;
  target: ActivityTarget;
};

export type ActivityContext = { now: Instant; viewerTimeZone: string; lastSeenAt: Instant | null };

/** The feed, newest first. Entries of Groups the person isn't in (any more) are left out. */
export function activityItems(entries: FeedEntry[], groups: ScheduleGroup[], ctx: ActivityContext): ActivityItem[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const today = dateIn(ctx.now, ctx.viewerTimeZone);
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const entry of entries) {
    const group = byId.get(entry.groupId);
    const key = `${entry.groupId}:${entry.id}`;
    if (!group || seen.has(key) || !isFeedWorthy(entry)) continue;
    seen.add(key);
    const line = describeHistoryEntry(entry, { state: group.state, myMemberId: group.myMemberId, timeZone: ctx.viewerTimeZone });
    const date = dateIn(entry.at, ctx.viewerTimeZone);
    out.push({
      key,
      groupId: group.id,
      groupName: group.name,
      at: entry.at,
      date,
      text: line.text,
      detail: line.detail,
      tone: line.tone,
      icon: activityIcon(entry.cause.type),
      kind: activityKind(entry.cause.type),
      meta: `${group.name} · ${timeLabel(entry.at, date, today, ctx.viewerTimeZone)}`,
      time: timeLabel(entry.at, date, today, ctx.viewerTimeZone),
      unread: isUnread(entry, ctx.lastSeenAt, group.myMemberId),
      target: activityTarget(entry, group),
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.key.localeCompare(a.key, undefined, { numeric: true }));
}

/** The time on an item: "3:04 PM", with the weekday under "Earlier this week" ("Mon 3:04 PM"). */
function timeLabel(at: Instant, date: string, today: string, timeZone: string): string {
  const time = formatTimeIn(at, timeZone);
  return dayLabel(date, today) === 'Earlier this week' ? `${formatDayShort(date).split(',')[0]} ${time}` : time;
}

export function filterActivity(items: ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  return filter === 'all' ? items : items.filter((i) => i.kind === filter);
}

export function parseActivityFilter(value: string | undefined): ActivityFilter {
  return value === 'coverage' || value === 'confirm' || value === 'change' ? value : 'all';
}

/** "Today", "Yesterday", "Earlier this week" (since Sunday), then "Sun, Nov 8" (with the year when not this year). */
export function dayLabel(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n < -1 && date >= weekStart(today)) return 'Earlier this week';
  const short = formatDayShort(date);
  return date.slice(0, 4) === today.slice(0, 4) ? short : `${short.split(',')[0]}, ${formatMonthDay(date, true)}`;
}

export type ActivitySection = { key: string; label: string; items: ActivityItem[] };

/** Consecutive items under their day heading (items are newest first). */
export function groupActivityByDay(items: ActivityItem[], now: Instant, viewerTimeZone: string): ActivitySection[] {
  const today = dateIn(now, viewerTimeZone);
  const sections: ActivitySection[] = [];
  for (const item of items) {
    const label = dayLabel(item.date, today);
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.items.push(item);
    else sections.push({ key: `${label}:${item.date}`, label, items: [item] });
  }
  return sections;
}

/** The newest `at` of the entries, for marking them seen. */
export function newestAt(entries: Pick<FeedEntry, 'at'>[]): Instant | null {
  let max: number | null = null;
  for (const e of entries) {
    const t = Date.parse(e.at);
    if (max === null || t > max) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}

/** The later of two instants (null-safe): "last seen" only moves forward. */
export function laterOf(a: Instant | null, b: Instant | null): Instant | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
