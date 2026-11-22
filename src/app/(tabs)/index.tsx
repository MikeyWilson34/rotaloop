import { router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActivityUnreadCount } from '@/activity/data';
import { AttentionCard } from '@/components/home/AttentionCard';
import { InstallCard } from '@/components/home/InstallCard';
import { HeadcountSheet } from '@/components/home/HeadcountSheet';
import { Hero } from '@/components/home/Hero';
import { HomeSkeleton, SectionHead } from '@/components/home/parts';
import { HomeGroupCard, NothingThisWeek, ThisWeekList } from '@/components/home/Week';
import { Button, Notice, showToast, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { CAN_WITHDRAW_DECLINE } from '@/coverage/actions';
import { successMessage } from '@/coverage/sheets';
import type { HeadcountReply } from '@/engine/types';
import { useHomeData } from '@/home/data';
import {
  greeting,
  groupCards,
  homeWeek,
  todayLabel,
  type AttentionAction,
  type AttentionItem,
  type HomeContext,
  type TurnView,
} from '@/home/home';
import { runGroupCommand } from '@/lib/groupCommand';
import { groupCommandMessage } from '@/lib/groupErrors';
import { deviceTimeZone } from '@/lib/groupViews';
import { answeredMessage } from '@/schedule/headcount';
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
  const [answering, setAnswering] = useState<HeadcountReply | null>(null);
  /** The headcount date whose sheet is open: `TurnView.key`. */
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  /** Sends a "Coming?" answer; resolves to a plain-language error, or null when it worked. */
  async function sendAnswer(groupId: string, t: TurnView, memberId: string, answer: HeadcountReply): Promise<string | null> {
    if (!t.headcount) return null;
    const result = await runGroupCommand(groupId, {
      type: 'answerHeadcount',
      eventId: t.headcount.eventId,
      responsibilityId: t.headcount.responsibilityId,
      memberId,
      answer,
    });
    if (!result.ok) return groupCommandMessage(result.reason, 'answerHeadcount');
    await reload();
    return null;
  }

  /** The hero's Yes / No: the viewer's own answer. */
  async function answerHero(t: TurnView, answer: HeadcountReply) {
    const me = groups.find((g) => g.id === t.groupId)?.myMemberId;
    if (!me) return;
    setBusyKey(t.key);
    setAnswering(answer);
    try {
      const failed = await sendAnswer(t.groupId, t, me, answer);
      showToast(failed ?? answeredMessage(answer));
    } finally {
      setBusyKey(null);
      setAnswering(null);
    }
  }

  function openTurn(t: TurnView) {
    if (t.headcount) setOpenKey(t.key);
    else openAssignment(t.groupId, t.assignmentId);
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

  // The open headcount sheet's date, looked up again after every reload so it stays current.
  const openTurnView = openKey ? [week.hero, ...week.thisWeek].find((t) => t?.key === openKey) : undefined;
  const openGroup = openTurnView ? groups.find((g) => g.id === openTurnView.groupId) : undefined;
  const openHeadcount = openTurnView?.headcount && openGroup ? { turn: openTurnView, group: openGroup } : null;

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
            onOpen={() => openTurn(hero)}
            onAnswer={(answer) => void answerHero(hero, answer)}
            answering={busyKey === hero.key ? answering : null}
            onCantMakeIt={() => openAssignment(hero.groupId, hero.assignmentId, 'decline')}
            onConfirm={() =>
              void send(hero.key, hero.groupId, { type: 'confirm', assignmentId: hero.assignmentId }, successMessage('confirm', hero.responsibilityName, hero.date))
            }
          />
        ) : (
          <NothingThisWeek nextTurn={nextTurn} allSet={week.allSet} />
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
            <ThisWeekList turns={thisWeek} onOpen={openTurn} />
          </>
        ) : null}

        <SectionHead title="Your groups" />
        {cards.map((card) => (
          <HomeGroupCard key={card.groupId} card={card} />
        ))}
        {openHeadcount ? (
          <HeadcountSheet
            groupName={openHeadcount.group.name}
            state={openHeadcount.group.state}
            eventId={openHeadcount.turn.headcount!.eventId}
            responsibilityId={openHeadcount.turn.headcount!.responsibilityId}
            jobName={openHeadcount.turn.responsibilityName}
            startsAt={openHeadcount.turn.startsAt}
            myMemberId={openHeadcount.group.myMemberId}
            send={(memberId, answer) => sendAnswer(openHeadcount.group.id, openHeadcount.turn, memberId, answer)}
            onClose={() => setOpenKey(null)}
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
        <InstallCard />
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
