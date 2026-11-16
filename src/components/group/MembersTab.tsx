import { ChevronRight, Handshake, Scale } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar, Badge, Button, Notice, SettingsList, Sheet, Text, TextField } from '@/components/ui';
import { deviceTimeZone, memberRows, myMember, type MemberRowView } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { fetchClaimToken } from '@/lib/inviteLinks';
import { initials } from '@/lib/validation';
import { makeUpTurnLines, turnsLabel, workloadNote, workloadSummary, type WorkloadBar } from '@/schedule/workloadView';
import { useTheme, type ColorTokens } from '@/theme';

import { InviteSheet } from './InviteSheet';
import { MemberActionsSheet, type RunCommand } from './MemberActionsSheet';

/**
 * Members tab: workload (served in the last ~3 months, upcoming, covering) and outstanding
 * Make-up Turns, visible to every Member (owner decision); then everyone in the Group, Admins
 * first, each with a workload bar. Admins manage each Member from a sheet.
 */
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
  const now = useMemo(() => new Date().toISOString(), [group.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => workloadSummary(group.state, now), [group.state, now]);
  const myId = myMember(group.state, accountId)?.id ?? null;
  const debts = useMemo(() => makeUpTurnLines(group.state, myId, deviceTimeZone()), [group.state, myId]);

  return (
    <>
      <WorkloadIntro note={workloadNote(summary.range)} debts={debts} />
      <SettingsList>
        {rows.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            bar={summary.bars.get(m.id)}
            max={summary.max}
            onPress={isAdmin ? () => setSelectedId(m.id) : undefined}
          />
        ))}
      </SettingsList>
      <Button label="Invite people" variant="secondary" onPress={onInvite} />
      {isAdmin ? (
        <View style={{ gap: space.sm }}>
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

/** The "Workload" explainer and any outstanding Make-up Turns, plus the bar legend. */
function WorkloadIntro({ note, debts }: { note: string; debts: string[] }) {
  const { colors, fonts, radii, space } = useTheme();
  const box = (bg: keyof ColorTokens) => ({
    flexDirection: 'row' as const,
    gap: 10,
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: colors[bg],
  });
  const swatch = (bg: string) => <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: bg }} />;
  return (
    <View style={{ gap: space.sm }}>
      <View style={box('primaryTint')}>
        <Scale size={20} color={colors.primary} strokeWidth={1.75} />
        <Text variant="subhead" style={{ flex: 1 }}>
          <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
            Workload:{' '}
          </Text>
          {note}
        </Text>
      </View>
      {debts.length ? (
        <View style={box('primaryTint')}>
          <Handshake size={20} color={colors.primary} strokeWidth={1.75} />
          <Text variant="subhead" style={{ flex: 1 }}>
            <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
              Make-up Turns owed:{' '}
            </Text>
            {debts.join(' ')}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: 2, paddingTop: space.xs }}>
        {[
          { label: 'Served (3 mo)', color: colors.primary },
          { label: 'Upcoming', color: `${colors.primary}73` },
          { label: 'Covering', color: colors.success },
        ].map((l) => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {swatch(l.color)}
            <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.bold, fontSize: 12 }}>
              {l.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One Member's bar: served, then upcoming, then covering, scaled to the busiest Member. */
function WorkloadBarView({ bar, max }: { bar: WorkloadBar; max: number }) {
  const { colors, fonts } = useTheme();
  const pct = (n: number) => `${(n / max) * 100}%` as const;
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
      <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden', flexDirection: 'row' }}>
        <View style={{ width: pct(bar.served), backgroundColor: colors.primary }} />
        <View style={{ width: pct(bar.upcoming), backgroundColor: `${colors.primary}73` }} />
        <View style={{ width: pct(bar.covering), backgroundColor: colors.success }} />
      </View>
      <Text variant="caption" style={{ minWidth: 56, textAlign: 'right', fontFamily: fonts.bold }}>
        {turnsLabel(bar.total)}
      </Text>
    </View>
  );
}

function MemberRow({
  member,
  bar,
  max,
  onPress,
}: {
  member: MemberRowView;
  bar?: WorkloadBar;
  max: number;
  onPress?: () => void;
}) {
  const { colors, fonts } = useTheme();
  const qualified = member.qualifiedFor.length > 0 ? `Qualified: ${member.qualifiedFor.join(' · ')}` : 'Not in a Rotation yet';
  const showBar = !!bar && (member.qualifiedFor.length > 0 || bar.total > 0);
  const workload = showBar
    ? ` ${turnsLabel(bar.total)}: ${bar.served} served in the last 3 months, ${bar.upcoming} upcoming, ${bar.covering} covering.`
    : '';
  const label = `${member.name}${member.isMe ? ' (you)' : ''}${member.isAdmin ? ', Admin' : ''}${member.isPlaceholder ? ', not joined yet' : ''}. ${qualified}.${workload}`;
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
        {showBar ? <WorkloadBarView bar={bar} max={max} /> : null}
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
