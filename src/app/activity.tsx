import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { markActivitySeen, useActivityFeed } from '@/activity/data';
import {
  ACTIVITY_FILTERS,
  activityItems,
  filterActivity,
  groupActivityByDay,
  parseActivityFilter,
  type ActivityFilter,
  type ActivityItem,
} from '@/activity/feed';
import { useLastSeen } from '@/activity/lastSeen';
import { GroupDot, SectionHeading, SkeletonBlock } from '@/components/schedule/parts';
import { FEED_ICONS, FilterChips, ToneIcon } from '@/components/home/parts';
import { Button, Card, Notice, Text } from '@/components/ui';
import { deviceTimeZone } from '@/lib/groupViews';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

/**
 * The Activity tab (ticket 12; prototype `screenActivity`): schedule history across the
 * person's Groups, newest first, by day, with filters and unread dots. Viewing the tab marks
 * everything seen; the dots stay for this visit so the person can still spot what's new.
 */
export default function ActivityScreen() {
  const { colors, fonts, space, minTapTarget } = useTheme();
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter = parseActivityFilter(params.filter);
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const feed = useActivityFeed();
  const lastSeen = useLastSeen(userId);

  // "Last seen" as it was when this visit started: it decides the dots on screen.
  const [visit, setVisit] = useState(0);
  const [snapshot, setSnapshot] = useState<{ visit: number; seen: string | null } | null>(null);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setVisit((n) => n + 1);
      return () => {
        focused.current = false;
      };
    }, []),
  );
  if (lastSeen !== undefined && visit > 0 && snapshot?.visit !== visit) setSnapshot({ visit, seen: lastSeen });
  const visitSeen = snapshot?.visit === visit ? snapshot.seen : undefined;
  // While the tab is open, everything loaded counts as seen.
  useEffect(() => {
    if (focused.current && userId && visitSeen !== undefined && !feed.loading) markActivitySeen(userId, feed.entries);
  }, [userId, visitSeen, feed.entries, feed.loading]);

  const viewerTimeZone = feed.schedule?.viewerTimeZone ?? deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [feed.entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(
    () => activityItems(feed.entries, feed.schedule?.groups ?? [], { now, viewerTimeZone, lastSeenAt: visitSeen ?? null }),
    [feed.entries, feed.schedule, now, viewerTimeZone, visitSeen],
  );
  const sections = useMemo(() => groupActivityByDay(filterActivity(items, filter), now, viewerTimeZone), [items, filter, now, viewerTimeZone]);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  let body: React.ReactNode;
  if (feed.loading) {
    body = <ActivitySkeleton />;
  } else if (feed.error) {
    body = (
      <View style={{ gap: space.md }}>
        <Notice>{feed.error}</Notice>
        <Button label="Try again" variant="secondary" onPress={feed.refresh} />
      </View>
    );
  } else if (sections.length === 0) {
    body = (
      <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
        <Text color="textSecondary" style={{ textAlign: 'center' }}>
          {(feed.schedule?.groups.length ?? 0) === 0
            ? 'Join or start a group, and its schedule changes show up here.'
            : filter === 'all'
              ? 'Nothing here yet.'
              : 'Nothing like this yet.'}
        </Text>
        {filter !== 'all' && feed.hasMore ? (
          <Button label="Load more" variant="quiet" loading={feed.loadingMore} onPress={feed.loadMore} />
        ) : null}
      </Card>
    );
  } else {
    body = (
      <>
        {sections.map((section) => (
          <View key={section.key} style={{ gap: space.sm }}>
            <SectionHeading title={section.label} />
            <View
              style={{
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
              }}>
              {section.items.map((item, i) => (
                <ActivityRow key={item.key} item={item} first={i === 0} />
              ))}
            </View>
          </View>
        ))}
        {feed.hasMore ? (
          <Button label="Load more" variant="secondary" loading={feed.loadingMore} onPress={feed.loadMore} style={{ marginTop: space.sm }} />
        ) : null}
      </>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} tintColor={colors.primary} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: -space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={back}
            style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={26} color={colors.text} strokeWidth={1.75} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title1" accessibilityRole="header" style={{ fontFamily: fonts.extrabold }}>
              Activity
            </Text>
            <Text variant="subhead" color="textSecondary">
              Across all your groups
            </Text>
          </View>
        </View>
        <FilterChips<ActivityFilter>
          label="Filter activity"
          value={filter}
          onChange={(v) => router.setParams({ filter: v === 'all' ? undefined : v })}
          options={ACTIVITY_FILTERS}
        />
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActivityRow({ item, first }: { item: ActivityItem; first: boolean }) {
  const { colors, fonts } = useTheme();
  const open = () => {
    if (item.target.kind === 'assignment') {
      router.push({ pathname: '/assignment/[groupId]/[assignmentId]', params: { groupId: item.target.groupId, assignmentId: item.target.assignmentId } });
    } else {
      router.push({ pathname: '/group/[groupId]', params: { groupId: item.target.groupId } });
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.unread ? 'Unread. ' : ''}${item.text}${item.detail ? ` ${item.detail}` : ''} ${item.meta}.`}
      accessibilityHint={item.target.kind === 'assignment' ? 'Opens the Assignment' : 'Opens the group'}
      onPress={open}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        minHeight: 48,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
      })}>
      <ToneIcon icon={FEED_ICONS[item.icon]} tone={item.tone} />
      <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
        <Text style={{ fontSize: 15, lineHeight: 21, fontFamily: item.unread ? fonts.semibold : fonts.regular }}>{item.text}</Text>
        {item.detail ? (
          <Text variant="subhead" color="textSecondary" style={{ marginTop: 2 }}>
            {item.detail}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <GroupDot groupId={item.groupId} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, lineHeight: 18, color: colors.textTertiary, fontFamily: fonts.semibold }}>
            {item.groupName}
          </Text>
          <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: 13, lineHeight: 18, color: colors.textTertiary, fontFamily: fonts.semibold }}>
            {`· ${item.time}`}
          </Text>
        </View>
      </View>
      {item.unread ? (
        <View
          accessibilityElementsHidden
          style={{ position: 'absolute', right: 16, top: 20, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }}
        />
      ) : null}
    </Pressable>
  );
}

function ActivitySkeleton() {
  const { colors, space } = useTheme();
  return (
    <View accessible accessibilityLabel="Loading" style={{ gap: space.sm }}>
      <SkeletonBlock height={18} width="30%" radius={6} />
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <SkeletonBlock height={40} width={40} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBlock height={15} width="85%" radius={6} />
              <SkeletonBlock height={13} width="45%" radius={6} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

