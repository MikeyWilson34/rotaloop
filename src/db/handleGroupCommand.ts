/**
 * The server side of the `group-command` Edge Function, free of Deno and Supabase so it
 * runs under Node tests too. The function supplies a `GroupStore` (database access) and
 * the authenticated account id.
 *
 * Every change to scheduling state follows one path: load the Group's rows, rebuild the
 * GroupState, resolve the caller's Member id, run the engine with the server's clock (the
 * engine checks what that Member may do), and persist the result with the Group's
 * state_version as an optimistic lock. On a version
 * conflict the whole cycle runs again on fresh state, a few times at most. This is what
 * makes "first accept wins" on a Coverage Request race-safe: the loser's retry sees the
 * Cover and the engine rejects it with `alreadyCovered`.
 */
import { applyCommand, createGroupState } from '../engine';
import type { Command, GroupState, HistoryEntry, Instant, Member } from '../engine';
import { rowsFromState, stateFromRows, type GroupRow, type GroupRows } from './groupRows';
import { InvalidRequest, parseRequest } from './parseRequest';
import type { ClientCommand, GroupCommandRequest, GroupCommandResponse } from './protocol';

/** Extra `groups` columns written when a Group is created. */
export interface NewGroupDetails {
  name: string;
  time_zone: string;
  created_by: string;
}

export interface PersistInput {
  groupId: string;
  /** `null` creates the Group (then `newGroup` is set). */
  expectedVersion: number | null;
  rows: GroupRows;
  newGroup?: NewGroupDetails;
  history: HistoryEntry[];
}

export interface GroupStore {
  /** The Group's rows and state_version, or null if it doesn't exist. */
  load(groupId: string): Promise<{ rows: GroupRows; version: number } | null>;
  /** Writes the state in one transaction. Returns the new state_version, or null on a version conflict. */
  persist(input: PersistInput): Promise<number | null>;
  /** Resolves an invite link token. `memberId` is set for a Placeholder's claim link. */
  findInvite(token: string): Promise<{ groupId: string; memberId: string | null } | null>;
}

export interface HandlerContext {
  /** The authenticated caller (auth.users.id). */
  accountId: string;
  now(): Instant;
  /** A fresh UUID (used for Group and Member ids). */
  newId(): string;
  /** Attempts before giving up with `conflict`. Default 4. */
  maxAttempts?: number;
}

type Failure = Extract<GroupCommandResponse, { ok: false }>;

const failure = (reason: Failure['reason'], message: string, extra: Partial<Failure> = {}): Failure => ({
  ok: false,
  reason,
  message,
  ...extra,
});

export async function handleGroupCommand(
  store: GroupStore,
  body: unknown,
  context: HandlerContext,
): Promise<GroupCommandResponse> {
  let request: GroupCommandRequest;
  try {
    request = parseRequest(body);
  } catch (error) {
    if (error instanceof InvalidRequest) return failure('invalidRequest', error.message);
    throw error;
  }
  switch (request.action) {
    case 'command':
      return runCommand(store, request, context);
    case 'createGroup':
      return createGroup(store, request, context);
    case 'join':
      return join(store, request, context);
  }
}

// ---------------------------------------------------------------------------
// Membership resolution. What a Member may do is the engine's rule (see
// permissionError in src/engine/commands.ts); the server only decides who the caller is.

function activeMemberFor(state: GroupState, accountId: string): Member | undefined {
  return state.members.find((m) => m.accountId === accountId && m.leftAt === null);
}

// ---------------------------------------------------------------------------
// The load -> engine -> persist cycle

type Step =
  | { done: Failure }
  | { state: GroupState; command: Command; actorId: string };

async function commit(
  store: GroupStore,
  groupId: string,
  context: HandlerContext,
  plan: (state: GroupState) => Step,
  missing: () => Failure,
  mapRejection: (reason: Failure['reason'], message: string) => Failure = failure,
): Promise<GroupCommandResponse> {
  const attempts = context.maxAttempts ?? 4;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const loaded = await store.load(groupId);
    if (!loaded) return missing();
    const step = plan(stateFromRows(loaded.rows));
    if ('done' in step) return step.done;

    const result = runEngine(step.state, step.command, context.now(), step.actorId);
    if (!result.ok) return mapRejection(result.reason, result.message);

    const version = await store.persist({
      groupId,
      expectedVersion: loaded.version,
      rows: rowsFromState(result.state),
      history: result.history,
    });
    if (version !== null) {
      return {
        ok: true,
        groupId,
        memberId: step.actorId,
        stateVersion: version,
        changes: result.changes,
        history: result.history,
      };
    }
  }
  return failure('conflict', 'The Group changed while saving. Please try again.');
}

/** applyCommand, treating a throw (malformed input the parser let through) as a bad request. */
function runEngine(state: GroupState, command: Command, now: Instant, actorId: string) {
  try {
    return applyCommand(state, command, { now, actorId });
  } catch (error) {
    return { ok: false as const, reason: 'invalidRequest' as const, message: String(error) };
  }
}

function runCommand(
  store: GroupStore,
  request: Extract<GroupCommandRequest, { action: 'command' }>,
  context: HandlerContext,
): Promise<GroupCommandResponse> {
  const notMember = () => failure('notMember', 'You are not a Member of this Group');
  const plan = (state: GroupState): Step => {
    const actor = activeMemberFor(state, context.accountId);
    if (!actor) return { done: notMember() };
    return { state, command: toEngineCommand(request.command, context), actorId: actor.id };
  };
  return commit(store, request.groupId, context, plan, notMember);
}

function toEngineCommand(command: ClientCommand, context: HandlerContext): Command {
  if (command.type !== 'addMember') return command;
  // An Admin adds a Placeholder Member; the server picks the id.
  return {
    type: 'addMember',
    member: { id: context.newId(), name: command.member.name, accountId: null },
    qualifiedFor: command.qualifiedFor,
  };
}

// ---------------------------------------------------------------------------
// Joining

async function join(
  store: GroupStore,
  request: Extract<GroupCommandRequest, { action: 'join' }>,
  context: HandlerContext,
): Promise<GroupCommandResponse> {
  const invalid = () => failure('invalidInvite', 'This invite link is no longer valid');
  const invite = await store.findInvite(request.token);
  if (!invite) return invalid();

  return commit(
    store,
    invite.groupId,
    context,
    (state) => {
      const existing = activeMemberFor(state, context.accountId);
      if (existing) {
        return {
          done: failure('alreadyMember', 'You are already a Member of this Group', {
            groupId: state.groupId,
            memberId: existing.id,
          }),
        };
      }
      if (invite.memberId) {
        // A personal claim link: become that Placeholder Member.
        return {
          state,
          command: { type: 'claimPlaceholder', memberId: invite.memberId, accountId: context.accountId },
          actorId: invite.memberId,
        };
      }
      const memberId = context.newId();
      return {
        state,
        command: { type: 'addMember', member: { id: memberId, name: request.memberName, accountId: context.accountId } },
        actorId: memberId,
      };
    },
    invalid,
    // A Placeholder that was claimed or removed in the meantime makes the link invalid.
    (reason, message) => (invite.memberId && (reason === 'notFound' || reason === 'invalid') ? invalid() : failure(reason, message)),
  );
}

// ---------------------------------------------------------------------------
// Creating a Group

async function createGroup(
  store: GroupStore,
  request: Extract<GroupCommandRequest, { action: 'createGroup' }>,
  context: HandlerContext,
): Promise<GroupCommandResponse> {
  const groupId = context.newId();
  const memberId = context.newId();
  const qualified = new Set(request.creatorQualifiedFor ?? []);
  const state = createGroupState({
    groupId,
    settings: request.settings,
    primaryResponsibilityId: request.primaryResponsibilityId ?? null,
    members: [{ id: memberId, name: request.memberName, isAdmin: true, accountId: context.accountId }],
    responsibilities: (request.responsibilities ?? []).map((r) => ({
      ...r,
      qualifiedMemberIds: qualified.has(r.id) ? [memberId] : [],
    })),
    eventSeries: request.eventSeries,
    events: request.events,
  });
  const result = runEngine(state, { type: 'fillSchedule' }, context.now(), memberId);
  if (!result.ok) return failure(result.reason, result.message);

  const version = await store.persist({
    groupId,
    expectedVersion: null,
    rows: rowsFromState(result.state),
    newGroup: { name: request.name, time_zone: request.timeZone ?? 'UTC', created_by: context.accountId },
    history: result.history,
  });
  if (version === null) return failure('conflict', 'Could not create the Group. Please try again.');
  return { ok: true, groupId, memberId, stateVersion: version, changes: result.changes, history: result.history };
}

/** The `p_rows` argument of apply_group_command_result. */
export function persistPayload(input: PersistInput): GroupRows & { group: GroupRow & Partial<NewGroupDetails> } {
  return { ...input.rows, group: { ...input.rows.group, ...input.newGroup } };
}
