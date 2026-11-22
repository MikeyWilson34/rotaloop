/**
 * Typed client for the `group-command` Edge Function: the only way the app changes a
 * Group's scheduling state (see docs/adr/0004-schedule-writes-go-through-the-engine.md).
 * Reads go straight to the tables through RLS.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import type { ClientCommand, GroupCommandRequest, GroupCommandResponse } from '../db/protocol';
import { supabase } from './supabase';

export type {
  ClientCommand,
  GroupCommandFailure,
  GroupCommandRequest,
  GroupCommandResponse,
} from '../db/protocol';
export type {
  EventSeriesChanges,
  NewEventSeries,
  NewResponsibility,
  RepeatFrequency,
  RepeatPattern,
  ResponsibilityChanges,
} from '../engine';

/** The client command of one type, e.g. `CommandOf<'editResponsibility'>`. */
export type CommandOf<T extends ClientCommand['type']> = Extract<ClientCommand, { type: T }>;

/** Sends a request; failures (including HTTP errors) come back as `{ ok: false, reason }`. */
export async function invokeGroupCommand(request: GroupCommandRequest): Promise<GroupCommandResponse> {
  const { data, error } = await supabase.functions.invoke<GroupCommandResponse>('group-command', { body: request });
  if (!error && data) return data;
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as GroupCommandResponse;
      if (body && typeof body === 'object' && 'ok' in body) return body;
    } catch {
      // fall through
    }
  }
  return { ok: false, reason: 'serverError', message: error?.message ?? 'No response from the server' };
}

/**
 * Runs an engine command in a Group the caller belongs to. The engine decides what the
 * caller may do: a refusal comes back as `{ ok: false, reason }`, e.g. `notPermitted`
 * (Admins only, or someone else's Time Off) or `lastAdmin`.
 */
export function runGroupCommand(groupId: string, command: ClientCommand): Promise<GroupCommandResponse> {
  return invokeGroupCommand({ action: 'command', groupId, command });
}

export function createGroup(
  group: Omit<Extract<GroupCommandRequest, { action: 'createGroup' }>, 'action'>,
): Promise<GroupCommandResponse> {
  return invokeGroupCommand({ action: 'createGroup', ...group });
}

/** Deletes the Group for everyone (any Member; feedback-2 ticket 08). */
export function deleteGroup(groupId: string): Promise<GroupCommandResponse> {
  return invokeGroupCommand({ action: 'deleteGroup', groupId });
}

/**
 * Joins through a Group's invite link, or claims a Placeholder through a personal claim link.
 * `standInId` ("Are you one of these?" on the join link) claims that Stand-in instead.
 */
export function joinGroup(token: string, memberName: string, standInId?: string): Promise<GroupCommandResponse> {
  return invokeGroupCommand(standInId ? { action: 'join', token, memberName, standInId } : { action: 'join', token, memberName });
}
