import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupScheduleTab } from '@/components/group/GroupScheduleTab';
import { GroupTile } from '@/components/group/GroupTile';
import { InviteSheet } from '@/components/group/InviteSheet';
import type { RunCommand } from '@/components/group/MemberActionsSheet';
import { MembersTab } from '@/components/group/MembersTab';
import { OverviewTab } from '@/components/group/OverviewTab';
import { SettingsTab } from '@/components/group/SettingsTab';
import { Badge, Button, Notice, SegmentedControl, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { activeMemberCount, memberCountLabel, myMember } from '@/lib/groupViews';
import { GROUP_GONE, useGroup, useRunCommand } from '@/lib/groups';
import { fetchGroupInviteToken, resetGroupInviteToken } from '@/lib/inviteLinks';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'members', label: 'Members' },
  { value: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function isTab(value: unknown): value is Tab {
  return TABS.some((t) => t.value === value);
}

/** A Group: header, segmented tabs, Overview (setup or next Event, history), Schedule, Members and Settings. */
export default function GroupScreen() {
  const { groupId, tab: tabParam } = useLocalSearchParams<{ groupId: string; tab?: string }>();
  const { colors, space, minTapTarget } = useTheme();
  const { session } = useSession();
  const accountId = session?.user.id ?? null;
  const { data, loading, error, refresh, reload, refreshing } = useGroup(groupId);
  const [inviting, setInviting] = useState(false);
  const tab: Tab = isTab(tabParam) ? tabParam : 'overview';

  const run: RunCommand = useRunCommand(groupId, reload);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }

  const me = data ? myMember(data.state, accountId) : undefined;
  const isAdmin = !!me?.isAdmin;

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
          accessibilityLabel="Invite people"
          onPress={() => setInviting(true)}
          style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
          <UserPlus size={24} color={colors.text} strokeWidth={1.75} />
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
    const gone = error === GROUP_GONE || (data && !me);
    body = (
      <View style={{ padding: space.lg, gap: space.md }}>
        <Notice>{gone ? GROUP_GONE : (error ?? GROUP_GONE)}</Notice>
        {gone ? (
          <Button label="Back to Groups" variant="secondary" onPress={() => router.replace('/groups')} />
        ) : (
          <Button label="Try again" variant="secondary" onPress={refresh} />
        )}
      </View>
    );
  } else {
    body = (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          <GroupTile groupId={data.id} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title2" accessibilityRole="header" numberOfLines={2}>
              {data.name}
            </Text>
            <Text variant="subhead" color="textSecondary">
              {memberCountLabel(activeMemberCount(data.state))}
            </Text>
            <View style={{ marginTop: 4 }}>
              {isAdmin ? <Badge label="You're an Admin" tone="admin" /> : <Badge label="Member" />}
            </View>
          </View>
        </View>
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <SegmentedControl
            accessibilityLabel="Group sections"
            options={TABS}
            value={tab}
            onChange={(next) => router.setParams({ tab: next })}
          />
        </View>
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          {tab === 'overview' ? (
            <OverviewTab group={data} accountId={accountId} isAdmin={isAdmin} run={run} onInvite={() => setInviting(true)} />
          ) : null}
          {tab === 'schedule' ? <GroupScheduleTab group={data} accountId={accountId} isAdmin={isAdmin} run={run} /> : null}
          {tab === 'members' ? (
            <MembersTab group={data} accountId={accountId} isAdmin={isAdmin} run={run} onInvite={() => setInviting(true)} />
          ) : null}
          {tab === 'settings' ? (
            <SettingsTab group={data} me={me} isAdmin={isAdmin} run={run} reload={reload} onInvite={() => setInviting(true)} />
          ) : null}
        </View>
        {/* Every Member can share the join link; only Admins can reset it. */}
        <InviteSheet
          visible={inviting}
          onClose={() => setInviting(false)}
          groupName={data.name}
          title="Invite people"
          message="Anyone with this link or QR code joins the group directly."
          loadToken={() => fetchGroupInviteToken(data.id)}
          resetToken={isAdmin ? () => resetGroupInviteToken(data.id) : undefined}
          shareMessage={`Join ${data.name} on ${APP_NAME}:`}
        />
      </>
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
