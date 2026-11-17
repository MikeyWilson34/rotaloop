/**
 * Loading Home: the cross-group schedule (`useMySchedule`, with its Realtime) plus what Home
 * needs on top, for all the Groups at once: Rotations (who is Qualified to cover), outstanding
 * Make-up Turns (the hero's and attention notes) and the last two weeks of schedule history
 * ("moved" notices and the Admins' recent changes). Three extra queries, whatever the number
 * of Groups; they re-run whenever the schedule reloads.
 */
import { useEffect, useMemo, useState } from 'react';

import { fetchFeed } from '../activity/data';
import { toInstant, type MakeUpTurnRow, type RotationRow } from '../db/groupRows';
import type { MakeUpTurn, Rotation } from '../engine';
import type { Loadable } from '../lib/groups';
import { useMySchedule } from '../lib/schedule';
import { supabase } from '../lib/supabase';
import type { HomeGroup } from './home';

/** History loaded for Home: enough for "recent changes" (7 days) and recent moves. */
export const HOME_HISTORY_DAYS = 14;

type Extras = {
  rotations: Map<string, Rotation[]>;
  makeUpTurns: Map<string, MakeUpTurn[]>;
  history: Map<string, HomeGroup['history']>;
};

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export async function fetchHomeExtras(groupIds: string[], now: Date = new Date()): Promise<Extras> {
  const extras: Extras = { rotations: new Map(), makeUpTurns: new Map(), history: new Map() };
  if (groupIds.length === 0) return extras;
  const since = new Date(now.getTime() - HOME_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [rotations, turns, history] = await Promise.all([
    supabase.from('rotations').select('group_id, responsibility_id, position, queue, turns_taken_early').in('group_id', groupIds),
    supabase
      .from('make_up_turns')
      .select('group_id, id, position, responsibility_id, debtor_id, creditor_id, cover_assignment_id, created_at, status, closed_at, closed_reason')
      .in('group_id', groupIds)
      .eq('status', 'outstanding'),
    fetchFeed(groupIds, { since, limit: 500 }),
  ]);
  if (rotations.error) throw rotations.error;
  if (turns.error) throw turns.error;
  for (const r of (rotations.data ?? []) as unknown as (RotationRow & { group_id: string })[]) {
    push(extras.rotations, r.group_id, {
      responsibilityId: r.responsibility_id,
      queue: [...r.queue],
      turnsTakenEarly: { ...(r.turns_taken_early ?? {}) },
    });
  }
  for (const t of (turns.data ?? []) as unknown as (MakeUpTurnRow & { group_id: string })[]) {
    push(extras.makeUpTurns, t.group_id, {
      id: t.id,
      responsibilityId: t.responsibility_id,
      debtorId: t.debtor_id,
      creditorId: t.creditor_id,
      coverAssignmentId: t.cover_assignment_id,
      createdAt: toInstant(t.created_at),
      status: t.status,
      closedAt: t.closed_at ? toInstant(t.closed_at) : null,
      closedReason: t.closed_reason,
    });
  }
  for (const e of history.entries) push(extras.history, e.groupId, e);
  return extras;
}

export type HomeData = { groups: HomeGroup[]; viewerTimeZone: string };

export function useHomeData(): Loadable<HomeData> {
  const schedule = useMySchedule();
  const [extras, setExtras] = useState<{ for: unknown; value: Extras } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = schedule.data;

  useEffect(() => {
    if (!data) return;
    let live = true;
    fetchHomeExtras(data.groups.map((g) => g.id)).then(
      (value) => {
        if (!live) return;
        setExtras({ for: data, value });
        setError(null);
      },
      (e) => {
        console.warn('Loading Home failed', e);
        if (live) setError("Couldn't load your Home. Check your connection and try again.");
      },
    );
    return () => {
      live = false;
    };
  }, [data]);

  // Keep showing the last extras while a reload is under way (no flicker on Realtime reloads).
  const combined = useMemo((): HomeData | null => {
    if (!data || !extras) return null;
    const { value } = extras;
    return {
      viewerTimeZone: data.viewerTimeZone,
      groups: data.groups.map((g) => ({
        ...g,
        state: { ...g.state, rotations: value.rotations.get(g.id) ?? [], makeUpTurns: value.makeUpTurns.get(g.id) ?? [] },
        history: value.history.get(g.id) ?? [],
      })),
    };
  }, [data, extras]);

  return {
    data: combined,
    loading: schedule.loading || (!combined && !error && !schedule.error),
    error: schedule.error ?? (combined ? null : error),
    refresh: async () => {
      await schedule.refresh();
    },
    reload: async () => {
      await schedule.reload();
    },
    refreshing: schedule.refreshing,
  };
}
