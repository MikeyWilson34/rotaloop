import { ChevronRight, UserPlus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Button, Notice, SettingsList, Sheet, showToast, Text, TextField } from '@/components/ui';
import { NAME_MAX } from '@/lib/groupSetup';
import { memberItems, type MemberItem } from '@/lib/groupPage';
import type { GroupDetails } from '@/lib/groups';
import { fetchClaimToken } from '@/lib/inviteLinks';
import { useTheme } from '@/theme';

import { InviteSheet } from './InviteSheet';
import { PersonAvatar } from './PersonAvatar';
import type { RunCommand } from './runCommand';

const FIRST = 6;

/**
 * The group's members (prototype `PAGES.group` → Members), in join order. A stand-in (someone
 * not on the app) has a dashed avatar and a "Stand-in" pill; tapping one shares their own link
 * so they can take over their spot. "Add stand-in" is the last row.
 */
export function MembersSection({
  group,
  myMemberId,
  run,
}: {
  group: GroupDetails;
  myMemberId: string | null;
  run: RunCommand;
}) {
  const { space } = useTheme();
  const members = useMemo(() => memberItems(group.state, myMemberId), [group.state, myMemberId]);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [claimFor, setClaimFor] = useState<MemberItem | null>(null);
  const shown = showAll ? members : members.slice(0, FIRST);

  return (
    <View style={{ gap: space.md }}>
      <SettingsList>
        {shown.map((m) => (
          <MemberRow key={m.id} member={m} onPress={m.isStandIn ? () => setClaimFor(m) : undefined} />
        ))}
        {members.length > FIRST && !showAll ? (
          <AddRow label={`Show all ${members.length}`} onPress={() => setShowAll(true)} />
        ) : null}
        <AddRow label="Add stand-in" icon onPress={() => setAdding(true)} />
      </SettingsList>
      {adding ? <AddStandInSheet groupName={group.name} run={run} onClose={() => setAdding(false)} /> : null}
      <InviteSheet
        visible={claimFor !== null}
        onClose={() => setClaimFor(null)}
        groupName={group.name}
        title={`Invite ${claimFor?.name ?? ''}`}
        message={`This link is just for ${claimFor?.name ?? 'them'}. Joining with it keeps their place and their turns. It works once.`}
        loadToken={() => fetchClaimToken(group.id, claimFor?.id ?? '')}
        shareMessage={`${claimFor?.name ?? ''}, join ${group.name}:`}
      />
    </View>
  );
}

function MemberRow({ member, onPress }: { member: MemberItem; onPress?: () => void }) {
  const { colors, fonts } = useTheme();
  const label = `${member.name}${member.isMe ? ' (you)' : ''}${member.isStandIn ? ', stand-in. Not on the app. You keep track for them.' : ''}`;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={onPress ? 'Shares a link so they can join the app' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 64,
        opacity: pressed ? 0.85 : 1,
      })}>
      <PersonAvatar name={member.name} dashed={member.isStandIn} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold }}>
          {member.name}
          {member.isMe ? (
            <Text color="textSecondary" style={{ fontFamily: fonts.regular }}>
              {' (you)'}
            </Text>
          ) : null}
        </Text>
        {member.isStandIn ? (
          <Text variant="subhead" color="textSecondary">
            Not on the app. You keep track for them.
          </Text>
        ) : null}
      </View>
      {member.isStandIn ? <Badge label="Stand-in" /> : null}
      {onPress ? <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} /> : null}
    </Pressable>
  );
}

function AddRow({ label, icon, onPress }: { label: string; icon?: boolean; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        minHeight: 56,
        opacity: pressed ? 0.7 : 1,
      })}>
      {icon ? <UserPlus size={22} color={colors.primary} strokeWidth={1.75} /> : null}
      <Text style={{ fontFamily: fonts.extrabold, color: colors.primary, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** "Add stand-in": a name; they're in every job's turns like anyone else. */
function AddStandInSheet({ groupName, run, onClose }: { groupName: string; run: RunCommand; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      setError('Type their name.');
      return;
    }
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'addMember', member: { name: trimmed } }, 'addPlaceholder');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
    showToast(`${trimmed} is in. Their turns are on the schedule.`);
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      overline={groupName}
      title="Add stand-in"
      message="Someone who isn't on the app. They take turns like anyone else, and you keep track for them."
      footer={
        <>
          <Button label="Add" size="lg" loading={busy} onPress={add} />
          <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
        </>
      }>
      <TextField
        label="Name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError(null);
        }}
        placeholder="e.g. Pat Morgan"
        maxLength={NAME_MAX}
        autoCapitalize="words"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={add}
      />
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
