import { router } from 'expo-router';
import { CircleAlert, Info } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { CantMakeItSheet, CoverPickerSheet } from '@/components/assignment/CoverageSheets';
import { Button, InfoNote, Notice, Sheet, showToast, Text } from '@/components/ui';
import {
  busyNote,
  busyThatDay,
  cantMakeItView,
  coverPickerView,
  coverPreviewMessage,
  type SheetContext,
} from '@/coverage/sheets';
import { isQualified } from '@/engine/state';
import type { CoverTarget } from '@/engine/types';
import { firstName, type TurnRow } from '@/lib/groupPage';
import { deviceTimeZone } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { dateIn, formatDayShort, formatTimeIn } from '@/schedule/format';
import { useTheme } from '@/theme';

import { PersonAvatar } from './PersonAvatar';
import type { RunCommand } from './runCommand';

/**
 * One turn's details (prototype `SHEETS.inst`): who has it, and the one thing to do about it.
 * - Your turn: "Can't make it" (danger), then the "Can't make it?" sheet (simplify ticket 07):
 *   ask the group for cover, or "I'll find someone to cover" (a member, or someone else by name).
 * - A stand-in's turn: "<Name> can't make it", on their behalf.
 * - Needs cover: "I'll cover" (not if you already have another job that day), "Pick who's
 *   covering", or, if you asked, "I can make it after all".
 * A cover's toast is the engine's swap sentence ("Sam's covering for you on Nov 29. ...").
 * The full details page (history) is one tap further.
 */
export function TurnSheet({
  group,
  row,
  myMemberId,
  run,
  onClose,
}: {
  group: GroupDetails;
  row: TurnRow;
  myMemberId: string | null;
  run: RunCommand;
  onClose: () => void;
}) {
  const { colors, fonts, space } = useTheme();
  const [step, setStep] = useState<'details' | 'cant' | 'pick'>('details');
  /** What choosing in "Who is covering?" does: hand over this turn, or cover the open one. */
  const [pickMode, setPickMode] = useState<'decline' | 'markCovered'>('decline');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewerTimeZone = deviceTimeZone();
  const date = formatDayShort(dateIn(row.startsAt, viewerTimeZone));
  const time = formatTimeIn(row.startsAt, viewerTimeZone);
  const meta = `${group.name} · ${date} · ${time}`;
  const assignment = group.state.assignments.find((a) => a.id === row.assignmentId);
  const askedByMe = row.needsCover && !!myMemberId && assignment?.coverageRequest?.requestedBy === myMemberId;
  const person = row.person;
  // Whose "can't make it" this is: yours, or a stand-in's (anyone can say it for them).
  const forName = row.mine ? null : row.standInId && person.kind === 'member' ? firstName(person.name) : undefined;
  const canDecline = !row.needsCover && (row.mine || forName !== undefined);
  const ctx: SheetContext | null = myMemberId
    ? {
        state: group.state,
        groupName: group.name,
        viewerTimeZone,
        groupTimeZone: group.timeZone,
        me: myMemberId,
        now: new Date().toISOString(),
      }
    : null;
  const busyDay = !!assignment && !!myMemberId && busyThatDay(group.state, assignment, myMemberId, group.timeZone);
  const canCover = !!myMemberId && !!assignment && isQualified(group.state, myMemberId, assignment.responsibilityId) && !busyDay;

  /** Sends a command; on success closes and shows `done` (nothing for "Ask the group"). */
  async function send(command: Parameters<RunCommand>[0], action: Parameters<RunCommand>[1], done: string | null) {
    setBusy(true);
    setError(null);
    const failed = await run(command, action);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
    if (done) showToast(done);
  }

  function pick(by: CoverTarget, name: string) {
    const command =
      pickMode === 'decline'
        ? { type: 'decline' as const, assignmentId: row.assignmentId, coveredBy: by }
        : { type: 'markCovered' as const, assignmentId: row.assignmentId, by };
    const done = (ctx && coverPreviewMessage(ctx, command)) ?? `${name} is covering ${row.jobName} on ${date}`;
    void send(command, pickMode, done);
  }

  function details() {
    onClose();
    router.push({ pathname: '/assignment/[groupId]/[assignmentId]', params: { groupId: group.id, assignmentId: row.assignmentId } });
  }

  const cant = step === 'cant' && ctx ? cantMakeItView(ctx, row.assignmentId) : null;
  if (cant) {
    return (
      <CantMakeItSheet
        visible
        view={forName ? { ...cant, title: `${forName} can't make it?` } : cant}
        busy={busy}
        error={error}
        onClose={onClose}
        // "Ask the group for cover": the sheet just closes; the turn now shows "Needs cover".
        onAsk={() => void send({ type: 'decline', assignmentId: row.assignmentId }, 'decline', null)}
        onFind={() => {
          setError(null);
          setPickMode('decline');
          setStep('pick');
        }}
      />
    );
  }
  const picker = step === 'pick' && ctx ? coverPickerView(ctx, row.assignmentId) : null;
  if (picker) {
    return (
      <CoverPickerSheet
        visible
        view={picker}
        busy={busy}
        error={error}
        onClose={onClose}
        onPickMember={(memberId, name) => pick({ memberId }, name)}
        onPickOutside={(guestName) => pick({ guestName }, guestName)}
      />
    );
  }

  let action: React.ReactNode = null;
  if (row.needsCover && askedByMe) {
    action = (
      <Button
        label="I can make it after all"
        size="lg"
        variant="secondary"
        loading={busy}
        onPress={() => send({ type: 'withdrawDecline', assignmentId: row.assignmentId }, 'withdrawDecline', "You're back on")}
      />
    );
  } else if (row.needsCover && canCover) {
    action = (
      <Button
        label="I'll cover"
        size="lg"
        loading={busy}
        onPress={() => {
          const command = { type: 'cover' as const, assignmentId: row.assignmentId };
          const done = (ctx && coverPreviewMessage(ctx, command)) ?? `You're covering ${row.jobName} on ${date}`;
          void send(command, 'cover', done);
        }}
      />
    );
  } else if (canDecline) {
    action = (
      <Button
        label={forName ? `${forName} can't make it` : "Can't make it"}
        size="lg"
        variant="destructive"
        onPress={() => {
          setError(null);
          setStep('cant');
        }}
      />
    );
  }
  const pickWho =
    row.needsCover && myMemberId ? (
      <Button
        label="Pick who's covering"
        variant="quiet"
        disabled={busy}
        onPress={() => {
          setError(null);
          setPickMode('markCovered');
          setStep('pick');
        }}
      />
    ) : null;

  const name = row.needsCover
    ? 'Nobody yet'
    : person.kind === 'member'
      ? person.isMe
        ? 'You'
        : person.name
      : person.kind === 'guest'
        ? person.name
        : 'Nobody yet';
  const sub = [
    person.kind === 'guest' ? 'Not in group' : null,
    person.kind === 'member' && person.isStandIn ? 'Stand-in. Not on the app.' : null,
    row.coveringFor ? `Covering for ${row.coveringFor}` : null,
    row.swappedWith ? `Swapped with ${row.swappedWith}` : null,
    row.breakFor ? `Break for ${row.breakFor}` : null,
  ].filter(Boolean) as string[];

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      overline={meta}
      title={row.jobName}
      footer={
        <>
          {action}
          {pickWho}
          <Button label="See details" variant="quiet" disabled={busy} onPress={details} />
        </>
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {person.kind === 'open' || row.needsCover ? (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text color="textSecondary" style={{ fontFamily: fonts.extrabold }}>
              ?
            </Text>
          </View>
        ) : (
          <PersonAvatar name={person.name} dashed={person.kind === 'guest' || person.isStandIn} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.bold }}>{name}</Text>
          {sub.map((s) => (
            <Text key={s} variant="subhead" color="textSecondary">
              {s}
            </Text>
          ))}
        </View>
        {row.needsCover ? <CircleAlert size={22} color={colors.dangerText} strokeWidth={2} /> : null}
      </View>
      {row.needsCover ? (
        <InfoNote icon={Info}>
          <Text variant="subhead">
            {askedByMe
              ? 'Needs cover. We’ll tell you when someone takes it.'
              : busyDay
                ? busyNote(group.name)
                : 'Needs cover. The first person to tap “I’ll cover” takes it.'}
          </Text>
        </InfoNote>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
