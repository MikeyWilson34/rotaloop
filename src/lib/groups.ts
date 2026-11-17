/**
 * Reading Groups: the signed-in person's Groups (Groups tab) and one Group's full state
 * (Group screen). Reads go through RLS; writes go through `group-command` (groupCommand.ts).
 * The open Group follows Realtime changes on `groups` and `members`, so membership changes
 * made elsewhere show up live.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GroupRow, GroupRows } from '../db/groupRows';
import { stateFromRows } from '../db/groupRows';
import type { GroupState } from '../engine';
import { runGroupCommand, type ClientCommand } from './groupCommand';
import { groupCommandMessage, groupDetailsMessage, type GroupAction } from './groupErrors';
import { groupCards, type GroupCardView } from './groupViews';
import { useRealtimeChanges } from './realtime';
import { useSession } from './session';
import { supabase } from './supabase';

export type Loadable<T> = {
  data: T | null;
  /** True until the first load finishes. */
  loading: boolean;
  /** A plain-language message when the last load failed. */
  error: string | null;
  /** Re-fetches, showing `refreshing` (pull to refresh). */
  refresh: () => Promise<void>;
  /** Re-fetches quietly (after a change made here or elsewhere). */
  reload: () => Promise<void>;
  /** True while a refresh (not the first load) is running. */
  refreshing: boolean;
};

export const LOAD_FAILED = "Couldn't load your groups. Check your connection and try again.";
export const GROUP_LOAD_FAILED = "Couldn't load this group. Check your connection and try again.";
export const GROUP_GONE = "This group isn't available. You may have left it or been removed.";

/**
 * Runs `load` now, on every refresh, and when the screen regains focus. Results from stale
 * runs are dropped.
 */
export function useLoader<T>(key: string | null, load: () => Promise<T>, failedMessage: string): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const run = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(async () => {
    if (!key) return;
    const id = ++run.current;
    try {
      const next = await loadRef.current();
      if (id !== run.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      console.warn('Loading failed', e);
      if (id !== run.current) return;
      setError(e instanceof GoneError ? e.message : failedMessage);
    } finally {
      if (id === run.current) {
        setLoadedKey(key);
        setRefreshing(false);
      }
    }
  }, [key, failedMessage]);

  const refreshVisibly = useCallback(async () => {
    setRefreshing(true);
    await refresh();
  }, [refresh]);

  // Reload whenever the screen comes into focus (including the first time).
  useFocusEffect(
    useCallback(() => {
      Promise.resolve().then(refresh);
    }, [refresh]),
  );

  const current = key !== null && loadedKey === key;
  return {
    data: current ? data : null,
    loading: key !== null && !current,
    error: current ? error : null,
    refresh: refreshVisibly,
    reload: refresh,
    refreshing,
  };
}

export class GoneError extends Error {}

// ---------------------------------------------------------------------------
// The person's Groups

export function useMyGroups(): Loadable<GroupCardView[]> {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const load = useCallback(async (): Promise<GroupCardView[]> => {
    if (!userId) return [];
    const { data: memberships, error } = await supabase
      .from('members')
      .select('group_id, is_admin, groups(name, time_zone)')
      .eq('account_id', userId)
      .is('left_at', null);
    if (error) throw error;
    const rows = (memberships ?? []).flatMap((m) =>
      m.groups ? [{ groupId: m.group_id, isAdmin: m.is_admin, name: m.groups.name, timeZone: m.groups.time_zone }] : [],
    );
    const now = new Date();
    let events: { group_id: string; starts_at: string; skip_date_marked_at: string | null }[] = [];
    if (rows.length > 0) {
      const result = await supabase
        .from('events')
        .select('group_id, starts_at, skip_date_marked_at')
        .in(
          'group_id',
          rows.map((r) => r.groupId),
        )
        .gte('starts_at', now.toISOString())
        .is('skip_date_marked_at', null)
        .order('starts_at')
        .limit(500);
      if (result.error) throw result.error;
      events = result.data ?? [];
    }
    return groupCards(
      rows,
      events.map((e) => ({ groupId: e.group_id, startsAt: e.starts_at, skipped: e.skip_date_marked_at !== null })),
      now,
    );
  }, [userId]);

  const result = useLoader(userId, load, LOAD_FAILED);
  const { reload } = result;

  // Joining, leaving or being removed elsewhere (another device, an Admin).
  useRealtimeChanges(
    'my-memberships',
    userId ? [{ event: '*', schema: 'public', table: 'members', filter: `account_id=eq.${userId}` }] : null,
    reload,
  );

  return result;
}

// ---------------------------------------------------------------------------
// One Group

export type GroupDetails = {
  id: string;
  name: string;
  timeZone: string;
  stateVersion: number;
  /** The engine's view of the Group (stateFromRows), for lists and local previews. */
  state: GroupState;
};

type GroupStateRowsResult = GroupRows & {
  group: (GroupRow & { name: string; time_zone: string; state_version: number }) | null;
};

export async function fetchGroup(groupId: string): Promise<GroupDetails> {
  const { data, error } = await supabase.rpc('group_state_rows', { p_group_id: groupId });
  if (error) throw error;
  const rows = data as unknown as GroupStateRowsResult;
  if (!rows?.group) throw new GoneError(GROUP_GONE);
  return {
    id: rows.group.id,
    name: rows.group.name,
    timeZone: rows.group.time_zone,
    stateVersion: Number(rows.group.state_version),
    state: stateFromRows(rows as GroupRows),
  };
}

/** A Group's full state, kept current through Realtime while the screen is open. */
export function useGroup(groupId: string | undefined): Loadable<GroupDetails> {
  const id = groupId ?? null;
  const load = useCallback(() => fetchGroup(id ?? ''), [id]);
  const result = useLoader(id, load, GROUP_LOAD_FAILED);
  const { reload } = result;

  // Shared with any other mounted screen for the same Group (see realtimeHub.ts).
  useRealtimeChanges(
    'group',
    id
      ? [
          { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${id}` },
          { event: '*', schema: 'public', table: 'members', filter: `group_id=eq.${id}` },
        ]
      : null,
    reload,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Changing a Group

/**
 * Runs a `group-command` command and reloads the Group. Resolves to a plain-language error,
 * or null when it worked.
 */
export function useRunCommand(
  groupId: string | undefined,
  reload: () => Promise<void>,
): (command: ClientCommand, action: GroupAction) => Promise<string | null> {
  return useCallback(
    async (command: ClientCommand, action: GroupAction) => {
      if (!groupId) return groupCommandMessage('notMember', action);
      const result = await runGroupCommand(groupId, command);
      if (!result.ok) return groupCommandMessage(result.reason, action);
      await reload();
      return null;
    },
    [groupId, reload],
  );
}

/** Renames the Group and/or changes its time zone (Admins only). Resolves to an error message or null. */
export async function updateGroupDetails(groupId: string, name: string, timeZone: string): Promise<string | null> {
  const { error } = await supabase.rpc('update_group_details', {
    p_group_id: groupId,
    p_name: name.trim(),
    p_time_zone: timeZone,
  });
  return error ? groupDetailsMessage(error) : null;
}
