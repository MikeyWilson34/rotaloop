import { router, useLocalSearchParams } from 'expo-router';
import { Bell, CalendarOff, UserPlus, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActivityUnreadCount } from '@/activity/data';
import { InviteSheet } from '@/components/group/InviteSheet';
import { AttentionCard } from '@/components/home/AttentionCard';
import { ManagedGroupCard, MemberGroupCard } from '@/components/home/GroupCards';
import { Hero, HeroEmpty } from '@/components/home/Hero';
import { CaughtUp, FilterChips, HomeSkeleton, SectionHead } from '@/components/home/parts';
import { Button, Notice, showToast, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { CAN_WITHDRAW_DECLINE } from '@/coverage/actions';
import { successMessage } from '@/coverage/sheets';
import { useHomeData } from '@/home/data';
import {
  attentionItems,
  filterGroupCards,
  greeting,
  groupCards,
  groupFilterCounts,
  parseGroupFilter,
  selectHero,
  showGroupFilters,
  todayLabel,
  type AttentionAction,
  type AttentionItem,
  type GroupFilter,
  type HomeContext,
} from '@/home/home';
import { runGroupCommand } from '@/lib/groupCommand';
import { groupCommandMessage } from '@/lib/groupErrors';
import { deviceTimeZone } from '@/lib/groupViews';
import { fetchGroupInviteToken } from '@/lib/inviteLinks';
import { reminderSummary } from '@/lib/notificationPrefs';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

type AssignmentAction = 'decline' | 'cover' | 'markCovered';

function openAssignment(groupId: string, assignmentId: string, action?: AssignmentAction) {
  router.push({
    pathname: '/assignment/[groupId]/[assignmentId]',
    params: action ? { groupId, assignmentId, action } : { groupId, assignmentId },
  });
}

/**
 * Home (ticket 12; prototype `screenHome`): personal first, Admin-aware. The greeting, the
 * next Assignment, what needs the person's attention, their Groups (managed ones with health
 * stats and filters) and quick actions. Everything shown is derived in src/home/home.ts.
 */
export default function HomeScreen() {
  const { colors, fonts, space } = useTheme();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { profile } = useSession();
  const unread = useActivityUnreadCount();
  const { data, loading, error, refresh, refreshing, reload } = useHomeData();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const viewerTimeZone = data?.viewerTimeZone ?? deviceTimeZone();
  // Statuses depend on the time: recomputed with every load.
  const now = useMemo(() => new Date().toISOString(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const reminderText = profile ? reminderSummary(profile) : undefined;
  const ctx: HomeContext = useMemo(() => ({ now, viewerTimeZone, reminderText }), [now, viewerTimeZone, reminderText]);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const hero = useMemo(() => selectHero(groups, ctx), [groups, ctx]);
  const attention = useMemo(
    () => attentionItems(groups, ctx, { heroKey: hero?.key ?? null, canWithdraw: CAN_WITHDRAW_DECLINE }),
    [groups, ctx, hero],
  );
  const cards = useMemo(() => groupCards(groups, ctx), [groups, ctx]);
  const filter = parseGroupFilter(params.filter, cards);
  const shown = filterGroupCards(cards, filter);
  const counts = groupFilterCounts(cards);
  const name = profile?.display_name ?? null;
  const inviteGroup = cards[0] ?? null;

  async function send(key: string, groupId: string, command: Parameters<typeof runGroupCommand>[1], done: string) {
    setBusyKey(key);
    try {
      const result = await runGroupCommand(groupId, command);
      if (result.ok) {
        showToast(done);
        await reload();
      } else {
        showToast(groupCommandMessage(result.reason, command.type === 'confirm' ? 'confirm' : 'withdrawDecline'));
      }
    } finally {
      setBusyKey(null);
    }
  }

  function onAttention(item: AttentionItem, action: AttentionAction) {
    switch (action.kind) {
      case 'confirm':
        void send(item.key, item.groupId, { type: 'confirm', assignmentId: item.assignmentId }, successMessage('confirm', item.responsibilityName, item.date));
        return;
      case 'withdraw':
        void send(
          item.key,
          item.groupId,
          { type: 'withdrawDecline', assignmentId: item.assignmentId },
          successMessage('withdrawDecline', item.responsibilityName, item.date),
        );
        return;
      case 'cover':
      case 'markCovered':
      case 'decline':
        openAssignment(item.groupId, item.assignmentId, action.kind);
        return;
      default:
        openAssignment(item.groupId, item.assignmentId);
    }
  }

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="overline" color="textSecondary">
          {todayLabel(ctx)}
        </Text>
        <Text accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32, fontFamily: fonts.extrabold, color: colors.text, letterSpacing: -0.26 }}>
          {greeting(name, ctx)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Activity, ${unread} new` : 'Activity'}
        onPress={() => router.push('/activity')}
        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Bell size={24} color={colors.text} strokeWidth={1.75} />
        {unread > 0 ? (
          <View
            style={{ position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.bg }}
          />
        ) : null}
      </Pressable>
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <HomeSkeleton />;
  } else if (error || !data) {
    body = (
      <View style={{ gap: space.md }}>
        <Notice>{error ?? "Couldn't load your Home."}</Notice>
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  } else if (groups.length === 0) {
    body = (
      <HeroEmpty title={`Welcome to ${APP_NAME}`} text="Start a group and invite people, or join with a link someone sent you.">
        <Button label="Go to Groups" variant="secondary" onPress={() => router.push('/groups')} />
      </HeroEmpty>
    );
  } else {
    body = (
      <>
        {hero ? (
          <Hero
            hero={hero}
            busy={busyKey === hero.key}
            onOpen={() => openAssignment(hero.groupId, hero.assignmentId)}
            onConfirm={() =>
              void send(hero.key, hero.groupId, { type: 'confirm', assignmentId: hero.assignmentId }, successMessage('confirm', hero.responsibilityName, hero.date))
            }
            onDecline={() => openAssignment(hero.groupId, hero.assignmentId, 'decline')}
          />
        ) : (
          <HeroEmpty title="You're all clear" text="No upcoming Assignments. Enjoy the break." />
        )}

        <SectionHead title="Needs your attention" count={attention.length} />
        {attention.length ? (
          attention.map((item) => (
            <AttentionCard key={`${item.kind}:${item.key}`} item={item} busy={busyKey === item.key} onAction={(a) => onAttention(item, a)} />
          ))
        ) : (
          <CaughtUp text="You're all caught up." />
        )}

        <SectionHead title="Your groups" link={{ label: 'See all', onPress: () => router.push('/groups') }} />
        {showGroupFilters(cards) ? (
          <FilterChips<GroupFilter>
            label="Filter groups"
            value={filter}
            onChange={(v) => router.setParams({ filter: v === 'all' ? undefined : v })}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'managed', label: 'Managed by me', count: counts.managed },
              { value: 'attention', label: 'Needs attention', count: counts.attention },
            ]}
          />
        ) : null}
        {shown.length ? (
          shown.map((card) => (card.health ? <ManagedGroupCard key={card.groupId} card={card} /> : <MemberGroupCard key={card.groupId} card={card} />))
        ) : (
          <CaughtUp text="Nothing needs attention in the groups you manage." />
        )}

        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
          <QuickAction icon={CalendarOff} label="Add dates off" onPress={() => router.push('/time-off')} />
          <QuickAction
            icon={UserPlus}
            label="Invite someone"
            onPress={() => (inviteGroup ? setInviting(true) : router.push('/groups'))}
          />
        </View>
        {inviteGroup ? (
          <InviteSheet
            visible={inviting}
            onClose={() => setInviting(false)}
            groupName={inviteGroup.name}
            title={`Invite people to ${inviteGroup.name}`}
            message="Anyone with this link or QR code joins the group directly."
            loadToken={() => fetchGroupInviteToken(inviteGroup.groupId)}
            shareMessage={`Join ${inviteGroup.name} on ${APP_NAME}:`}
          />
        ) : null}
      </>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {header}
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { colors, fonts, radii, shadows } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 96,
        padding: 14,
        gap: 10,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} color={colors.primary} strokeWidth={1.75} />
      </View>
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 }}>{label}</Text>
    </Pressable>
  );
}
