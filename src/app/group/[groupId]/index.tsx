import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Settings } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InviteCard } from '@/components/group/InviteCard';
import { ComingUp } from '@/components/group/ComingUp';
import { GroupTile } from '@/components/group/GroupTile';
import { MembersSection } from '@/components/group/MembersSection';
import type { RunCommand } from '@/components/group/runCommand';
import { TurnSheet } from '@/components/group/TurnSheet';
import { HeadcountSheet } from '@/components/home/HeadcountSheet';
import { SectionHeading } from '@/components/schedule/parts';
import { Button, Notice, Text } from '@/components/ui';
import type { TurnRow } from '@/lib/groupPage';
import { activeMemberCount, memberCountLabel, myMember } from '@/lib/groupViews';
import { GROUP_GONE, useGroup, useRunCommand, useSendBackIfDeleted } from '@/lib/groups';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

/**
 * A group (simplify ticket 06, prototype `PAGES.group`): one page that scrolls. Coming up (your
 * own turns tinted), then Members. Settings sit behind the gear.
 */
export default function GroupScreen() {
  const { groupId, tab } = useLocalSearchParams<{ groupId: string; tab?: string }>();
  const { colors, space, minTapTarget } = useTheme();
  const { session } = useSession();
  const accountId = session?.user.id ?? null;
  const { data, loading, error, refresh, reload, refreshing, deleted } = useGroup(groupId);
  // Someone else deleted it while this page was open: back to Groups with a plain message.
  useSendBackIfDeleted(groupId, deleted);
  const [open, setOpen] = useState<TurnRow | null>(null);
  const run: RunCommand = useRunCommand(groupId, reload);

  // Older links opened a tab of the group page; settings are their own page now.
  useEffect(() => {
    if (tab === 'settings' && groupId) router.replace({ pathname: '/group/[groupId]/settings', params: { groupId } });
  }, [tab, groupId]);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }

  const me = data ? myMember(data.state, accountId) : undefined;

  const topBar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={back}
        style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
        <ChevronLeft size={26} color={colors.text} strokeWidth={1.75} />
      </Pressable>
      {data && me ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Group settings"
          onPress={() => router.push({ pathname: '/group/[groupId]/settings', params: { groupId: data.id } })}
          style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={24} color={colors.text} strokeWidth={1.75} />
        </Pressable>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={{ paddingVertical: space.huge }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (error || !data || !me) {
    const gone = error === GROUP_GONE || !!deleted || (data && !me);
    body = (
      <View style={{ padding: space.lg, gap: space.md }}>
        <Notice>{deleted ? (error ?? GROUP_GONE) : gone ? GROUP_GONE : (error ?? GROUP_GONE)}</Notice>
        {gone ? (
          <Button label="Back to Groups" variant="secondary" onPress={() => router.replace('/groups')} />
        ) : (
          <Button label="Try again" variant="secondary" onPress={refresh} />
        )}
      </View>
    );
  } else {
    const count = activeMemberCount(data.state);
    // Only real member (the rest are stand-ins): the invite card sits between Coming up and Members, not under Members too.
    const solo = data.state.members.every((m) => m.leftAt !== null || m.id === me.id || m.accountId === null);
    body = (
      <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: space.xs }}>
          <GroupTile groupId={data.id} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title2" accessibilityRole="header" numberOfLines={2}>
              {data.name}
            </Text>
            <Text variant="subhead" color="textSecondary">
              {memberCountLabel(count)}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: space.md }}>
          <SectionHeading title="Coming up" />
        </View>
        <ComingUp group={data} accountId={accountId} onOpen={setOpen} />
        {solo ? (
          <InviteCard group={data} title="Invite" subtitle={null} />
        ) : null}

        <View style={{ marginTop: space.lg }}>
          <SectionHeading title="Members" />
        </View>
        <MembersSection group={data} myMemberId={me.id} run={run} showInviteCard={!solo} />

        {open?.headcount ? (
          <HeadcountSheet
            groupName={data.name}
            state={data.state}
            eventId={open.eventId}
            responsibilityId={open.headcount.responsibilityId}
            jobName={open.jobName}
            startsAt={open.startsAt}
            myMemberId={me.id}
            send={(memberId, answer) =>
              run(
                { type: 'answerHeadcount', eventId: open.eventId, responsibilityId: open.headcount!.responsibilityId, memberId, answer },
                'answerHeadcount',
              )
            }
            onClose={() => setOpen(null)}
          />
        ) : open ? (
          <TurnSheet group={data} row={open} myMemberId={me.id} run={run} onClose={() => setOpen(null)} />
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {topBar}
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.huge }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
