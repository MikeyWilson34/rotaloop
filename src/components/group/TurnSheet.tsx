import { router } from 'expo-router';
import { CircleAlert, Info } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, InfoNote, Notice, Sheet, showToast, Text } from '@/components/ui';
import { firstName, type TurnRow } from '@/lib/groupPage';
import { deviceTimeZone } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { dateIn, formatDayShort, formatTimeIn } from '@/schedule/format';
import { useTheme } from '@/theme';

import { PersonAvatar } from './PersonAvatar';
import type { RunCommand } from './runCommand';

/**
 * One turn's details (prototype `SHEETS.inst`): who has it, and the one thing to do about it.
 * - Your turn: "Can't make it" (danger), then the group is asked for cover.
 * - A stand-in's turn: "<Name> can't make it", on their behalf.
 * - Needs cover: "I'll cover" (or, if you asked, "I can make it after all").
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
  const [step, setStep] = useState<'details' | 'cant'>('details');
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

  async function send(command: Parameters<RunCommand>[0], action: Parameters<RunCommand>[1], done: string) {
    setBusy(true);
    setError(null);
    const failed = await run(command, action);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
    showToast(done);
  }

  function details() {
    onClose();
    router.push({ pathname: '/assignment/[groupId]/[assignmentId]', params: { groupId: group.id, assignmentId: row.assignmentId } });
  }

  if (step === 'cant') {
    return (
      <Sheet
        visible
        busy={busy}
        onClose={onClose}
        overline={meta}
        title={forName ? `${forName} can't make it?` : "Can't make it?"}
        message="We'll ask the group for cover. The first person to tap “I'll cover” takes it, and turns stay fair automatically."
        footer={
          <>
            <Button
              label="Ask the group for cover"
              size="lg"
              loading={busy}
              onPress={() =>
                send(
                  { type: 'decline', assignmentId: row.assignmentId },
                  'decline',
                  forName ? `Asked the group to cover for ${forName}` : 'Asked the group for cover',
                )
              }
            />
            <Button label="Cancel" variant="quiet" disabled={busy} onPress={() => setStep('details')} />
          </>
        }>
        {error ? <Notice>{error}</Notice> : null}
      </Sheet>
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
  } else if (row.needsCover && myMemberId) {
    action = (
      <Button
        label="I'll cover"
        size="lg"
        loading={busy}
        onPress={() => send({ type: 'cover', assignmentId: row.assignmentId }, 'cover', `You're covering ${row.jobName} on ${date}`)}
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
              ? "We've asked the group. The first person to tap “I'll cover” takes it."
              : 'Needs cover. The first person to tap “I\'ll cover” takes it.'}
          </Text>
        </InfoNote>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
