/**
 * The request and response shapes of the `group-command` Edge Function, shared by the
 * function and the app (src/lib/groupCommand.ts). Types only.
 */
import type {
  AssignmentChange,
  Command,
  GroupSettings,
  HistoryEntry,
  NewEvent,
  NewEventSeries,
  NewResponsibility,
  RejectionReason,
  ResponsibilityId,
} from '../engine';

/**
 * An engine command as a client may send it. `claimPlaceholder` happens only through a
 * claim link (`join`), and `addMember` adds a Placeholder Member: the server picks its id.
 */
export type ClientCommand =
  | Exclude<Command, { type: 'addMember' } | { type: 'claimPlaceholder' }>
  | { type: 'addMember'; member: { name: string }; qualifiedFor?: ResponsibilityId[] };

export type ClientCommandType = ClientCommand['type'];

export type GroupCommandRequest =
  /** Run an engine command in a Group the caller is a Member of. */
  | { action: 'command'; groupId: string; command: ClientCommand }
  /** Create a Group with the caller as its first Admin. */
  | {
      action: 'createGroup';
      name: string;
      /** The creator's name in this Group. */
      memberName: string;
      timeZone?: string;
      settings?: Partial<GroupSettings>;
      responsibilities?: NewResponsibility[];
      primaryResponsibilityId?: ResponsibilityId | null;
      eventSeries?: NewEventSeries[];
      events?: NewEvent[];
      /** Responsibilities the creator is a Qualified Member of. */
      creatorQualifiedFor?: ResponsibilityId[];
    }
  /**
   * Join through an invite link. A Group's join link adds a new Member named
   * `memberName`, or with `standInId` ("Are you one of these?") claims that Stand-in
   * (Placeholder Member) of the link's Group; a personal claim link claims its own Stand-in
   * and ignores `standInId`. A claimed Stand-in keeps the name they were added with.
   */
  | { action: 'join'; token: string; memberName: string; standInId?: string }
  /**
   * Delete the Group (feedback-2 ticket 08): any active Member. Soft: the Group is hidden from
   * everyone and kept 30 days (docs/adr/0009-deleting-a-group.md). Succeeds with no changes.
   */
  | { action: 'deleteGroup'; groupId: string };

export type GroupCommandFailure =
  | RejectionReason
  /** The request was malformed. */
  | 'invalidRequest'
  /** No valid session. */
  | 'unauthenticated'
  /** The Group doesn't exist or the caller isn't an active Member of it. */
  | 'notMember'
  /** The invite link is unknown, reset, or already used. */
  | 'invalidInvite'
  /** The caller is already a Member of the Group they tried to join. */
  | 'alreadyMember'
  /** The Stand-in picked when joining was claimed or removed meanwhile: pick again. */
  | 'standInTaken'
  /** Others kept changing the Group; try again. */
  | 'conflict'
  | 'serverError';

export type GroupCommandResponse =
  | {
      ok: true;
      groupId: string;
      /** The caller's Member id in the Group. */
      memberId: string;
      /** groups.state_version after the change. */
      stateVersion: number;
      changes: AssignmentChange[];
      history: HistoryEntry[];
    }
  | {
      ok: false;
      reason: GroupCommandFailure;
      message: string;
      /** Set for `alreadyMember`, so the app can open the Group. */
      groupId?: string;
      memberId?: string;
    };
