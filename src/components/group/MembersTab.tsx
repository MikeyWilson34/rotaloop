import { ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar, Badge, Button, Notice, SettingsList, Sheet, Text, TextField } from '@/components/ui';
import { memberRows, type MemberRowView } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { fetchClaimToken } from '@/lib/inviteLinks';
import { initials } from '@/lib/validation';
import { useTheme } from '@/theme';

import { InviteSheet } from './InviteSheet';
import { MemberActionsSheet, type RunCommand } from './MemberActionsSheet';

/** Members tab: everyone in the Group, Admins first. Admins manage each Member from a sheet. */
export function MembersTab({
  group,
  accountId,
  isAdmin,
  run,
  onInvite,
}: {
  group: GroupDetails;
  accountId: string | null;
  isAdmin: boolean;
  run: RunCommand;
  onInvite: () => void;
}) {
  const { space } = useTheme();
  const rows = useMemo(() => memberRows(group.state, accountId), [group.state, accountId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [claimFor, setClaimFor] = useState<MemberRowView | null>(null);
  const [adding, setAdding] = useState(false);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      {/* Workload bars (served / upcoming / covering) go here with the schedule views (ticket 08). */}
      <SettingsList>
        {rows.map((m) => (
          <MemberRow key={m.id} member={m} onPress={isAdmin ? () => setSelectedId(m.id) : undefined} />
        ))}
      </SettingsList>
      {isAdmin ? (
        <View style={{ gap: space.sm }}>
          <Button label="Invite people" variant="secondary" onPress={onInvite} />
          <Button label="Add a Placeholder Member" variant="quiet" onPress={() => setAdding(true)} />
          <Text variant="caption" color="textSecondary">
            {"A Placeholder is someone you add by name before they join. They're rotated like anyone else, and keep their place when they join with their personal link."}
          </Text>
        </View>
      ) : null}

      {selected ? (
        <MemberActionsSheet
          member={selected}
          groupName={group.name}
          run={run}
          onClose={() => setSelectedId(null)}
          onShareClaimLink={() => {
            setSelectedId(null);
            // Let the actions sheet finish closing first: iOS can't present two modals at once.
            setTimeout(() => setClaimFor(selected), 350);
          }}
        />
      ) : null}
      <InviteSheet
        visible={claimFor !== null}
        onClose={() => setClaimFor(null)}
        groupName={group.name}
        title={`Invite ${claimFor?.name ?? ''}`}
        message={`This link is just for ${claimFor?.name ?? 'them'}. Joining with it keeps their place in the Rotations and their history. It works once.`}
        loadToken={() => fetchClaimToken(group.id, claimFor?.id ?? '')}
        shareMessage={`${claimFor?.name ?? ''}, join ${group.name}:`}
      />
      {adding ? <AddPlaceholderSheet groupName={group.name} run={run} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function MemberRow({ member, onPress }: { member: MemberRowView; onPress?: () => void }) {
  const { colors, fonts } = useTheme();
  const qualified = member.qualifiedFor.length > 0 ? `Qualified: ${member.qualifiedFor.join(' · ')}` : 'Not in a Rotation yet';
  const label = `${member.name}${member.isMe ? ' (you)' : ''}${member.isAdmin ? ', Admin' : ''}${member.isPlaceholder ? ', not joined yet' : ''}. ${qualified}`;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={onPress ? 'Opens actions for this Member' : undefined}
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
      <Avatar initials={initials(member.name)} placeholder={member.isPlaceholder} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.bold, flexShrink: 1 }}>
            {member.name}
            {member.isMe ? (
              <Text color="textSecondary" style={{ fontFamily: fonts.regular }}>
                {' (you)'}
              </Text>
            ) : null}
          </Text>
          {member.isAdmin ? <Badge label="Admin" tone="admin" /> : null}
          {member.isPlaceholder ? <Badge label="Not joined yet" tone="warning" /> : null}
        </View>
        <Text variant="subhead" color="textSecondary" numberOfLines={2}>
          {qualified}
        </Text>
      </View>
      {onPress ? <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} /> : null}
    </Pressable>
  );
}

function AddPlaceholderSheet({
  groupName,
  run,
  onClose,
}: {
  groupName: string;
  run: RunCommand;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter their name.');
      return;
    }
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'addMember', member: { name: trimmed } }, 'addPlaceholder');
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      overline={groupName}
      title="Add a Placeholder Member"
      message="Add someone by name now. Send them their personal invite link later from the Members list."
      footer={
        <>
          <Button label="Add Member" size="lg" loading={busy} onPress={add} />
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
        maxLength={80}
        autoCapitalize="words"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={add}
      />
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
