import { ChevronRight, UserPlus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Button, ChoiceSheet, ConfirmSheet, Notice, SettingsList, Sheet, showToast, Text, TextField } from '@/components/ui';
import { NAME_MAX } from '@/lib/groupSetup';
import { firstName, memberItems, type MemberItem } from '@/lib/groupPage';
import type { GroupDetails } from '@/lib/groups';
import { fetchClaimToken } from '@/lib/inviteLinks';
import { useTheme } from '@/theme';

import { InviteCard } from './InviteCard';
import { InviteSheet } from './InviteSheet';
import { PersonAvatar } from './PersonAvatar';
import type { RunCommand } from './runCommand';

const FIRST = 6;

/**
 * The group's members (prototype `PAGES.group` → Members), in join order. A stand-in (someone
 * not on the app) has a dashed avatar and a "Stand-in" pill; tapping one shares their own link
 * so they can take over their spot, or, if they already joined separately, "This is someone in
 * the group" hands the stand-in's turns to them (feedback-2 ticket 05). "Add stand-in" is the
 * last row.
 */
export function MembersSection({
  group,
  myMemberId,
  run,
  showInviteCard = true,
}: {
  group: GroupDetails;
  myMemberId: string | null;
  run: RunCommand;
  /** False when the group page already shows the invite card higher up. */
  showInviteCard?: boolean;
}) {
  const { space, colors, fonts } = useTheme();
  const members = useMemo(() => memberItems(group.state, myMemberId), [group.state, myMemberId]);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [claimFor, setClaimFor] = useState<MemberItem | null>(null);
  const [mergeFor, setMergeFor] = useState<MemberItem | null>(null);
  const shown = showAll ? members : members.slice(0, FIRST);
  const onApp = members.filter((m) => !m.isStandIn);

  return (
    <View style={{ gap: space.md }}>
      <SettingsList>
        {shown.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            onPress={m.isStandIn ? () => setClaimFor(m) : undefined}
            onInvite={m.isStandIn ? () => setClaimFor(m) : undefined}
          />
        ))}
        {members.length > FIRST && !showAll ? (
          <AddRow label={`Show all ${members.length}`} onPress={() => setShowAll(true)} />
        ) : null}
      </SettingsList>
      {showInviteCard ? <InviteCard group={group} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a stand-in"
        onPress={() => setAdding(true)}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
        <Text variant="subhead" color="textSecondary">
          {'Not on the app? '}
          <Text variant="subhead" style={{ fontFamily: fonts.bold, color: colors.primary, textDecorationLine: 'underline' }}>
            Add a stand-in
          </Text>
        </Text>
      </Pressable>
      {adding ? (
        <AddStandInSheet
          groupName={group.name}
          jobIds={group.state.responsibilities.filter((r) => r.removedAt === null).map((r) => r.id)}
          run={run}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <InviteSheet
        visible={claimFor !== null}
        onClose={() => setClaimFor(null)}
        groupName={group.name}
        title={`Invite ${claimFor?.name ?? ''}`}
        message={`This link is just for ${claimFor?.name ?? 'them'}. Joining with it keeps their place and their turns. It works once.`}
        loadToken={() => fetchClaimToken(group.id, claimFor?.id ?? '')}
        shareMessage={`${claimFor?.name ?? ''}, join ${group.name}:`}
        moreAction={
          onApp.length > 0
            ? {
                label: 'This is someone in the group',
                hint: 'Gives their turns to someone already on the app',
                onPress: () => {
                  setMergeFor(claimFor);
                  setClaimFor(null);
                },
              }
            : undefined
        }
      />
      {mergeFor ? <MergeStandInSheets standIn={mergeFor} people={onApp} run={run} onClose={() => setMergeFor(null)} /> : null}
    </View>
  );
}

function MemberRow({ member, onPress, onInvite }: { member: MemberItem; onPress?: () => void; onInvite?: () => void }) {
  const { colors, fonts } = useTheme();
  const label = `${member.name}${member.isMe ? ' (you)' : ''}${member.isStandIn ? ', stand-in' : ''}`;
  return (
    <View>
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
      </View>
      {member.isStandIn ? <Badge label="Stand-in" /> : null}
      {onPress ? <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} /> : null}
    </Pressable>
    {onInvite ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Invite ${firstName(member.name)}`}
        onPress={onInvite}
        style={({ pressed }) => ({
          marginLeft: 68,
          marginTop: -8,
          marginBottom: 4,
          minHeight: 44,
          justifyContent: 'center',
          alignSelf: 'flex-start',
          opacity: pressed ? 0.7 : 1,
        })}>
        <Text variant="subhead" style={{ fontFamily: fonts.extrabold, color: colors.primary }}>
          {`Invite ${firstName(member.name)}`}
        </Text>
      </Pressable>
    ) : null}
    </View>
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
function AddStandInSheet({
  groupName,
  jobIds,
  run,
  onClose,
}: {
  groupName: string;
  /** Everyone does every job, stand-ins too. */
  jobIds: string[];
  run: RunCommand;
  onClose: () => void;
}) {
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
    const failed = await run({ type: 'addMember', member: { name: trimmed }, qualifiedFor: jobIds }, 'addPlaceholder');
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

/**
 * "This is someone in the group": pick who the stand-in really is (someone on the app), then
 * confirm. Their turns from now on go to that person and the stand-in is removed.
 */
export function MergeStandInSheets({
  standIn,
  people,
  run,
  onClose,
  initialPick = null,
}: {
  standIn: MemberItem;
  /** Members on the app, in join order. */
  people: MemberItem[];
  run: RunCommand;
  onClose: () => void;
  /** Opens straight on the confirm sheet (screenshots). */
  initialPick?: MemberItem | null;
}) {
  const [into, setInto] = useState<MemberItem | null>(initialPick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const standInName = standIn.name;
  const real = into ? (into.isMe ? 'you' : into.name) : '';

  async function merge() {
    if (!into) return;
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'mergeStandIn', standInId: standIn.id, intoMemberId: into.id }, 'mergeStandIn');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
    showToast(`${standInName}'s turns now belong to ${real}.`);
  }

  return (
    <>
      <ChoiceSheet
        visible={into === null}
        title={`Who is ${standInName}?`}
        message={`Pick ${standInName} from the people on the app. Their turns from now on go to that person.`}
        options={people.map((m) => ({ value: m.id, label: m.isMe ? `${m.name} (you)` : m.name }))}
        value=""
        onPick={(id) => setInto(people.find((m) => m.id === id) ?? null)}
        onClose={onClose}
      />
      <ConfirmSheet
        visible={into !== null}
        title={into?.isMe ? `Is ${standInName} you?` : `Is ${standInName} really ${real}?`}
        message={`${standInName}'s turns from now on go to ${into?.isMe ? 'you' : `${real} (on the app)`}. Past turns keep the name ${standInName}. The stand-in is removed.`}
        confirmLabel="Yes, same person"
        cancelLabel="Back"
        loading={busy}
        error={error}
        onConfirm={merge}
        onCancel={() => {
          setError(null);
          setInto(null);
        }}
      />
    </>
  );
}
