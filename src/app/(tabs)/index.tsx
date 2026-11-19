import { router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActivityUnreadCount } from '@/activity/data';
import { AttentionCard } from '@/components/home/AttentionCard';
import { Hero } from '@/components/home/Hero';
import { HomeSkeleton, SectionHead } from '@/components/home/parts';
import { HomeGroupCard, NothingThisWeek, ThisWeekList } from '@/components/home/Week';
import { Button, Notice, showToast, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { CAN_WITHDRAW_DECLINE } from '@/coverage/actions';
import { successMessage } from '@/coverage/sheets';
import { useHomeData } from '@/home/data';
import {
  greeting,
  groupCards,
  homeWeek,
  todayLabel,
  type AttentionAction,
  type AttentionItem,
  type HomeContext,
} from '@/home/home';
import { runGroupCommand } from '@/lib/groupCommand';
import { groupCommandMessage } from '@/lib/groupErrors';
import { deviceTimeZone } from '@/lib/groupViews';
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
 * Home (simplify ticket 05; prototype `PAGES.home`): only the next 7 days. The big card with
 * one button, "Needs you" when there is anything, "This week", or a calm "Nothing this week"
 * naming the next turn. Then "Your groups". Activity is the bell. Derived in src/home/home.ts.
 */
export default function HomeScreen() {
  const { colors, fonts, radii, space } = useTheme();
  const { profile } = useSession();
  const unread = useActivityUnreadCount();
  const { data, loading, error, refresh, refreshing, reload } = useHomeData();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const viewerTimeZone = data?.viewerTimeZone ?? deviceTimeZone();
  // What's "this week" depends on the time: recomputed with every load.
  const now = useMemo(() => new Date().toISOString(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: HomeContext = useMemo(() => ({ now, viewerTimeZone }), [now, viewerTimeZone]);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const week = useMemo(() => homeWeek(groups, ctx, { canWithdraw: CAN_WITHDRAW_DECLINE }), [groups, ctx]);
  const cards = useMemo(() => groupCards(groups, ctx), [groups, ctx]);
  const name = profile?.display_name ?? null;

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
      <View style={{ padding: 24, gap: 4, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 24, textAlign: 'center' }}>{`Welcome to ${APP_NAME}`}</Text>
        <Text variant="subhead" color="textSecondary" style={{ textAlign: 'center' }}>
          Start a group and invite people, or join with a link someone sent you.
        </Text>
        <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
          <Button label="Go to Groups" variant="secondary" onPress={() => router.push('/groups')} />
        </View>
      </View>
    );
  } else {
    const { hero, needsYou, thisWeek, nextTurn } = week;
    body = (
      <>
        {hero ? (
          <Hero
            hero={hero}
            busy={busyKey === hero.key}
            onOpen={() => openAssignment(hero.groupId, hero.assignmentId)}
            onCantMakeIt={() => openAssignment(hero.groupId, hero.assignmentId, 'decline')}
            onConfirm={() =>
              void send(hero.key, hero.groupId, { type: 'confirm', assignmentId: hero.assignmentId }, successMessage('confirm', hero.responsibilityName, hero.date))
            }
          />
        ) : (
          <NothingThisWeek nextTurn={nextTurn} />
        )}

        {needsYou.length ? (
          <>
            <SectionHead title="Needs you" />
            {needsYou.map((item) => (
              <AttentionCard key={`${item.kind}:${item.key}`} item={item} busy={busyKey === item.key} onAction={(a) => onAttention(item, a)} />
            ))}
          </>
        ) : null}

        {thisWeek.length ? (
          <>
            <SectionHead title="This week" />
            <ThisWeekList turns={thisWeek} onOpen={(t) => openAssignment(t.groupId, t.assignmentId)} />
          </>
        ) : null}

        <SectionHead title="Your groups" />
        {cards.map((card) => (
          <HomeGroupCard key={card.groupId} card={card} />
        ))}
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
