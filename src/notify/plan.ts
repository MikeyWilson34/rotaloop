/**
 * The notification planner (ticket 11): given a Group's state, the people's notification
 * preferences and "now", which notifications are due. Pure TypeScript (engine types, the
 * schedule helpers and `Intl` only): no I/O and no clock reads, so it is unit-tested under
 * Node and runs unchanged in the `notify` Edge Function, which only loads data, calls it
 * and delivers.
 *
 * Two entry points:
 * - `planCommandNotifications`: right after a command, from its history entries (a turn that
 *   needs cover, a cover being set, schedule changes, confirmation requests).
 * - `planScheduledNotifications`: on the 15-minute job (reminders and the one "still needs
 *   cover" follow-up).
 *
 * One cover flow (simplify ticket 07): a turn that needs cover goes to every Member in the
 * group, in plain words; the first to tap "I'll cover" takes it. There are no Admin alerts and
 * no "Replacement Duty": if nobody takes it, the group page shows "Needs cover" to everyone.
 *
 * Rules that hold everywhere:
 * - Only Members with an account get anything (never a Stand-in, a former Member or an
 *   outside cover), and only when their profile has push on. Email and SMS are stored
 *   preferences that the MVP does not deliver.
 * - The Member who acted is never told about their own action.
 * - Every item has a `dedupeKey`: the notification log stores it under a unique
 *   constraint, so a retried or overlapping run never sends the same thing twice.
 * - Topic toggles: "Coverage Requests" (`notifyCoverageRequests`) gates Coverage Requests
 *   and their follow-up; "Schedule changes" (`notifyChanges`) gates moved, reassigned,
 *   added and removed Assignments. Reminders, anything about your own turn being covered,
 *   and confirmation requests are always on (with push).
 */
import type { Assignment, AssignmentChange, Event, GroupState, HistoryEntry, Instant, MemberId } from '../engine/types';
import { localDate, zonedTimeToInstant } from '../schedule/expandSeries';
import { addDays, dateIn, formatDayShort, formatTimeIn, relativeDay, safeZone } from '../schedule/format';
import { answerOf, nextHeadcounts } from '../schedule/headcount';
import { coverSentence, describeAssignmentChange, describeHistoryEntry, type HistoryContext } from '../schedule/history';

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

/**
 * Whether the Member already has another job in the group that day (on their own clock):
 * they aren't asked to cover, as the app doesn't offer them "I'll cover" either.
 */
function busyThatDay(state: GroupState, memberId: MemberId, target: Assignment, zone: string): boolean {
  const event = eventOf(state, target.eventId);
  if (!event) return false;
  const day = dateIn(event.startsAt, zone);
  return state.assignments.some((a) => {
    if (a.id === target.id || a.memberId !== memberId || isOpen(a)) return false;
    const other = eventOf(state, a.eventId);
    return !!other && !other.skipDate && dateIn(other.startsAt, zone) === day;
  });
}

/** Who to ask to cover: every active Member with push on, not excluded, free that day. */
function coverCandidates(group: NotifyGroup, profiles: ProfileLookup, a: Assignment, exclude: (MemberId | null)[]): Recipient[] {
  const { state } = group;
  const out: Recipient[] = [];
  for (const m of state.members) {
    if (exclude.includes(m.id)) continue;
    const r = recipientOf(state, profiles, m.id);
    if (!r || !r.profile.notifyCoverageRequests) continue;
    if (busyThatDay(state, m.id, a, zoneOf(r.profile))) continue;
    out.push(r);
  }
  return out;
}

/** "Grace" from "Grace Hopper". */
function firstNameOf(state: GroupState, id: MemberId | null | undefined): string | null {
  const name = id ? state.members.find((m) => m.id === id)?.name.trim() : undefined;
  return name ? name.split(/s+/)[0] : null;
}

/** "Grace can't make Greeter on Sun, Nov 29 at 10:00 AM." or "Greeter on ... needs cover." */
function needsCoverLine(state: GroupState, a: Assignment, zone: string): string {
  const who = firstNameOf(state, a.coverageRequest?.requestedBy ?? a.turnOf);
  const note = a.coverageRequest?.note?.trim();
  const why = note ? `: “${note}”` : '';
  return who ? `${who} can't make ${seatSentence(state, a, zone)}${why}.` : `${seatSentence(state, a, zone)} needs cover.`;
}

const FIRST_TAP = "The first to tap \"I'll cover\" takes it.";

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
 * - a turn that needs cover → every Member (not whoever can't make it, not anyone with another
 *   job that day), if they have "Coverage Requests" on: "Can you cover Greeter, Sun, Nov 29?";
 * - a cover set (volunteered, picked, or found by the person themselves) → whoever couldn't
 *   make it and the coverer, in the swap sentence Activity shows ("Sam's covering for you on
 *   Nov 29. You'll take Sam's next turn on Dec 13."); a withdrawn cover → whoever asked;
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

    // Who heard about a cover in this entry: the swap it makes isn't also a "schedule change".
    const told = new Set<MemberId>();
    const swapTurns = new Set(entry.makeUpTurns.filter((c) => c.before === null).map((c) => c.makeUpTurnId));
    const coveredNow = (c: AssignmentChange) => !!c.before && !!c.after?.coverageRequest?.cover && !c.before.coverageRequest?.cover;
    const ordered = [...entry.changes.filter(coveredNow), ...entry.changes.filter((c) => !coveredNow(c))];

    for (const change of ordered) {
      const { before, after } = change;

      // A turn that needs cover (new, or reopened when the coverer can't after all).
      if (after && isOpen(after) && !isOpen(before)) {
        const requester = after.coverageRequest!.requestedBy;
        const reopenedBy = before?.coverageRequest?.cover?.kind === 'member' ? before.coverageRequest.cover.memberId : null;
        for (const r of coverCandidates(group, profiles, after, [requester, actor])) {
          const zone = zoneOf(r.profile);
          const why = reopenedBy
            ? `${firstNameOf(state, reopenedBy) ?? 'Someone'} can't cover ${seatSentence(state, after, zone)} after all.`
            : needsCoverLine(state, after, zone);
          push(r, 'coverageRequest', after, {
            title: `Can you cover ${seatLabel(state, after, zone)}?`,
            body: `${why} ${FIRST_TAP}`,
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

      // Covered: someone tapped "I'll cover", was picked, or was found by the person themselves
      // (a Member, or an outside cover). Told in the swap sentence, from each side.
      if (coveredNow(change) && after?.coverageRequest?.cover) {
        const sentence = (r: Recipient) => coverSentence(entry, historyContext(state, r)) ?? line(r);
        const requesterId = after.coverageRequest.requestedBy;
        const requester = recipientOf(state, profiles, requesterId);
        if (requester) {
          told.add(requester.member.id);
          push(requester, 'covered', after, {
            title: `${seatLabel(state, after, zoneOf(requester.profile))} is covered`,
            body: sentence(requester),
          });
        }
        const cover = after.coverageRequest.cover;
        if (cover.kind === 'member') {
          const coverer = recipientOf(state, profiles, cover.memberId);
          if (coverer) {
            told.add(coverer.member.id);
            push(coverer, 'askedToConfirmCover', after, {
              title: `You're covering ${seatLabel(state, after, zoneOf(coverer.profile))}`,
              body: sentence(coverer),
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
        // The swapped turn itself was just told in the cover sentence.
        if (told.has(memberId) && after?.makeUpTurnId && swapTurns.has(after.makeUpTurnId)) return;
        const r = recipientOf(state, profiles, memberId);
        if (!r || !r.profile.notifyChanges) return;
        const ctx = historyContext(state, r);
        const what = describeAssignmentChange(change, ctx).text;
        const madeUp = after?.makeUpTurnId && !before?.makeUpTurnId && after.memberId === memberId ? ' (a swapped turn)' : '';
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
 * - **"Still needs cover"**: at the old "find a replacement by" moment (the Group's stored
 *   deadline), once, to every Member free that day (as for a new request), unless the request
 *   only opened after it. There is no Replacement Duty and there are no Admin alerts any more
 *   (simplify ticket 07): the group page shows "Needs cover" to everyone.
 * - **"Coming?"** (headcount Jobs, ticket 09): for the next date of each headcount Job, at the
 *   same reminder times, every Member who hasn't answered is asked "Coming?" and every Member
 *   who said Yes is reminded. Those who said No hear nothing. It opens Home (Yes / No there).
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

      if (open) {
        const request = a.coverageRequest!;
        const deadline = start - state.settings.replacementDeadlineMs;
        const openedBefore = Date.parse(request.requestedAt) < deadline;
        if (t >= deadline) {
          // The one follow-up to the Qualified Members.
          if (openedBefore && due(deadline)) {
            for (const r of coverCandidates(group, profiles, a, [request.requestedBy])) {
              const zone = zoneOf(r.profile);
                            add(r, 'coverageFollowUp', a, 'deadline', {
                title: `Still needs cover: ${seatLabel(state, a, zone)}`,
                body: `${needsCoverLine(state, a, zone)} It still needs cover. ${FIRST_TAP}`,
                url: assignmentUrl(group.id, a.id, 'cover'),
              });
            }
          }

        }
      }
    }

    // "Coming?" for the next date of each headcount Job.
    for (const date of nextHeadcounts(state, now)) {
      for (const m of state.members) {
        const r = recipientOf(state, profiles, m.id);
        if (!r) continue;
        const answer = answerOf(state, date.eventId, date.responsibilityId, m.id);
        if (answer === 'no') continue;
        const zone = zoneOf(r.profile);
        const day = formatDayShort(dateIn(date.startsAt, zone));
        const time = formatTimeIn(date.startsAt, zone);
        for (const days of [...new Set(r.profile.reminderDaysBefore)].sort((x, y) => y - x)) {
          const at = reminderDueAt(date.startsAt, days, r.profile);
          if (!at || !due(Date.parse(at))) continue;
          const when = relativeDay(dateIn(date.startsAt, zone), dateIn(now, zone));
          const offsetKey = `${days}d`;
          items.push({
            dedupeKey: `reminder:${group.id}:hc:${date.responsibilityId}:${date.eventId}:${offsetKey}:${m.accountId}`,
            accountId: m.accountId!,
            kind: 'reminder',
            groupId: group.id,
            groupName: group.name,
            assignmentId: null,
            eventId: date.eventId,
            offsetKey,
            title: answer === 'yes' ? `${when}: ${date.jobName}` : `Coming? ${date.jobName}, ${day}`,
            body: withGroup(
              answer === 'yes'
                ? `You said you're coming to ${date.jobName} on ${day} at ${time}.`
                : `${date.jobName} on ${day} at ${time}. Tap to answer Yes or No.`,
              group,
            ),
            url: '/',
          });
        }
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
