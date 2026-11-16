import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, CalendarOff, CalendarPlus, LayoutGrid, List } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MonthCalendar } from '@/components/schedule/MonthCalendar';
import { ScheduleSkeleton, SectionHeading } from '@/components/schedule/parts';
import { ScheduleItemCard } from '@/components/schedule/ScheduleItemCard';
import { Button, Card, Chip, ChipGroup, IconTile, Notice, SegmentedControl, Text } from '@/components/ui';
import { useMySchedule } from '@/lib/schedule';
import { dateIn, formatDayLong, relativeDay, zoneCity } from '@/schedule/format';
import {
  dayItems,
  eventViews,
  groupByWeek,
  monthBounds,
  monthDays,
  monthOf,
  scheduleItems,
  shiftMonth,
  type Scope,
} from '@/schedule/views';
import { useTheme } from '@/theme';

const VIEWS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'month', label: 'Month', icon: LayoutGrid },
] as const;
type View_ = (typeof VIEWS)[number]['value'];

type Params = { view?: string; scope?: string; month?: string; day?: string };

/**
 * The Schedule tab: upcoming Events and Assignments across all the person's Groups, as a list
 * by week or a month calendar, for "Just me" or "Everyone in my groups". Times are shown in the
 * device's time zone, with the Group's own time when it differs. The view, scope, month and
 * selected day live in the URL, so they survive reloads and can be linked to.
 */
export default function ScheduleScreen() {
  const { colors, space, minTapTarget } = useTheme();
  const params = useLocalSearchParams<Params>();
  const view: View_ = params.view === 'month' ? 'month' : 'list';
  const scope: Scope = params.scope === 'everyone' ? 'everyone' : 'me';
  const { data, loading, error, refresh, refreshing } = useMySchedule();

  const viewerTimeZone = data?.viewerTimeZone ?? 'UTC';
  // Statuses depend on the time: recomputed with every load.
  const now = useMemo(() => new Date().toISOString(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dateIn(now, viewerTimeZone);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const allEvents = useMemo(() => eventViews(groups, now, viewerTimeZone, `${monthOf(today)}-01`), [groups, now, viewerTimeZone, today]);
  const upcoming = useMemo(() => allEvents.filter((e) => e.date >= today), [allEvents, today]);
  const items = useMemo(() => scheduleItems(upcoming, scope), [upcoming, scope]);
  const weeks = useMemo(() => groupByWeek(items, today), [items, today]);

  const bounds = monthBounds(allEvents, today);
  const requestedMonth = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : bounds.first;
  const month = requestedMonth < bounds.first ? bounds.first : requestedMonth > bounds.last ? bounds.last : requestedMonth;
  const selectedDay = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : null;
  const days = useMemo(() => monthDays(allEvents, scope, month, today), [allEvents, scope, month, today]);

  const otherZone = groups.some((g) => g.timeZone !== viewerTimeZone);
  const set = (next: Partial<Params>) => router.setParams(next);

  const header = (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title1" accessibilityRole="header">
            Schedule
          </Text>
          <Text variant="subhead" color="textSecondary">
            {scope === 'me' ? 'Your Assignments' : 'All your groups'}
            {otherZone ? ` · Times in your time zone (${zoneCity(viewerTimeZone)})` : ''}
          </Text>
        </View>
        {/* Time Off (ticket 10). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Time Off"
          onPress={() => router.push('/time-off')}
          style={({ pressed }) => ({
            width: minTapTarget,
            height: minTapTarget,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}>
          <CalendarOff size={24} color={colors.text} strokeWidth={1.75} />
        </Pressable>
      </View>
      <SegmentedControl
        accessibilityLabel="Schedule view"
        options={VIEWS}
        value={view}
        onChange={(next) => set({ view: next })}
      />
      <ChipGroup>
        <Chip label="Just me" selected={scope === 'me'} onPress={() => set({ scope: 'me' })} />
        <Chip label="Everyone in my groups" selected={scope === 'everyone'} onPress={() => set({ scope: 'everyone' })} />
      </ChipGroup>
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <ScheduleSkeleton />;
  } else if (error) {
    body = (
      <View style={{ gap: space.md }}>
        <Notice>{error}</Notice>
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  } else if (groups.length === 0) {
    body = (
      <EmptyCard
        title="You're not in a group yet"
        text="Join or start a group, and its Events and your turns show up here.">
        <Button label="Go to Groups" variant="secondary" onPress={() => router.push('/groups')} />
      </EmptyCard>
    );
  } else if (allEvents.length === 0) {
    body = <EmptyCard title="No Events yet" text="No Events yet. An Admin can add an Event Series in Settings." />;
  } else if (view === 'list') {
    body =
      weeks.length === 0 ? (
        <EmptyCard
          title={scope === 'me' ? 'Nothing scheduled for you' : 'Nothing scheduled'}
          text={
            scope === 'me'
              ? "You have no upcoming Assignments. See who's serving with \"Everyone in my groups\"."
              : 'No upcoming Events in your groups.'
          }
        />
      ) : (
        weeks.map((week) => (
          <View key={week.key} style={{ gap: space.md }}>
            <SectionHeading title={week.label} aside={week.range} />
            {week.items.map((item) => (
              <ScheduleItemCard key={item.key} item={item} viewerTimeZone={viewerTimeZone} today={today} />
            ))}
          </View>
        ))
      );
  } else {
    const dayList = selectedDay ? dayItems(allEvents, scope, selectedDay) : [];
    body = (
      <>
        <MonthCalendar
          month={month}
          days={days}
          selected={selectedDay}
          onSelect={(date) => set({ day: date, month: monthOf(date) })}
          onPrev={month > bounds.first ? () => set({ month: shiftMonth(month, -1), day: undefined }) : null}
          onNext={month < bounds.last ? () => set({ month: shiftMonth(month, 1), day: undefined }) : null}
          legendGroups={groups.map((g) => ({ id: g.id, name: g.name }))}
        />
        {selectedDay ? (
          <View style={{ gap: space.md }}>
            <SectionHeading title={formatDayLong(selectedDay)} aside={relativeDay(selectedDay, today)} />
            {dayList.length ? (
              dayList.map((item) => (
                <ScheduleItemCard key={item.key} item={item} viewerTimeZone={viewerTimeZone} today={today} />
              ))
            ) : (
              <Card>
                <Text color="textSecondary" style={{ textAlign: 'center' }}>
                  {scope === 'me' ? "You're not serving on this day." : 'Nothing on this day.'}
                </Text>
              </Card>
            )}
          </View>
        ) : (
          <Text variant="subhead" color="textSecondary" style={{ textAlign: 'center', paddingVertical: space.md }}>
            {"Tap a day to see who's serving."}
          </Text>
        )}
      </>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {header}
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyCard({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  const { space } = useTheme();
  const isEmptyEvents = title === 'No Events yet';
  return (
    <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xxl }}>
      <IconTile icon={isEmptyEvents ? CalendarPlus : CalendarDays} size={48} bg="primaryTint" fg="primary" />
      <Text variant="title3" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text color="textSecondary" style={{ textAlign: 'center' }}>
        {text}
      </Text>
      {children}
    </Card>
  );
}
