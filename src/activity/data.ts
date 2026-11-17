/**
 * Loading schedule history across the person's Groups: the Activity feed (pages of ~30, newest
 * first, kept current through Realtime), the tab's unread count, and recent history for Home.
 * RLS limits every query to Groups the person belongs to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toInstant } from '../db/groupRows';
import type { AssignmentChange, Cause, Instant, MakeUpTurnChange } from '../engine';
import { useRealtimeChanges } from '../lib/realtime';
import { useMySchedule, type MySchedule } from '../lib/schedule';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { newestAt, unreadCount, type FeedEntry } from './feed';
import { lastSeenStore, useLastSeen } from './lastSeen';

export const ACTIVITY_PAGE_SIZE = 30;
export const ACTIVITY_LOAD_FAILED = "Couldn't load activity. Check your connection and try again.";

const COLUMNS = 'id, group_id, at, actor_id, cause, changes, make_up_turns';

type Row = {
  id: number;
  group_id: string;
  at: string;
  actor_id: string | null;
  cause: unknown;
  changes: unknown;
  make_up_turns: unknown;
};

export type FeedCursor = { at: string; id: number };

function entryOf(row: Row): FeedEntry {
  return {
    id: String(row.id),
    groupId: row.group_id,
    at: toInstant(row.at),
    actorId: row.actor_id,
    cause: row.cause as Cause,
    changes: Array.isArray(row.changes) ? (row.changes as AssignmentChange[]) : [],
    makeUpTurns: Array.isArray(row.make_up_turns) ? (row.make_up_turns as MakeUpTurnChange[]) : [],
  };
}

/**
 * History of the Groups, newest first, without routine entries (the schedule filling itself
 * in, Events added by the daily job): see `isFeedWorthy`.
 */
export async function fetchFeed(
  groupIds: string[],
  options: { before?: FeedCursor | null; since?: Instant; limit?: number; columns?: string } = {},
): Promise<{ entries: FeedEntry[]; next: FeedCursor | null }> {
  if (groupIds.length === 0) return { entries: [], next: null };
  const limit = options.limit ?? ACTIVITY_PAGE_SIZE;
  let query = supabase
    .from('schedule_history')
    .select(COLUMNS)
    .in('group_id', groupIds)
    .neq('cause_type', 'fillSchedule')
    .or('actor_id.not.is.null,cause_type.neq.addEvents');
  if (options.since) query = query.gte('at', options.since);
  if (options.before) {
    const { at, id } = options.before;
    query = query.or(`at.lt.${at},and(at.eq.${at},id.lt.${id})`);
  }
  const { data, error } = await query.order('at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const last = rows[rows.length - 1];
  return { entries: rows.map(entryOf), next: rows.length === limit && last ? { at: last.at, id: last.id } : null };
}

/** Calls `onInsert` (debounced) when history is written for any of the Groups. */
export function useHistoryRealtime(name: string | null, groupIds: string[], onInsert: () => void) {
  const ids = groupIds.slice(0, 100).sort().join(',');
  useRealtimeChanges(
    name ?? 'history',
    name && ids
      ? [{ event: 'INSERT', schema: 'public', table: 'schedule_history', filter: `group_id=in.(${ids})` }]
      : null,
    onInsert,
    400,
  );
}

// ---------------------------------------------------------------------------
// The Activity tab

export type ActivityFeed = {
  schedule: MySchedule | null;
  entries: FeedEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  refreshing: boolean;
};

function merge(a: FeedEntry[], b: FeedEntry[]): FeedEntry[] {
  const seen = new Map<string, FeedEntry>();
  for (const e of [...a, ...b]) seen.set(`${e.groupId}:${e.id}`, e);
  return [...seen.values()].sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || Number(y.id) - Number(x.id));
}

export function useActivityFeed(): ActivityFeed {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const schedule = useMySchedule();
  const groupIds = useMemo(() => (schedule.data?.groups ?? []).map((g) => g.id).sort(), [schedule.data]);
  const idsKey = groupIds.join(',');
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [next, setNext] = useState<FeedCursor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const run = useRef(0);

  /** The newest page, merged with older pages already loaded. */
  const loadFirst = useCallback(
    async (replace: boolean) => {
      const id = ++run.current;
      try {
        const page = await fetchFeed(idsKey ? idsKey.split(',') : []);
        if (id !== run.current) return;
        setEntries((old) => (replace || !old ? page.entries : merge(page.entries, old)));
        if (replace) setNext(page.next);
        setError(null);
      } catch (e) {
        console.warn('Loading activity failed', e);
        if (id === run.current) setError(ACTIVITY_LOAD_FAILED);
      }
    },
    [idsKey],
  );

  useEffect(() => {
    if (schedule.data) void Promise.resolve().then(() => loadFirst(true));
  }, [schedule.data !== null, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useHistoryRealtime(userId ? 'activity' : null, groupIds, () => void loadFirst(false));

  const loadMore = useCallback(() => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    fetchFeed(groupIds, { before: next })
      .then((page) => {
        setEntries((old) => merge(old ?? [], page.entries));
        setNext(page.next);
      })
      .catch(() => setError(ACTIVITY_LOAD_FAILED))
      .finally(() => setLoadingMore(false));
  }, [next, loadingMore, groupIds]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await schedule.reload();
    await loadFirst(true);
    setRefreshing(false);
  }, [schedule, loadFirst]);

  const noGroups = schedule.data !== null && groupIds.length === 0;
  return {
    schedule: schedule.data,
    entries: entries ?? [],
    loading: schedule.loading || (!noGroups && entries === null && !error && !schedule.error),
    error: schedule.error ?? error,
    hasMore: next !== null,
    loadingMore,
    loadMore,
    refresh,
    refreshing,
  };
}

// ---------------------------------------------------------------------------
// The unread count on the Activity tab

/** Unread history since "last seen", across the person's Groups (excluding their own actions). */
export function useActivityUnreadCount(): number {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const lastSeen = useLastSeen(userId);
  const [memberships, setMemberships] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);
  const groupIds = useMemo(() => Object.keys(memberships).sort(), [memberships]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    supabase
      .from('members')
      .select('id, group_id')
      .eq('account_id', userId)
      .is('left_at', null)
      .then(({ data }) => {
        if (live && data) setMemberships(Object.fromEntries(data.map((m) => [m.group_id, m.id])));
      });
    return () => {
      live = false;
    };
  }, [userId]);

  const recount = useCallback(async () => {
    if (!userId || !lastSeen || groupIds.length === 0) {
      setCount(0);
      return;
    }
    try {
      const page = await fetchFeed(groupIds, { since: lastSeen, limit: 100 });
      setCount(unreadCount(page.entries, lastSeen, memberships));
    } catch {
      // keep the last count
    }
  }, [userId, lastSeen, groupIds, memberships]);

  useEffect(() => {
    void Promise.resolve().then(recount);
  }, [recount]);

  // First visit on this device: start counting from now.
  useEffect(() => {
    if (userId && lastSeen === null) void lastSeenStore.markSeen(userId, new Date().toISOString());
  }, [userId, lastSeen]);

  useHistoryRealtime(userId ? 'activity-badge' : null, groupIds, () => void recount());
  return count;
}

/** Marks everything up to the newest loaded entry (or now) as seen. */
export function markActivitySeen(userId: string, entries: FeedEntry[]) {
  void lastSeenStore.markSeen(userId, newestAt(entries) ?? new Date().toISOString());
}
