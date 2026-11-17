/**
 * The notification planner (ticket 11): given a Group's state, the people's notification
 * preferences and "now", which notifications are due. Pure TypeScript (engine types, the
 * schedule helpers and `Intl` only): no I/O and no clock reads, so it is unit-tested under
 * Node and runs unchanged in the `notify` Edge Function, which only loads data, calls it
 * and delivers.
 *
 * Two entry points:
 * - `planCommandNotifications`: right after a command, from its history entries (a new
 *   Coverage Request, a Cover, "Mark covered", schedule changes, confirmation requests).
 * - `planScheduledNotifications`: on the 15-minute job (reminders, the Coverage Request
 *   follow-up, Replacement Duty, Admin alerts).
 *
 * Rules that hold everywhere:
 * - Only Members with an account get anything (never a Placeholder, a former Member or a
 *   Guest Cover), and only when their profile has push on. Email and SMS are stored
 *   preferences that the MVP does not deliver.
 * - The Member who acted is never told about their own action.
 * - Every item has a `dedupeKey`: the notification log stores it under a unique
 *   constraint, so a retried or overlapping run never sends the same thing twice.
 * - Topic toggles: "Coverage Requests" (`notifyCoverageRequests`) gates Coverage Requests
 *   and their follow-up; "Schedule changes" (`notifyChanges`) gates moved, reassigned,
 *   added and removed Assignments. Reminders, anything about your own Coverage Request,
 *   confirmation requests, Replacement Duty and Admin alerts are always on (with push).
 */
import { isUnconfirmed } from '../engine/status';
import type { Assignment, AssignmentChange, Event, GroupState, HistoryEntry, Instant, Member, MemberId } from '../engine/types';
import { localDate, zonedTimeToInstant } from '../schedule/expandSeries';
import { addDays, dateIn, formatDayShort, formatTimeIn, relativeDay, safeZone } from '../schedule/format';
import { describeAssignmentChange, describeHistoryEntry, type HistoryContext } from '../schedule/history';

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

/**
 * How late a timed notification may still go out. The job runs every 15 minutes; a
 * reminder that is more than an hour overdue (the job was down, or the Assignment only
 * appeared later) is dropped rather than sent at an odd time.
 */
export const SEND_GRACE_MS = 60 * MINUTE;

/** Assignments whose Event is this close are asked to confirm (they become Pending). */
export const CONFIRMATION_WINDOW_DAYS = 14;
export const CONFIRMATION_WINDOW_MS = CONFIRMATION_WINDOW_DAYS * DAY_MS;

/** "Morning of" reminders use the reminder time when it is in the morning, otherwise this. */
export const MORNING_OF_TIME = '07:00';

/**
 * How far ahead the job looks for Events: past the longest reminder (7 days), the
 * confirmation window, and the Admin alert and "find a replacement by" options (7 days).
 */
export const LOOKAHEAD_DAYS = 15;

// ---------------------------------------------------------------------------
// Inputs and outputs

/** The `profiles` columns the planner needs (see the schema migration). */
export interface NotifyProfile {
  accountId: string;
  pushEnabled: boolean;
  notifyCoverageRequests: boolean;
  notifyChanges: boolean;
  /** Any of 0 (morning of), 1, 2, 7. */
  reminderDaysBefore: number[];
  /** Local "HH:MM" (or "HH:MM:SS", as Postgres returns it). */
  reminderTime: string;
  timeZone: string;
  adminAlertLeadTimeMs: number;
}

export type ProfileLookup = ReadonlyMap<string, NotifyProfile>;

export interface NotifyGroup {
  id: string;
  name: string;
  state: GroupState;
}

export type NotificationKind =
  | 'coverageRequest'
  | 'coverageFollowUp'
  | 'covered'
  | 'coverWithdrawn'
  | 'askedToConfirmCover'
  | 'confirmationRequested'
  | 'scheduleChange'
  | 'reminder'
  | 'replacementDuty'
  | 'adminAlert';

/** One planned notification for one person (a row of `notification_log`). */
export interface NotificationItem {
  dedupeKey: string;
  accountId: string;
  kind: NotificationKind;
  groupId: string;
  groupName: string;
  assignmentId: string | null;
  eventId: string | null;
  /** Which offset or variant, e.g. "1d" for a reminder, "unconfirmed" for an Admin alert. */
  offsetKey: string;
  title: string;
  body: string;
  /** In-app path the notification opens, e.g. "/assignment/<group>/<assignment>?action=cover". */
  url: string;
}

// ---------------------------------------------------------------------------
// Shared helpers

const isOpen = (a: Assignment | null | undefined): boolean => !!a?.coverageRequest && a.coverageRequest.cover === null;

export function assignmentUrl(groupId: string, assignmentId: string, action?: 'cover' | 'markCovered'): string {
  const path = `/assignment/${encodeURIComponent(groupId)}/${encodeURIComponent(assignmentId)}`;
  return action ? `${path}?action=${action}` : path;
}

/** A Member who can receive push: active, with an account whose profile has push on. */
function recipientOf(state: GroupState, profiles: ProfileLookup, memberId: MemberId | null | undefined) {
  if (!memberId) return null;
  const member = state.members.find((m) => m.id === memberId);
  if (!member || member.leftAt !== null || member.accountId === null) return null;
  const profile = profiles.get(member.accountId);
  if (!profile || !profile.pushEnabled) return null;
  return { member, profile };
}

type Recipient = NonNullable<ReturnType<typeof recipientOf>>;

function zoneOf(profile: NotifyProfile): string {
  return safeZone(profile.timeZone);
}

function eventOf(state: GroupState, eventId: string): Event | undefined {
  return state.events.find((e) => e.id === eventId);
}

function responsibilityName(state: GroupState, id: string): string {
  return state.responsibilities.find((r) => r.id === id)?.name ?? 'a Responsibility';
}

function nameOf(state: GroupState, id: MemberId | null | undefined): string {
  return state.members.find((m) => m.id === id)?.name ?? 'Someone';
}

/** "Sound, Sun, Nov 22" in the recipient's time zone. */
function seatLabel(state: GroupState, a: Assignment, zone: string): string {
  const event = eventOf(state, a.eventId);
  const day = event ? `, ${formatDayShort(dateIn(event.startsAt, zone))}` : '';
  return `${responsibilityName(state, a.responsibilityId)}${day}`;
}

/** "Sound on Sun, Nov 22 at 9:00 AM". */
function seatSentence(state: GroupState, a: Assignment, zone: string): string {
  const event = eventOf(state, a.eventId);
  const what = responsibilityName(state, a.responsibilityId);
  if (!event) return what;
  return `${what} on ${formatDayShort(dateIn(event.startsAt, zone))} at ${formatTimeIn(event.startsAt, zone)}`;
}

function historyContext(state: GroupState, r: Recipient): HistoryContext {
  return { state, myMemberId: r.member.id, timeZone: zoneOf(r.profile) };
}

const withGroup = (text: string, group: NotifyGroup) => `${text} · ${group.name}`;

/** Whether the Member holds another seat at that Event (they can't take a second one). */
function seatedAt(state: GroupState, memberId: MemberId, eventId: string, exceptAssignmentId: string): boolean {
  return state.assignments.some(
    (a) => a.eventId === eventId && a.id !== exceptAssignmentId && a.memberId === memberId && !isOpen(a),
  );
}

/** Qualified Members to ask to Cover: active, with push, not excluded, free at that Event. */
function coverCandidates(group: NotifyGroup, profiles: ProfileLookup, a: Assignment, exclude: (MemberId | null)[]): Recipient[] {
  const { state } = group;
  const queue = state.rotations.find((r) => r.responsibilityId === a.responsibilityId)?.queue ?? [];
  const out: Recipient[] = [];
  for (const id of queue) {
    if (exclude.includes(id)) continue;
    if (!state.settings.allowDoubling && seatedAt(state, id, a.eventId, a.id)) continue;
    const r = recipientOf(state, profiles, id);
    if (r && r.profile.notifyCoverageRequests) out.push(r);
  }
  return out;
}

function activeAdmins(state: GroupState): Member[] {
  return state.members.filter((m) => m.isAdmin && m.leftAt === null && m.accountId !== null);
}

// ---------------------------------------------------------------------------
// Right after a command

export interface CommandInput {
  group: NotifyGroup;
  /** The command's history entries, as group-command returned them. */
  history: HistoryEntry[];
  /** groups.state_version after the command: makes the dedupe keys unique per command. */
  stateVersion: number;
  profiles: ProfileLookup;
  now: Instant;
}

/** Events a history entry added (their new Assignments are not news to anyone). */
function addedEventIds(entry: HistoryEntry): Set<string> {
  const cause = entry.cause;
  if (cause.type === 'addEvents') return new Set(cause.events.map((e) => e.id));
  if (cause.type === 'addEventSeries') return new Set((cause.events ?? []).map((e) => e.id));
  if (cause.type === 'editEventSeries') return new Set((cause.replaceFutureEvents ?? []).map((e) => e.id));
  return new Set();
}

/**
 * The notifications a command causes, from its history entries:
 * - a new Coverage Request → its Qualified Members (not the Member who declined, not
 *   anyone already serving at that Event), if they have "Coverage Requests" on;
 * - a Cover → the Member who asked for coverage; a withdrawn Cover → that Member again;
 * - "Mark covered" by a Group Member → that Member, asked to confirm;
 * - a confirmation request → the Member asked;
 * - an Assignment moved, reassigned, added (at an existing Event) or removed → the
 *   Members it affects, if they have "Schedule changes" on.
 * Never the actor. Several items for one person are batched by `composeMessages`.
 */
export function planCommandNotifications(input: CommandInput): NotificationItem[] {
  const { group, profiles, now, stateVersion } = input;
  const { state } = group;
  const items: NotificationItem[] = [];

  input.history.forEach((entry, entryIndex) => {
    const actor = entry.actorId;
    const added = addedEventIds(entry);
    const push = (
      r: Recipient | null,
      kind: NotificationKind,
      a: Assignment,
      content: { title: string; body: string; url?: string },
    ) => {
      if (!r || r.member.id === actor) return;
      const event = eventOf(state, a.eventId);
      if (!event || Date.parse(event.startsAt) <= Date.parse(now)) return;
      items.push({
        dedupeKey: `cmd:${group.id}:v${stateVersion}:${entryIndex}:${a.id}:${kind}:${r.member.accountId}`,
        accountId: r.member.accountId!,
        kind,
        groupId: group.id,
        groupName: group.name,
        assignmentId: a.id,
        eventId: a.eventId,
        offsetKey: '',
        title: content.title,
        body: withGroup(content.body, group),
        url: content.url ?? assignmentUrl(group.id, a.id),
      });
    };
    const line = (r: Recipient) => describeHistoryEntry(entry, historyContext(state, r)).text;

    for (const change of entry.changes) {
      const { before, after } = change;

      // A new (or reopened) Coverage Request.
      if (after && isOpen(after) && !isOpen(before)) {
        const requester = after.coverageRequest!.requestedBy;
        for (const r of coverCandidates(group, profiles, after, [requester, actor])) {
          const zone = zoneOf(r.profile);
          const reopened = !!before?.coverageRequest?.cover;
          push(r, 'coverageRequest', after, {
            title: `Can you cover ${seatLabel(state, after, zone)}?`,
            body: reopened || entry.cause.type !== 'decline' ? `${describeAssignmentChange(change, historyContext(state, r)).text}.` : line(r),
            url: assignmentUrl(group.id, after.id, 'cover'),
          });
        }
        // The coverer withdrew: the Member who asked needs to know.
        if (before?.coverageRequest?.cover) {
          const r = recipientOf(state, profiles, requester);
          if (r) {
            push(r, 'coverWithdrawn', after, {
              title: `${seatLabel(state, after, zoneOf(r.profile))} needs cover again`,
              body: line(r),
            });
          }
        }
        continue;
      }

      // Covered: by a Member who volunteered, or marked covered (a Member or a Guest Cover).
      if (before && isOpen(before) && after?.coverageRequest?.cover) {
        const requester = recipientOf(state, profiles, before.coverageRequest!.requestedBy);
        if (requester) {
          push(requester, 'covered', after, {
            title: `${seatLabel(state, after, zoneOf(requester.profile))} is covered`,
            body: line(requester),
          });
        }
        const cover = after.coverageRequest.cover;
        if (cover.kind === 'member' && entry.cause.type === 'markCovered') {
          const coverer = recipientOf(state, profiles, cover.memberId);
          if (coverer) {
            const zone = zoneOf(coverer.profile);
            push(coverer, 'askedToConfirmCover', after, {
              title: `Please confirm: ${seatLabel(state, after, zone)}`,
              body: `${nameOf(state, actor)} has you down to cover ${seatSentence(state, after, zone)}. Please confirm.`,
            });
          }
        }
        continue;
      }

      // A Decline withdrawn ("I can make it after all"): nothing to announce.
      if (before && after && isOpen(before) && !after.coverageRequest) continue;

      // Asked to confirm (the job's requestConfirmation, or an Admin's).
      if (
        before &&
        after &&
        before.eventId === after.eventId &&
        before.memberId === after.memberId &&
        before.confirmation !== 'requested' &&
        after.confirmation === 'requested'
      ) {
        const r = recipientOf(state, profiles, after.memberId);
        if (r) {
          const zone = zoneOf(r.profile);
          push(r, 'confirmationRequested', after, {
            title: `Please confirm: ${seatLabel(state, after, zone)}`,
            body: `Can you still make ${seatSentence(state, after, zone)}?`,
          });
        }
        continue;
      }

      planScheduleChange(change, added, (memberId, a) => {
        const r = recipientOf(state, profiles, memberId);
        if (!r || !r.profile.notifyChanges) return;
        const ctx = historyContext(state, r);
        const what = describeAssignmentChange(change, ctx).text;
        const madeUp = after?.makeUpTurnId && !before?.makeUpTurnId && after.memberId === memberId ? ' (Make-up Turn)' : '';
        push(r, 'scheduleChange', a, {
          title: `Schedule change: ${seatLabel(state, a, zoneOf(r.profile))}`,
          body: `${what}${madeUp}. ${line(r)}`,
        });
      });
    }
  });
  return items;
}

/** Who a schedule change affects: the Member now holding the seat and the one who lost it. */
function planScheduleChange(
  change: AssignmentChange,
  addedEvents: Set<string>,
  tell: (memberId: MemberId, assignment: Assignment) => void,
): void {
  const { before, after } = change;
  if (before && after) {
    const moved = before.eventId !== after.eventId;
    const reassigned = before.memberId !== after.memberId;
    if (!moved && !reassigned) return;
    if (after.memberId) tell(after.memberId, after);
    if (reassigned && before.memberId) tell(before.memberId, after);
  } else if (after && !before) {
    if (after.memberId && !addedEvents.has(after.eventId)) tell(after.memberId, after);
  } else if (before && !after) {
    if (before.memberId && !isOpen(before)) tell(before.memberId, before);
  }
}

// ---------------------------------------------------------------------------
// The 15-minute job

export interface ScheduledInput {
  groups: NotifyGroup[];
  profiles: ProfileLookup;
  now: Instant;
  /** Default SEND_GRACE_MS. */
  graceMs?: number;
}

/**
 * When a reminder `daysBefore` an Event is due for this person: their `reminderTime` on
 * that day, on their own clock (so it holds across daylight-saving changes). "Morning of"
 * (0) uses the reminder time if it is before noon, otherwise MORNING_OF_TIME. Null when
 * that moment isn't before the Event.
 */
export function reminderDueAt(eventStartsAt: Instant, daysBefore: number, profile: Pick<NotifyProfile, 'reminderTime' | 'timeZone'>): Instant | null {
  const zone = safeZone(profile.timeZone);
  const time = normalizeClock(profile.reminderTime);
  const at = daysBefore === 0 && time >= '12:00' ? MORNING_OF_TIME : time;
  const day = addDays(localDate(eventStartsAt, zone), -daysBefore);
  const due = zonedTimeToInstant(day, at, zone);
  return Date.parse(due) < Date.parse(eventStartsAt) ? due : null;
}

function normalizeClock(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '18:00';
}

/** Assignment ids the job should ask to confirm now (requestConfirmation as the system). */
export function confirmationRequestsDue(state: GroupState, now: Instant, windowMs = CONFIRMATION_WINDOW_MS): string[] {
  const t = Date.parse(now);
  return state.assignments
    .filter((a) => {
      if (a.confirmation !== 'notYetRequested' || a.memberId === null || isOpen(a)) return false;
      const event = eventOf(state, a.eventId);
      if (!event || event.skipDate) return false;
      const start = Date.parse(event.startsAt);
      return start > t && start - t <= windowMs;
    })
    .map((a) => a.id);
}

/**
 * Everything the job should send now. Each item fires once (its dedupe key):
 * - **Reminders**: for each of the holder's `reminderDaysBefore`, at `reminderDueAt`, if
 *   that moment passed less than `graceMs` ago. Not for a seat the holder asked to have
 *   covered (it is the coverer's then; a Guest Cover gets none).
 * - **Coverage Request follow-up**: at the Group's "find a replacement by" deadline, once,
 *   to the Qualified Members (as for a new request), unless the request only opened after it.
 * - **Replacement Duty**: once the deadline passes with no taker, to whoever holds it: the
 *   Member who declined (the default; a Placeholder's falls to the Admins) or the Admins
 *   (not the decliner, unless they are the only Admin). Sent even if the job was late. The
 *   Member who declined after the deadline already knows, so isn't told.
 * - **Admin alerts**: at each Admin's `adminAlertLeadTimeMs` before the Event, for each
 *   Assignment that is Unconfirmed or Needs coverage in a Group they administer, once per
 *   Assignment and status (also when it only turns Unconfirmed or Needs coverage later).
 *   Not about the Admin's own seat, and not when the same run already sends them
 *   Replacement Duty for it.
 */
export function planScheduledNotifications(input: ScheduledInput): NotificationItem[] {
  const { profiles, now } = input;
  const grace = input.graceMs ?? SEND_GRACE_MS;
  const t = Date.parse(now);
  const items: NotificationItem[] = [];
  const due = (at: number) => at <= t && t - at < grace;

  for (const group of input.groups) {
    const { state } = group;
    const add = (r: Recipient, kind: NotificationKind, a: Assignment, offsetKey: string, content: { title: string; body: string; url?: string }) => {
      items.push({
        dedupeKey: `${kind}:${group.id}:${a.id}:${a.eventId}:${offsetKey}:${r.member.accountId}`,
        accountId: r.member.accountId!,
        kind,
        groupId: group.id,
        groupName: group.name,
        assignmentId: a.id,
        eventId: a.eventId,
        offsetKey,
        title: content.title,
        body: withGroup(content.body, group),
        url: content.url ?? assignmentUrl(group.id, a.id),
      });
    };

    for (const a of state.assignments) {
      const event = eventOf(state, a.eventId);
      if (!event || event.skipDate) continue;
      const start = Date.parse(event.startsAt);
      if (start <= t) continue;
      const open = isOpen(a);

      // Reminders.
      const holder = open ? null : recipientOf(state, profiles, a.memberId);
      if (holder) {
        const zone = zoneOf(holder.profile);
        for (const days of [...new Set(holder.profile.reminderDaysBefore)].sort((x, y) => y - x)) {
          const at = reminderDueAt(event.startsAt, days, holder.profile);
          if (!at || !due(Date.parse(at))) continue;
          const when = relativeDay(dateIn(event.startsAt, zone), dateIn(now, zone));
          const confirm = a.confirmation === 'requested' ? ' Please confirm.' : '';
          add(holder, 'reminder', a, `${days}d`, {
            title: `${when}: ${responsibilityName(state, a.responsibilityId)}`,
            body: `You're on ${seatSentence(state, a, zone)}.${confirm}`,
          });
        }
      }

      const dutyTo = new Set<string>();
      if (open) {
        const request = a.coverageRequest!;
        const deadline = start - state.settings.replacementDeadlineMs;
        const openedBefore = Date.parse(request.requestedAt) < deadline;
        if (t >= deadline) {
          // The one follow-up to the Qualified Members.
          if (openedBefore && due(deadline)) {
            for (const r of coverCandidates(group, profiles, a, [request.requestedBy])) {
              const zone = zoneOf(r.profile);
              const whose = request.requestedBy ? `${nameOf(state, request.requestedBy)}'s` : 'This';
              add(r, 'coverageFollowUp', a, 'deadline', {
                title: `Still needs cover: ${seatLabel(state, a, zone)}`,
                body: `${whose} ${seatSentence(state, a, zone)} still needs someone. Can you cover?`,
                url: assignmentUrl(group.id, a.id, 'cover'),
              });
            }
          }

          // Replacement Duty.
          const requester = request.requestedBy ? state.members.find((m) => m.id === request.requestedBy) : undefined;
          const toAdmins = state.settings.replacementDuty === 'admins' || !requester || requester.accountId === null;
          if (!toAdmins) {
            const r = recipientOf(state, profiles, requester.id);
            if (r && openedBefore) {
              dutyTo.add(r.member.accountId!);
              add(r, 'replacementDuty', a, 'deadline', {
                title: `Find a replacement: ${seatLabel(state, a, zoneOf(r.profile))}`,
                body: 'No one has covered your turn yet. Please find someone and mark it covered.',
                url: assignmentUrl(group.id, a.id, 'markCovered'),
              });
            }
          } else {
            const admins = activeAdmins(state);
            const others = admins.filter((m) => m.id !== request.requestedBy);
            for (const admin of others.length > 0 ? others : admins) {
              const r = recipientOf(state, profiles, admin.id);
              if (!r) continue;
              dutyTo.add(r.member.accountId!);
              const whose = request.requestedBy ? `${nameOf(state, request.requestedBy)}'s` : 'The';
              add(r, 'replacementDuty', a, 'deadline', {
                title: `Find a replacement: ${seatLabel(state, a, zoneOf(r.profile))}`,
                body: `No one has covered ${whose} ${seatSentence(state, a, zoneOf(r.profile))} yet. As an Admin, please find someone and mark it covered.`,
                url: assignmentUrl(group.id, a.id, 'markCovered'),
              });
            }
          }
        }
      }

      // Admin alerts.
      for (const admin of activeAdmins(state)) {
        if (admin.id === a.memberId) continue;
        const r = recipientOf(state, profiles, admin.id);
        if (!r || dutyTo.has(r.member.accountId!)) continue;
        const lead = r.profile.adminAlertLeadTimeMs;
        if (t < start - lead) continue;
        const status = open ? 'needsCoverage' : isUnconfirmed(a, event.startsAt, now, lead) ? 'unconfirmed' : null;
        if (!status) continue;
        const zone = zoneOf(r.profile);
        const who = a.memberId ? nameOf(state, a.memberId) : null;
        add(r, 'adminAlert', a, status, {
          title: `${status === 'needsCoverage' ? 'Needs coverage' : 'Unconfirmed'}: ${seatLabel(state, a, zone)}`,
          body:
            status === 'needsCoverage'
              ? `${seatSentence(state, a, zone)} still needs someone${who ? ` (${who} can't make it)` : ''}.`
              : `${who ?? 'Someone'} hasn't confirmed ${seatSentence(state, a, zone)} yet. Nothing is declined automatically.`,
        });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Batching

/** One push message for one person: their items of a run, batched. */
export interface PushMessage {
  accountId: string;
  title: string;
  body: string;
  url: string;
  /** The notification_log rows this message carries. */
  dedupeKeys: string[];
}

const PRIORITY: NotificationKind[] = [
  'replacementDuty',
  'coverageRequest',
  'coverageFollowUp',
  'askedToConfirmCover',
  'coverWithdrawn',
  'adminAlert',
  'confirmationRequested',
  'covered',
  'scheduleChange',
  'reminder',
];

/** At most this many lines in a batched message. */
export const MAX_LINES = 4;

/**
 * Batches each person's items into one message: one item is sent as is; several become
 * "3 updates · Sunday Team" with a line per item (most urgent first) and open the shared
 * link if they all point to one place, otherwise Home.
 */
export function composeMessages(items: NotificationItem[]): PushMessage[] {
  const byAccount = new Map<string, NotificationItem[]>();
  for (const item of items) {
    const list = byAccount.get(item.accountId) ?? [];
    list.push(item);
    byAccount.set(item.accountId, list);
  }
  const messages: PushMessage[] = [];
  for (const [accountId, list] of byAccount) {
    const sorted = [...list].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
    const dedupeKeys = sorted.map((i) => i.dedupeKey);
    if (sorted.length === 1) {
      const [only] = sorted;
      messages.push({ accountId, title: only.title, body: only.body, url: only.url, dedupeKeys });
      continue;
    }
    const groups = new Set(sorted.map((i) => i.groupName));
    const urls = new Set(sorted.map((i) => i.url.split('?')[0]));
    const lines = sorted.slice(0, MAX_LINES).map((i) => i.title);
    if (sorted.length > MAX_LINES) lines.push(`and ${sorted.length - MAX_LINES} more`);
    messages.push({
      accountId,
      title: `${sorted.length} updates${groups.size === 1 ? ` · ${[...groups][0]}` : ''}`,
      body: lines.join('\n'),
      url: urls.size === 1 ? sorted[0].url : '/',
      dedupeKeys,
    });
  }
  return messages;
}

/** The lookahead end for the job's Group query. */
export function lookaheadEnd(now: Instant): Instant {
  return new Date(Date.parse(now) + LOOKAHEAD_DAYS * DAY_MS).toISOString();
}
