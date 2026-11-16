import { router } from 'expo-router';
import { Globe, Link, LogOut, RotateCcw, Shield, Users } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ActionRow, ConfirmSheet, FieldLabel, InfoRow, Notice, SettingsList, Text } from '@/components/ui';
import type { Member } from '@/engine';
import { adminNames, activeMemberCount, memberCountLabel, orList, timeZoneLabel } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { resetGroupInviteToken } from '@/lib/inviteLinks';
import { useTheme } from '@/theme';

import type { RunCommand } from './MemberActionsSheet';

/**
 * Settings: the Group's details and its people (Admins, invite link, leaving). Coverage and
 * Rotation settings arrive with group setup (ticket 07).
 */
export function SettingsTab({
  group,
  me,
  isAdmin,
  run,
  onInvite,
}: {
  group: GroupDetails;
  me: Member;
  isAdmin: boolean;
  run: RunCommand;
  onInvite: () => void;
}) {
  const { space } = useTheme();
  const admins = adminNames(group.state);
  const [confirm, setConfirm] = useState<'leave' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function ask(kind: 'leave' | 'reset') {
    setError(null);
    setNotice(null);
    setConfirm(kind);
  }

  async function leave() {
    setBusy(true);
    const failed = await run({ type: 'removeMember', memberId: me.id }, 'leave');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    setConfirm(null);
    router.replace('/groups');
  }

  async function reset() {
    setBusy(true);
    try {
      await resetGroupInviteToken(group.id);
      setConfirm(null);
      setNotice('Invite link reset. The old link no longer works.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!isAdmin ? <Notice tone="info">{`Only Admins can change settings. Ask ${orList(admins)}.`}</Notice> : null}

      <FieldLabel>Group</FieldLabel>
      <SettingsList>
        <InfoRow icon={Users} label="Members" value={memberCountLabel(activeMemberCount(group.state))} />
        <InfoRow icon={Globe} label="Time zone" value={timeZoneLabel(group.timeZone).split(' · ')[0]} />
      </SettingsList>

      <FieldLabel>People</FieldLabel>
      <SettingsList>
        <InfoRow icon={Shield} label="Admins" description={admins.join(', ')} />
        <ActionRow icon={Link} label="Share invite link" description="Anyone with the link joins directly." onPress={onInvite} />
        {isAdmin ? (
          <ActionRow
            icon={RotateCcw}
            label="Reset invite link"
            description="Makes a new link. The old one stops working."
            onPress={() => ask('reset')}
          />
        ) : null}
        <ActionRow icon={LogOut} label="Leave group" destructive onPress={() => ask('leave')} />
      </SettingsList>
      {notice ? (
        <Text variant="subhead" color="successText" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <View style={{ height: space.sm }} />

      <ConfirmSheet
        visible={confirm === 'leave'}
        title={`Leave ${group.name}?`}
        message="Your upcoming turns move to the next person in line, and your history stays. To come back you'll need a new invite link."
        confirmLabel="Leave group"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={leave}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === 'reset'}
        title="Reset the invite link?"
        message="The current link and QR code stop working right away. People who already joined stay in the group. You'll share the new link from Invite people."
        confirmLabel="Reset link"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={reset}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

