import { CircleAlert, CircleCheck, Info, Repeat } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Notice, StatusPill, Text } from '@/components/ui';
import { assignmentActions, type AssignmentAction } from '@/coverage/actions';
import {
  coveragePanelView,
  coverSheetView,
  declineSheetView,
  markCoveredSheetView,
  nameList,
  successMessage,
  type SheetContext,
} from '@/coverage/sheets';
import type { GroupDetails } from '@/lib/groups';
import { isQualified } from '@/engine/state';
import type { EventView, SlotView } from '@/schedule/views';
import { useTheme } from '@/theme';

import { CoverSheet, DeclineSheet, MarkCoveredSheet } from './CoverageSheets';
import { Note, PeopleRow } from './parts';
import { useAssignmentCommand } from './useAssignmentCommand';

const SHEETS = ['decline', 'cover', 'markCovered'] as const;
type SheetKind = (typeof SHEETS)[number];

export type AssignmentActionsProps = {
  group: GroupDetails;
  myMemberId: string;
  event: EventView;
  slot: SlotView;
  now: string;
  viewerTimeZone: string;
  reload: () => Promise<void>;
  /** Opens a sheet on arrival (`?action=decline|cover|markCovered`), when that action is offered. */
  initialSheet?: string;
};

/**
 * The Assignment screen's actions (ticket 09): Confirm / Can't make it for the assigned Member,
 * "I can cover" for Qualified Members on a Coverage Request, and "Mark covered" for whoever holds
 * Replacement Duty (and any Admin). Buttons are disabled while a command runs; an inline
 * confirmation shows when it worked, and Realtime plus the reload bring the final state.
 */
export function AssignmentActions({
  group,
  myMemberId,
  event,
  slot,
  now,
  viewerTimeZone,
  reload,
  initialSheet,
}: AssignmentActionsProps) {
  const { space } = useTheme();
  const { state } = group;
  const assignment = state.assignments.find((a) => a.id === slot.assignmentId);
  const me = state.members.find((m) => m.id === myMemberId);
  const { send, busy } = useAssignmentCommand(group.id, myMemberId, reload);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const responsibility = state.responsibilities.find((r) => r.id === slot.responsibilityId);
  const view = assignment
    ? assignmentActions({
        assignment,
        eventStartsAt: event.startsAt,
        requiresConfirmation: responsibility?.requiresConfirmation ?? false,
        qualified: isQualified(state, myMemberId, slot.responsibilityId),
        me: me && me.leftAt === null ? myMemberId : null,
        isAdmin: !!me?.isAdmin,
        settings: state.settings,
        now,
      })
    : null;

  // Open the sheet asked for in the URL on arrival, if that action is on offer.
  const [sheet, setSheet] = useState<SheetKind | null>(() => {
    const wanted = SHEETS.find((k) => k === initialSheet);
    return wanted && view?.actions.some((a) => a.command === wanted) ? wanted : null;
  });

  if (!assignment || !view) return null;

  const ctx: SheetContext = { state, groupName: group.name, viewerTimeZone, me: myMemberId, now };
  const coveringNow = assignment.coverageRequest?.cover?.kind === 'member' && assignment.coverageRequest.cover.memberId === myMemberId;

  function closeSheet() {
    setSheet(null);
    setSheetError(null);
  }

  async function run(action: AssignmentAction) {
    setError(null);
    setDone(null);
    if (action.command === 'confirm') {
      const result = await send({ type: 'confirm', assignmentId: slot.assignmentId }, 'confirm');
      if (result.ok) setDone(successMessage('confirm', slot.responsibilityName, event.date));
      else setError(result.message);
      return;
    }
    setSheetError(null);
    setSheet(action.command);
  }

  async function submit(kind: SheetKind, command: Parameters<typeof send>[0], message: string) {
    setSheetError(null);
    const result = await send(command, kind);
    if (result.ok) {
      setSheet(null);
      setDone(message);
    } else setSheetError(result.message);
  }

  const panel = coveragePanelView(state, assignment, event.startsAt, myMemberId, !!me?.isAdmin, now);
  const note = stateNote(view.state, responsibility?.requiresConfirmation ?? false);

  return (
    <View style={{ gap: space.md, marginTop: space.md }}>
      {panel ? <CoveragePanel status={slot.status} headline={panel.headline} detail={panel.detail} asked={panel.asked} /> : null}
      {note ? (
        <Note icon={note.tone === 'success' ? CircleCheck : note.tone === 'primary' ? Repeat : Info} tone={note.tone}>
          {note.text}
        </Note>
      ) : null}
      {view.actions.length ? <ActionButtons actions={view.actions} busy={busy} onPress={run} /> : null}
      {done ? (
        <Note icon={CircleCheck} tone="success" live>
          {done}
        </Note>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}

      {sheet === 'decline' ? (
        <DeclineSheetHost
          ctx={ctx}
          assignmentId={slot.assignmentId}
          busy={busy}
          error={sheetError}
          onClose={closeSheet}
          onSubmit={() =>
            submit(
              'decline',
              { type: 'decline', assignmentId: slot.assignmentId },
              successMessage(coveringNow ? 'withdrawCover' : 'decline', slot.responsibilityName, event.date),
            )
          }
        />
      ) : null}
      {sheet === 'cover' ? (
        <CoverSheetHost
          ctx={ctx}
          assignmentId={slot.assignmentId}
          groupTimeZone={group.timeZone}
          busy={busy}
          error={sheetError}
          onClose={closeSheet}
          onSubmit={() =>
            submit(
              'cover',
              { type: 'cover', assignmentId: slot.assignmentId },
              successMessage('cover', slot.responsibilityName, event.date),
            )
          }
        />
      ) : null}
      {sheet === 'markCovered' ? (
        <MarkCoveredSheetHost
          ctx={ctx}
          assignmentId={slot.assignmentId}
          busy={busy}
          error={sheetError}
          onClose={closeSheet}
          onPickMember={(memberId, name) =>
            submit(
              'markCovered',
              { type: 'markCovered', assignmentId: slot.assignmentId, by: { memberId } },
              successMessage('markCovered', slot.responsibilityName, event.date, name === 'You' ? 'you' : name),
            )
          }
          onGuest={(guestName) =>
            submit(
              'markCovered',
              { type: 'markCovered', assignmentId: slot.assignmentId, by: { guestName } },
              successMessage('markCovered', slot.responsibilityName, event.date, `${guestName} (guest)`),
            )
          }
        />
      ) : null}
    </View>
  );
}

function stateNote(
  state: ReturnType<typeof assignmentActions>['state'],
  requiresConfirmation: boolean,
): { tone: 'success' | 'neutral' | 'primary'; text: string } | null {
  switch (state) {
    case 'mineConfirmed':
      return { tone: 'success', text: "You're confirmed. Thank you!" };
    case 'mineScheduled':
      return {
        tone: 'neutral',
        text: requiresConfirmation
          ? "We'll ask you to confirm closer to the Event."
          : "This Responsibility doesn't need confirmation.",
      };
    case 'mineCovering':
      return { tone: 'primary', text: "You're covering this. Thank you!" };
    default:
      return null;
  }
}

function ActionButtons({
  actions,
  busy,
  onPress,
}: {
  actions: AssignmentAction[];
  busy: boolean;
  onPress: (a: AssignmentAction) => void;
}) {
  const { space } = useTheme();
  // Confirm / Can't make it sit side by side (prototype `.btn-row`); the rest stack full width.
  const paired = actions.length === 2 && actions.every((a) => a.kind === 'confirm' || a.kind === 'confirmEarly' || a.kind === 'decline');
  return (
    <View style={{ flexDirection: paired ? 'row' : 'column', gap: space.sm }}>
      {actions.map((a) => (
        <Button
          key={a.kind}
          label={a.label}
          variant={a.variant}
          size={paired && actions[0].kind === 'confirm' ? 'lg' : 'md'}
          disabled={busy}
          onPress={() => onPress(a)}
          style={paired ? { flex: 1 } : undefined}
        />
      ))}
    </View>
  );
}

/** The open Coverage Request (prototype coverage card): pill, who can't make it, who was asked. */
function CoveragePanel({
  status,
  headline,
  detail,
  asked,
}: {
  status: SlotView['status'];
  headline: string;
  detail: string;
  asked: string[];
}) {
  const { colors, radii, space } = useTheme();
  return (
    <View
      style={{
        padding: space.lg,
        gap: space.sm,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceAlt,
      }}>
      <StatusPill status={status === 'findReplacement' ? 'findReplacement' : 'needsCoverage'} />
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        {status === 'findReplacement' ? <CircleAlert size={18} color={colors.dangerText} strokeWidth={2} /> : null}
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {headline}
        </Text>
      </View>
      <Text variant="subhead" color="textSecondary">
        {detail}
      </Text>
      {asked.length ? <PeopleRow names={asked} text={nameList(asked, 5)} /> : null}
    </View>
  );
}

type HostBase = {
  ctx: SheetContext;
  assignmentId: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
};

function DeclineSheetHost({ ctx, assignmentId, onSubmit, ...base }: HostBase & { onSubmit: () => void }) {
  const view = declineSheetView(ctx, assignmentId);
  if (!view) return null;
  return <DeclineSheet visible view={view} onSubmit={onSubmit} {...base} />;
}

function CoverSheetHost({
  ctx,
  assignmentId,
  groupTimeZone,
  onSubmit,
  ...base
}: HostBase & { groupTimeZone: string; onSubmit: () => void }) {
  const view = coverSheetView(ctx, assignmentId);
  if (!view) return null;
  return (
    <CoverSheet
      visible
      view={view}
      groupTimeZone={groupTimeZone}
      viewerTimeZone={ctx.viewerTimeZone}
      onSubmit={onSubmit}
      {...base}
    />
  );
}

function MarkCoveredSheetHost({
  ctx,
  assignmentId,
  onPickMember,
  onGuest,
  ...base
}: HostBase & { onPickMember: (memberId: string, name: string) => void; onGuest: (name: string) => void }) {
  const view = markCoveredSheetView(ctx, assignmentId);
  if (!view) return null;
  return <MarkCoveredSheet visible view={view} onPickMember={onPickMember} onGuest={onGuest} {...base} />;
}
