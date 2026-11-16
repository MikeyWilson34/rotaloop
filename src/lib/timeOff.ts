/**
 * Loading and saving Time Off across all the person's Groups (the Time Off screen).
 *
 * Time Off is per Member per Group in the engine, so the screen loads each Group's full state
 * (`group_state_rows`, needed for the engine preview), and a save sends `addTimeOff` to each
 * Group in turn. The pure logic (entries, preview, list) is in src/schedule/timeOff.ts.
 */
import { useCallback } from 'react';

import type { NewTimeOff } from '../engine';
import type { TimeOffGroup, TimeOffPlan } from '../schedule/timeOff';
import { runGroupCommand, type ClientCommand, type GroupCommandResponse } from './groupCommand';
import { groupCommandMessage, type GroupAction } from './groupErrors';
import { fetchGroup, useLoader, type Loadable } from './groups';
import { myMember } from './groupViews';
import { useSession } from './session';
import { supabase } from './supabase';

export const TIME_OFF_LOAD_FAILED = "Couldn't load your groups. Check your connection and try again.";

/** Every Group the person is an active Member of, with its full engine state. */
export async function fetchMyGroupStates(userId: string): Promise<TimeOffGroup[]> {
  const { data, error } = await supabase.from('members').select('group_id').eq('account_id', userId).is('left_at', null);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((m) => m.group_id))];
  const groups = await Promise.all(ids.map((id) => fetchGroup(id)));
  return groups
    .flatMap((g) => {
      const me = myMember(g.state, userId);
      return me ? [{ id: g.id, name: g.name, timeZone: g.timeZone, state: g.state, myMemberId: me.id }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function useMyGroupStates(): Loadable<TimeOffGroup[]> {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const load = useCallback(() => fetchMyGroupStates(userId ?? ''), [userId]);
  return useLoader(userId, load, TIME_OFF_LOAD_FAILED);
}

/** A plain-language message for a refused Time Off or Skip Date command. */
export function timeOffMessage(reason: string, action: GroupAction): string {
  if (reason === 'notPermitted' && (action === 'addTimeOff' || action === 'removeTimeOff')) {
    return 'You can only change your own Time Off.';
  }
  return groupCommandMessage(reason, action);
}

/** Runs a command, retrying once when others changed the Group at the same moment. */
async function runWithRetry(groupId: string, command: ClientCommand): Promise<GroupCommandResponse> {
  const first = await runGroupCommand(groupId, command);
  if (first.ok || first.reason !== 'conflict') return first;
  return runGroupCommand(groupId, command);
}

export type GroupOutcome = { groupId: string; groupName: string; error: string | null };

/** Saves the plan, Group by Group. Stops a Group at its first refusal. */
export async function saveTimeOff(plan: TimeOffPlan): Promise<GroupOutcome[]> {
  const out: GroupOutcome[] = [];
  for (const { group, entries } of plan) {
    let error: string | null = null;
    for (const timeOff of entries as NewTimeOff[]) {
      const result = await runWithRetry(group.id, { type: 'addTimeOff', timeOff });
      if (!result.ok) {
        error = timeOffMessage(result.reason, 'addTimeOff');
        break;
      }
    }
    out.push({ groupId: group.id, groupName: group.name, error });
  }
  return out;
}

/** Removes every engine Time Off of one save. Swaps already made stay (the engine keeps them). */
export async function removeTimeOff(
  entries: { groupId: string; timeOffId: string }[],
  groups: TimeOffGroup[],
): Promise<GroupOutcome[]> {
  const out = new Map<string, GroupOutcome>();
  for (const { groupId, timeOffId } of entries) {
    const groupName = groups.find((g) => g.id === groupId)?.name ?? '';
    const previous = out.get(groupId);
    if (previous?.error) continue;
    const result = await runWithRetry(groupId, { type: 'removeTimeOff', timeOffId });
    out.set(groupId, {
      groupId,
      groupName,
      // Already removed elsewhere is fine.
      error: result.ok || result.reason === 'notFound' ? null : timeOffMessage(result.reason, 'removeTimeOff'),
    });
  }
  return [...out.values()];
}

/** "Couldn't save in Youth Team: ..." lines for the groups that failed. */
export function outcomeErrors(outcomes: GroupOutcome[], verb: string): string | null {
  const failed = outcomes.filter((o) => o.error);
  if (failed.length === 0) return null;
  if (outcomes.length === 1) return failed[0].error;
  return failed.map((o) => `Couldn't ${verb} in ${o.groupName}: ${o.error}`).join('\n');
}
