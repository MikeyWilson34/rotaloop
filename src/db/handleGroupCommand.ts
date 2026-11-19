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
import type { Command, GroupState, HistoryEntry, Instant, Member, NewEvent } from '../engine';
import { expandSeries, horizonEnd, replacementEvents } from '../schedule/expandSeries';
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
  /** Ids of Groups with at least one active Event Series that has a repeat pattern. */
  groupsWithRepeatingSeries(): Promise<string[]>;
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

/** Everyone does every Job: a new Member (or Stand-in) joins every current Job's Rotation. */
function everyJob(state: GroupState): string[] {
  return state.responsibilities.filter((r) => r.removedAt === null).map((r) => r.id);
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
  plan: (state: GroupState, now: Instant) => Step,
  missing: () => Failure,
  mapRejection: (reason: Failure['reason'], message: string) => Failure = failure,
): Promise<GroupCommandResponse> {
  const attempts = context.maxAttempts ?? 4;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const loaded = await store.load(groupId);
    if (!loaded) return missing();
    const now = context.now();
    const step = plan(stateFromRows(loaded.rows), now);
    if ('done' in step) return step.done;

    const result = runEngine(step.state, step.command, now, step.actorId);
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
function runEngine(state: GroupState, command: Command, now: Instant, actorId: string | null) {
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
  const plan = (state: GroupState, now: Instant): Step => {
    const actor = activeMemberFor(state, context.accountId);
    if (!actor) return { done: notMember() };
    return { state, command: toEngineCommand(request.command, context, state, now), actorId: actor.id };
  };
  return commit(store, request.groupId, context, plan, notMember);
}

function toEngineCommand(command: ClientCommand, context: HandlerContext, state: GroupState, now: Instant): Command {
  switch (command.type) {
    case 'addMember':
      // Any Member adds a Stand-in (a Placeholder Member); the server picks the id. Unless
      // the client names Jobs, the Stand-in is in every Job's Rotation like anyone.
      return {
        type: 'addMember',
        member: { id: context.newId(), name: command.member.name, accountId: null },
        qualifiedFor: command.qualifiedFor ?? everyJob(state),
      };
    case 'addEventSeries':
      // A new series with a repeat pattern gets its Events up to the horizon in the same
      // command, so they are added and filled in one engine run (one history entry).
      if (command.series.repeat && command.events === undefined) {
        const events = expandSeries({
          seriesId: command.series.id,
          pattern: command.series.repeat,
          existing: state.events,
          now,
          until: horizonEnd(now),
        });
        return { ...command, events };
      }
      return command;
    case 'editEventSeries':
      // A new pattern replaces the series' future Events: those still at the same time keep
      // their Assignments, the rest go and the new dates are filled from the Rotations.
      if (command.changes.repeat && command.replaceFutureEvents === undefined) {
        const replaceFutureEvents = replacementEvents({
          seriesId: command.seriesId,
          pattern: command.changes.repeat,
          existing: state.events,
          now,
          until: horizonEnd(now),
        });
        return { ...command, replaceFutureEvents };
      }
      return command;
    default:
      return command;
  }
}

// ---------------------------------------------------------------------------
// Keeping every Group's horizon full (the daily system job)

/** The Events each active repeating series is missing up to the horizon. */
export function missingSeriesEvents(state: GroupState, now: Instant): NewEvent[] {
  const until = horizonEnd(now);
  const added: NewEvent[] = [];
  for (const series of state.eventSeries) {
    if (series.removedAt !== null || !series.repeat) continue;
    // Earlier series' new Events count as existing, so ids never clash.
    const existing = [...state.events, ...added];
    added.push(...expandSeries({ seriesId: series.id, pattern: series.repeat, existing, now, until }));
  }
  return added;
}

export interface HorizonReport {
  groups: number;
  /** Groups that got new Events. */
  extended: number;
  eventsAdded: number;
  /** Groups that could not be saved (conflicts or errors); the next run tries again. */
  failed: number;
}

/**
 * The daily system job: for every Group with a repeating Event Series, adds the Events
 * missing up to the rolling horizon (`addEvents` run as the system, which also fills their
 * Assignments). Groups with nothing missing are not written. Only the service role may run
 * it: the Edge Function checks the caller before calling this.
 */
export async function extendHorizons(
  store: GroupStore,
  context: Pick<HandlerContext, 'now' | 'maxAttempts'>,
): Promise<HorizonReport> {
  const report: HorizonReport = { groups: 0, extended: 0, eventsAdded: 0, failed: 0 };
  for (const groupId of await store.groupsWithRepeatingSeries()) {
    report.groups++;
    try {
      const added = await extendHorizon(store, groupId, context);
      if (added === null) report.failed++;
      else if (added > 0) {
        report.extended++;
        report.eventsAdded += added;
      }
    } catch (error) {
      console.error('extendHorizon failed', groupId, error);
      report.failed++;
    }
  }
  return report;
}

/** Adds one Group's missing Events. Returns how many, or null when it couldn't be saved. */
async function extendHorizon(
  store: GroupStore,
  groupId: string,
  context: Pick<HandlerContext, 'now' | 'maxAttempts'>,
): Promise<number | null> {
  const attempts = context.maxAttempts ?? 4;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const loaded = await store.load(groupId);
    if (!loaded) return 0;
    const now = context.now();
    const state = stateFromRows(loaded.rows);
    const events = missingSeriesEvents(state, now);
    if (events.length === 0) return 0;
    const result = runEngine(state, { type: 'addEvents', events }, now, null);
    if (!result.ok) {
      console.error('extendHorizon rejected', groupId, result.reason, result.message);
      return null;
    }
    const version = await store.persist({
      groupId,
      expectedVersion: loaded.version,
      rows: rowsFromState(result.state),
      history: result.history,
    });
    if (version !== null) return events.length;
  }
  return null;
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
        command: {
          type: 'addMember',
          member: { id: memberId, name: request.memberName, accountId: context.accountId },
          qualifiedFor: everyJob(state),
        },
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
  const now = context.now();
  // Repeating series get their Events up to the horizon; addEvents also fills the schedule.
  const missing = missingSeriesEvents(state, now);
  const command: Command = missing.length > 0 ? { type: 'addEvents', events: missing } : { type: 'fillSchedule' };
  const result = runEngine(state, command, now, memberId);
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
