import { router } from 'expo-router';
import { ChevronRight, Link, Plus } from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { Badge, Button, Card, Notice, Screen, Text } from '@/components/ui';
import { formatEventTime, type GroupCardView } from '@/lib/groupViews';
import { useMyGroups } from '@/lib/groups';
import { useTheme } from '@/theme';

export default function GroupsScreen() {
  const { colors, space } = useTheme();
  const { data, loading, error, refresh, refreshing } = useMyGroups();
  const groups = data ?? [];

  const actions = (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <Button label="Create a group" variant="secondary" onPress={() => router.push('/create-group')} />
      <Button label="Join with an invite link" variant="quiet" onPress={() => router.push('/join')} />
    </View>
  );

  return (
    <Screen
      title="Groups"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      {loading ? (
        <View style={{ paddingVertical: space.huge }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <>
          <Notice>{error}</Notice>
          <Button label="Try again" variant="secondary" onPress={refresh} />
        </>
      ) : groups.length === 0 ? (
        <>
          <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xxl }}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ padding: space.sm, borderRadius: 12, backgroundColor: colors.successTint }}>
                <Plus size={24} color={colors.successText} strokeWidth={1.75} />
              </View>
              <View style={{ padding: space.sm, borderRadius: 12, backgroundColor: colors.primaryTint }}>
                <Link size={24} color={colors.primary} strokeWidth={1.75} />
              </View>
            </View>
            <Text variant="title3" style={{ textAlign: 'center' }}>
              {"You're not in a group yet"}
            </Text>
            <Text color="textSecondary" style={{ textAlign: 'center' }}>
              Start one and invite people, or join with a link or QR code someone sent you.
            </Text>
          </Card>
          {actions}
        </>
      ) : (
        <>
          <Text variant="subhead" color="textSecondary" style={{ marginTop: -space.sm }}>
            {groups.length === 1 ? '1 group' : `${groups.length} groups`}
          </Text>
          {groups.map((g) => (
            <GroupCard key={g.groupId} group={g} />
          ))}
          {actions}
        </>
      )}
    </Screen>
  );
}

function GroupCard({ group }: { group: GroupCardView }) {
  const { colors, radii, space, fonts, shadows } = useTheme();
  const next = group.nextEventAt ? formatEventTime(group.nextEventAt, group.timeZone) : 'No Events yet';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name}. ${group.nextEventAt ? `Next Event ${next}` : next}.${group.isAdmin ? ' You are an Admin.' : ''}`}
      onPress={() => router.push({ pathname: '/group/[groupId]', params: { groupId: group.groupId } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 72,
        padding: 14,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}>
      <GroupTile groupId={group.groupId} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 22 }}>
          {group.name}
        </Text>
        <Text variant="subhead" color="textSecondary" numberOfLines={1}>
          {next}
        </Text>
      </View>
      {group.isAdmin ? <Badge label="Admin" tone="admin" /> : null}
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}
