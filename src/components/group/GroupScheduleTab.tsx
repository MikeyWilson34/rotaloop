import { CalendarPlus } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import { EventCard, SkipCard } from '@/components/schedule/cards';
import { SectionHeading } from '@/components/schedule/parts';
import { Card, IconTile, Text } from '@/components/ui';
import { deviceTimeZone } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { scheduleGroupOf } from '@/lib/schedule';
import { dateIn, zoneCity } from '@/schedule/format';
import { eventViews, groupByWeek } from '@/schedule/views';
import { useTheme } from '@/theme';

/**
 * The Group's upcoming Events with who serves each Responsibility, Skip Dates included,
 * by week. Adding and removing Skip Dates arrives with ticket 10.
 */
export function GroupScheduleTab({ group, accountId }: { group: GroupDetails; accountId: string | null }) {
  const { space } = useTheme();
  const viewerTimeZone = deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dateIn(now, viewerTimeZone);
  const weeks = useMemo(() => {
    const events = eventViews([scheduleGroupOf(group, accountId)], now, viewerTimeZone);
    return groupByWeek(events, today);
  }, [group, accountId, now, viewerTimeZone, today]);

  if (weeks.length === 0) {
    return (
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xxl }}>
        <IconTile icon={CalendarPlus} size={48} bg="primaryTint" fg="primary" />
        <Text variant="title3" style={{ textAlign: 'center' }}>
          No Events yet
        </Text>
        <Text color="textSecondary" style={{ textAlign: 'center' }}>
          No Events yet. An Admin can add an Event Series in Settings.
        </Text>
      </Card>
    );
  }
  return (
    <>
      {group.timeZone !== viewerTimeZone ? (
        <Text variant="caption" color="textSecondary">
          {`Times in your time zone (${zoneCity(viewerTimeZone)}). The group's own time shows where it differs.`}
        </Text>
      ) : null}
      {weeks.map((week) => (
        <View key={week.key} style={{ gap: space.md }}>
          <SectionHeading title={week.label} aside={week.range} />
          {week.items.map((event) =>
            event.skipDate ? (
              <SkipCard key={event.key} event={event} showGroup={false} />
            ) : (
              <EventCard key={event.key} event={event} viewerTimeZone={viewerTimeZone} today={today} />
            ),
          )}
        </View>
      ))}
    </>
  );
}
