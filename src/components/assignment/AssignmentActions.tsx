import { router } from 'expo-router';
import { CircleAlert, CircleCheck, Info, Repeat } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Notice, StatusPill, Text } from '@/components/ui';
import { assignmentActions, type AssignmentAction } from '@/coverage/actions';
import {
  busyThatDay,
  cantMakeItView,
  coverPickerView,
  coverPreviewMessage,
  isStandIn,
  needsCoverView,
  successMessage,
  type SheetContext,
} from '@/coverage/sheets';
import type { CoverTarget } from '@/engine/types';
import { isQualified } from '@/engine/state';
import type { GroupDetails } from '@/lib/groups';
import type { EventView, SlotView } from '@/schedule/views';
import { useTheme } from '@/theme';

import { CantMakeItSheet, CoverPickerSheet } from './CoverageSheets';
import { Note } from './parts';
import { useAssignmentCommand } from './useAssignmentCommand';

type SheetKind = 'cant' | 'pick';
/** What choosing someone in "Who is covering?" does: hand over my turn, or cover an open one. */
type PickMode = 'decline' | 'markCovered';

export type AssignmentActionsProps = {
  group: GroupDetails;
  myMemberId: string;
  event: EventView;
  slot: SlotView;
  now: string;
  viewerTimeZone: string;
  reload: () => Promise<void>;
  /** Opens a sheet on arrival (`?action=decline|markCovered`), when that action is offered. */
  initialSheet?: string;
};

/**
 * A turn's actions, one cover flow in plain words (simplify ticket 07): "Can't make it" (ask
 * the group, or "I'll find someone to cover"), "I'll cover" (the first to tap takes it), "Pick
 * who's covering", and "I can make it after all". Anyone in the group may act; a Stand-in's
 * turn can be handled for them. The swap sentence after a cover comes from the engine.
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
  const active = !!me && me.leftAt === null;
  const { send, busy } = useAssignmentCommand(group.id, myMemberId, reload);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const responsibility = state.responsibilities.find((r) => r.id === slot.responsibilityId);
  const holder = assignment?.coverageRequest ? assignment.coverageRequest.requestedBy : (assignment?.memberId ?? null);
  const standIn = holder !== myMemberId && isStandIn(state, holder) ? state.members.find((m) => m.id === holder) : undefined;
  const busyDay = !!assignment && busyThatDay(state, assignment, myMemberId, group.timeZone);
  const view = assignment
    ? assignmentActions({
        assignment,
        eventStartsAt: event.startsAt,
        requiresConfirmation: responsibility?.requiresConfirmation ?? false,
        qualified: isQualified(state, myMemberId, slot.responsibilityId),
        me: active ? myMemberId : null,
        busyThatDay: busyDay,
        standInName: standIn?.name ?? null,
        now,
      })
    : null;

  // Open the sheet asked for in the URL on arrival, if that action is on offer.
  const [sheet, setSheet] = useState<SheetKind | null>(() => {
    if (initialSheet === 'decline' && view?.actions.some((a) => a.command === 'decline')) return 'cant';
    if (initialSheet === 'markCovered' && view?.actions.some((a) => a.command === 'markCovered')) return 'pick';
    return null;
  });
  const [pickMode, setPickMode] = useState<PickMode>(initialSheet === 'decline' ? 'decline' : 'markCovered');

  // The sheet has read `?action=`: drop it from the URL, so a reload or the back button doesn't
  // open it again.
  useEffect(() => {
    if (initialSheet) router.setParams({ action: undefined });
  }, [initialSheet]);

  if (!assignment || !view) return null;

  const ctx: SheetContext = {
    state,
    groupName: group.name,
    viewerTimeZone,
    groupTimeZone: group.timeZone,
    me: myMemberId,
    now,
  };
  const assignmentId = slot.assignmentId;

  function closeSheet() {
    setSheet(null);
    setSheetError(null);
  }

  async function sendNow(command: Parameters<typeof send>[0], action: Parameters<typeof send>[1], message: string | null) {
    setError(null);
    setDone(null);
    const result = await send(command, action);
    if (result.ok) setDone(message);
    else setError(result.message);
  }

  function run(action: AssignmentAction) {
    setError(null);
    setDone(null);
    setSheetError(null);
    switch (action.kind) {
      case 'confirm':
      case 'confirmEarly':
        void sendNow({ type: 'confirm', assignmentId }, 'confirm', successMessage('confirm', slot.responsibilityName, event.date));
        return;
      case 'withdrawDecline':
        void sendNow(
          { type: 'withdrawDecline', assignmentId },
          'withdrawDecline',
          successMessage('withdrawDecline', slot.responsibilityName, event.date),
        );
        return;
      case 'cover': {
        // "I'll cover": no sheet, the first to tap takes it (prototype `doCover`).
        const command = { type: 'cover' as const, assignmentId };
        const message = coverPreviewMessage(ctx, command) ?? successMessage('cover', slot.responsibilityName, event.date);
        void sendNow(command, 'cover', message);
        return;
      }
      case 'markCovered':
        setPickMode('markCovered');
        setSheet('pick');
        return;
      case 'decline':
      case 'declineAfterAll':
        setSheet('cant');
        return;
    }
  }

  async function submit(command: Parameters<typeof send>[0], action: Parameters<typeof send>[1], message: string | null) {
    setSheetError(null);
    const result = await send(command, action);
    if (result.ok) {
      setSheet(null);
      setDone(message);
    } else setSheetError(result.message);
  }

  function pick(by: CoverTarget, name: string) {
    const command =
      pickMode === 'decline'
        ? { type: 'decline' as const, assignmentId, coveredBy: by }
        : { type: 'markCovered' as const, assignmentId, by };
    const message =
      coverPreviewMessage(ctx, command) ?? successMessage('markCovered', slot.responsibilityName, event.date, name);
    void submit(command, pickMode === 'decline' ? 'decline' : 'markCovered', message);
  }

  const panel = needsCoverView(ctx, assignmentId, busyDay);
  const note = stateNote(view.state, responsibility?.requiresConfirmation ?? false);
  const cant = sheet === 'cant' ? cantMakeItView(ctx, assignmentId) : null;
  const picker = sheet === 'pick' ? coverPickerView(ctx, assignmentId) : null;

  return (
    <View style={{ gap: space.md, marginTop: space.md }}>
      {panel ? <NeedsCoverPanel headline={panel.headline} detail={panel.detail} reason={panel.reason} /> : null}
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

      {cant ? (
        <CantMakeItSheet
          visible
          view={cant}
          busy={busy}
          error={sheetError}
          onClose={closeSheet}
          // "Ask the group for cover": the sheet just closes; the turn now shows "Needs cover".
          onAsk={() => void submit({ type: 'decline', assignmentId }, 'decline', null)}
          onFind={() => {
            setSheetError(null);
            setPickMode('decline');
            setSheet('pick');
          }}
        />
      ) : null}
      {picker ? (
        <CoverPickerSheet
          visible
          view={picker}
          busy={busy}
          error={sheetError}
          onClose={closeSheet}
          onPickMember={(memberId, name) => pick({ memberId }, name)}
          onPickOutside={(guestName) => pick({ guestName }, guestName)}
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
      return requiresConfirmation ? { tone: 'neutral', text: "We'll ask you to confirm closer to the date." } : null;
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
          size={a.variant === 'quiet' ? 'md' : 'lg'}
          disabled={busy}
          onPress={() => onPress(a)}
          style={paired ? { flex: 1 } : undefined}
        />
      ))}
    </View>
  );
}

/** A turn that needs cover: the pill, who can't make it, and what happens next. */
function NeedsCoverPanel({ headline, detail, reason }: { headline: string; detail: string; reason: string | null }) {
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <StatusPill status="needsCoverage" label={headline} />
        {reason ? (
          <Text variant="caption" color="textSecondary" style={{ flexShrink: 1 }}>
            {`“${reason}”`}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <CircleAlert size={18} color={colors.dangerText} strokeWidth={2} />
        <Text variant="subhead" color="textSecondary" style={{ flex: 1 }}>
          {detail}
        </Text>
      </View>
    </View>
  );
}
