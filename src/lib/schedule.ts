/**
 * Reading schedules: the signed-in person's upcoming Events and Assignments across all their
 * Groups (Schedule tab), and a Group's schedule history (Group screen, Assignment details).
 *
 * The cross-group schedule is a handful of queries, whatever the number of Groups: the
 * person's memberships (with each Group's settings), then, for all those Groups at once, their
 * Members, Responsibilities, Event Series and the Events from the start of this month with
 * their Assignments embedded. RLS limits every query to Groups the person belongs to. Each
 * Group's rows become a partial engine `GroupState` (no Rotations, Time Off or Make-up Turns),
 * so the same pure view functions (src/schedule/views.ts) serve this tab and the Group screen.
 * Realtime on `events` and `assignments` for those Groups (and on the person's memberships)
 * reloads it quietly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  stateFromRows,
  toInstant,
  type AssignmentRow,
  type EventRow,
  type EventSeriesRow,
  type GroupRow,
  type MemberRow,
  type ResponsibilityRow,
} from '../db/groupRows';
import type { AssignmentChange, Cause, MakeUpTurnChange } from '../engine';
import { addDays, dateIn } from '../schedule/format';
import type { HistoryRecord } from '../schedule/history';
import type { ScheduleGroup } from '../schedule/views';
import { deviceTimeZone, myMember } from './groupViews';
import { useRealtimeChanges, type PgBinding } from './realtime';
import { useLoader, type GroupDetails, type Loadable } from './groups';
import { useSession } from './session';
import { supabase } from './supabase';

export const SCHEDULE_LOAD_FAILED = "Couldn't load your schedule. Check your connection and try again.";
export const HISTORY_LOAD_FAILED = "Couldn't load the history. Check your connection and try again.";

export type MySchedule = {
  groups: ScheduleGroup[];
  /** The time zone everything is shown in: the device's. */
  viewerTimeZone: string;
};

const GROUP_COLUMNS =
  'id, name, time_zone, coverage_policy, time_off_handling, allow_doubling, replacement_duty, replacement_deadline_ms, primary_responsibility_id, rotated_through, id_sequence';
const MEMBER_COLUMNS = 'group_id, id, position, display_name, is_admin, account_id, left_at';
const RESPONSIBILITY_COLUMNS = 'group_id, id, position, name, headcount, requires_confirmation, removed_at';
const SERIES_COLUMNS = 'group_id, id, position, name, responsibility_ids, repeat, removed_at';
const EVENT_COLUMNS = 'group_id, id, position, series_id, starts_at, responsibility_ids, skip_date_marked_at, skip_date_marked_by';
const ASSIGNMENT_COLUMNS =
  'id, position, event_id, responsibility_id, member_id, turn_of, make_up_turn_id, confirmation, coverage_reason, coverage_requested_by, coverage_requested_at, cover_kind, cover_member_id, cover_guest_name, cover_arranged_by, covered_at';

type GroupDetailRow = GroupRow & { name: string; time_zone: string };
type WithGroup<T> = T & { group_id: string };
type EventWithAssignments = WithGroup<EventRow> & { assignments: AssignmentRow[] };

function byGroup<T extends { group_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.group_id);
    if (list) list.push(row);
    else out.set(row.group_id, [row]);
  }
  return out;
}

/** Events load from the first day of the viewer's current month (the month view shows it all). */
export function scheduleWindowStart(now: Date, viewerTimeZone: string): string {
  const today = dateIn(now.toISOString(), viewerTimeZone);
  // A day's margin either side of the zone's midnight.
  return `${addDays(`${today.slice(0, 7)}-01`, -1)}T00:00:00.000Z`;
}

export async function fetchMySchedule(userId: string, now: Date = new Date()): Promise<MySchedule> {
  const viewerTimeZone = deviceTimeZone();
  const memberships = await supabase
    .from('members')
    .select(`id, group_id, groups(${GROUP_COLUMNS})`)
    .eq('account_id', userId)
    .is('left_at', null);
  if (memberships.error) throw memberships.error;
  const mine = (memberships.data ?? []).flatMap((m) => {
    const group = m.groups as unknown as GroupDetailRow | null;
    return group ? [{ memberId: m.id, group }] : [];
  });
  if (mine.length === 0) return { groups: [], viewerTimeZone };
  const ids = mine.map((m) => m.group.id);

  const [members, responsibilities, series, events] = await Promise.all([
    supabase.from('members').select(MEMBER_COLUMNS).in('group_id', ids),
    supabase.from('responsibilities').select(RESPONSIBILITY_COLUMNS).in('group_id', ids),
    supabase.from('event_series').select(SERIES_COLUMNS).in('group_id', ids),
    supabase
      .from('events')
      .select(`${EVENT_COLUMNS}, assignments(${ASSIGNMENT_COLUMNS})`)
      .in('group_id', ids)
      .gte('starts_at', scheduleWindowStart(now, viewerTimeZone))
      .order('starts_at')
      .limit(2000),
  ]);
  for (const result of [members, responsibilities, series, events]) if (result.error) throw result.error;

  const membersBy = byGroup((members.data ?? []) as unknown as WithGroup<MemberRow>[]);
  const responsibilitiesBy = byGroup((responsibilities.data ?? []) as unknown as WithGroup<ResponsibilityRow>[]);
  const seriesBy = byGroup((series.data ?? []) as unknown as WithGroup<EventSeriesRow>[]);
  const eventsBy = byGroup((events.data ?? []) as unknown as EventWithAssignments[]);

  const groups = mine.map(({ memberId, group }): ScheduleGroup => {
    const groupEvents = eventsBy.get(group.id) ?? [];
    const state = stateFromRows({
      group,
      members: membersBy.get(group.id) ?? [],
      responsibilities: responsibilitiesBy.get(group.id) ?? [],
      rotations: [],
      event_series: seriesBy.get(group.id) ?? [],
      events: groupEvents,
      time_off: [],
      make_up_turns: [],
      assignments: groupEvents.flatMap((e) => e.assignments ?? []),
    });
    return { id: group.id, name: group.name, timeZone: group.time_zone, state, myMemberId: memberId };
  });
  return { groups, viewerTimeZone };
}

/** Calls `onChange` (debounced) when the given tables change for any of the Groups. */
function useGroupsRealtime(
  label: string | null,
  groupIds: string[],
  tables: string[],
  onChange: () => void,
  extra?: { table: string; filter: string },
) {
  const bindings: PgBinding[] = [];
  if (label) {
    const ids = groupIds.join(',');
    // Realtime's `in` filter takes up to 100 values.
    if (ids) for (const table of tables) bindings.push({ event: '*', schema: 'public', table, filter: `group_id=in.(${ids})` });
    if (extra) bindings.push({ event: '*', schema: 'public', table: extra.table, filter: extra.filter });
  }
  // One engine write touches many rows: reload once they've all arrived.
  useRealtimeChanges(label ?? 'groups', label ? bindings : null, onChange, 400);
}

/** The person's schedule across all their Groups, kept current through Realtime. */
export function useMySchedule(): Loadable<MySchedule> {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const load = useCallback(() => fetchMySchedule(userId ?? ''), [userId]);
  const result = useLoader(userId, load, SCHEDULE_LOAD_FAILED);
  const groupIds = useMemo(() => (result.data?.groups ?? []).map((g) => g.id).sort().slice(0, 100), [result.data]);
  useGroupsRealtime(
    userId ? 'my-schedule' : null,
    groupIds,
    ['events', 'assignments'],
    result.reload,
    userId ? { table: 'members', filter: `account_id=eq.${userId}` } : undefined,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Schedule history

type HistoryRow = {
  id: number;
  at: string;
  actor_id: string | null;
  cause: unknown;
  changes: unknown;
  make_up_turns: unknown;
};

function historyRecord(row: HistoryRow): HistoryRecord {
  return {
    id: String(row.id),
    at: toInstant(row.at),
    actorId: row.actor_id,
    cause: row.cause as Cause,
    changes: Array.isArray(row.changes) ? (row.changes as AssignmentChange[]) : [],
    makeUpTurns: Array.isArray(row.make_up_turns) ? (row.make_up_turns as MakeUpTurnChange[]) : [],
  };
}

export async function fetchHistory(
  groupId: string,
  options: { assignmentId?: string; makeUpTurnId?: string | null; limit?: number } = {},
): Promise<HistoryRecord[]> {
  const limit = options.limit ?? 30;
  const columns = 'id, at, actor_id, cause, changes, make_up_turns';
  if (!options.assignmentId) {
    const { data, error } = await supabase
      .from('schedule_history')
      .select(columns)
      .eq('group_id', groupId)
      .order('at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => historyRecord(r as HistoryRow));
  }
  // One Assignment: the entries that changed it (jsonb containment on `changes`), plus the
  // payment of the Make-up Turn it carries.
  const queries = [
    supabase
      .from('schedule_history')
      .select(columns)
      .eq('group_id', groupId)
      .contains('changes', JSON.stringify([{ assignmentId: options.assignmentId }]))
      .order('at', { ascending: false })
      .limit(limit),
  ];
  if (options.makeUpTurnId) {
    queries.push(
      supabase
        .from('schedule_history')
        .select(columns)
        .eq('group_id', groupId)
        .eq('cause_type', 'makeUpTurnPaid')
        .contains('cause', JSON.stringify({ makeUpTurnId: options.makeUpTurnId }))
        .limit(5),
    );
  }
  const results = await Promise.all(queries);
  const rows: HistoryRow[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    rows.push(...((r.data ?? []) as HistoryRow[]));
  }
  return rows.map(historyRecord);
}

export type HistoryState = {
  entries: HistoryRecord[] | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * A Group's schedule history (or one Assignment's). It reloads when `version` changes (the
 * Group's state version, which every engine write bumps), keeping the old list on screen
 * meanwhile.
 */
export function useHistory(
  groupId: string | undefined,
  version: number | undefined,
  options: { assignmentId?: string; makeUpTurnId?: string | null; limit?: number } = {},
): HistoryState {
  const [entries, setEntries] = useState<HistoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { assignmentId, makeUpTurnId, limit } = options;
  useEffect(() => {
    if (!groupId || version === undefined) return;
    let live = true;
    fetchHistory(groupId, { assignmentId, makeUpTurnId, limit })
      .then((next) => {
        if (!live) return;
        setEntries(next);
        setError(null);
      })
      .catch((e) => {
        console.warn('Loading history failed', e);
        if (live) setError(HISTORY_LOAD_FAILED);
      });
    return () => {
      live = false;
    };
  }, [groupId, version, assignmentId, makeUpTurnId, limit, attempt]);
  return {
    entries,
    loading: entries === null && error === null,
    error,
    reload: () => setAttempt((n) => n + 1),
  };
}

/** A loaded Group as the schedule views see it. */
export function scheduleGroupOf(group: GroupDetails, accountId: string | null): ScheduleGroup {
  return {
    id: group.id,
    name: group.name,
    timeZone: group.timeZone,
    state: group.state,
    myMemberId: myMember(group.state, accountId)?.id ?? null,
  };
}
