import { CalendarOff, CircleAlert, ChevronRight, Repeat } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { comingUp, turnDetails, type ComingUpDay, type TurnRow } from '@/lib/groupPage';
import { deviceTimeZone } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { scheduleGroupOf } from '@/lib/schedule';
import { dateIn, formatDayShort, formatTimeIn, relativeDay } from '@/schedule/format';
import { useTheme } from '@/theme';

import { PersonAvatar } from './PersonAvatar';

const PAGE = 5;

/**
 * "Coming up" (prototype `PAGES.group`): one card per date with each job and who has it. The
 * viewer's own turns are tinted so they can scan their schedule; swaps and breaks are said in
 * plain words. A date the whole group has off is a dashed card. Tapping a turn opens it.
 */
export function ComingUp({
  group,
  accountId,
  onOpen,
}: {
  group: GroupDetails;
  accountId: string | null;
  onOpen: (row: TurnRow) => void;
}) {
  const { space } = useTheme();
  const [shown, setShown] = useState(PAGE);
  const viewerTimeZone = deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(
    () => comingUp(scheduleGroupOf(group, accountId), now, viewerTimeZone),
    [group, accountId, now, viewerTimeZone],
  );
  const today = dateIn(now, viewerTimeZone);

  if (days.length === 0) {
    return (
      <Card>
        <Text color="textSecondary">No dates yet. Add a job in settings and the turns fill in.</Text>
      </Card>
    );
  }
  return (
    <View style={{ gap: space.md }}>
      {days.slice(0, shown).map((day) => (
        <DayCard key={day.key} day={day} today={today} viewerTimeZone={viewerTimeZone} onOpen={onOpen} />
      ))}
      {days.length > shown ? <LinkButton label="Show more dates" onPress={() => setShown((n) => n + PAGE)} /> : null}
    </View>
  );
}

function DayCard({
  day,
  today,
  viewerTimeZone,
  onOpen,
}: {
  day: ComingUpDay;
  today: string;
  viewerTimeZone: string;
  onOpen: (row: TurnRow) => void;
}) {
  const { colors, fonts, radii, space } = useTheme();
  if (day.kind === 'off') {
    return (
      <View
        accessible
        accessibilityLabel={`${formatDayShort(day.date)}: group day off. Nothing scheduled.`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: 14,
          borderRadius: radii.lg,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: colors.borderStrong,
        }}>
        <CalendarOff size={22} color={colors.textSecondary} strokeWidth={1.75} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.extrabold, textDecorationLine: 'line-through' }}>{formatDayShort(day.date)}</Text>
          <Text variant="subhead" color="textSecondary">
            Group day off. Nothing scheduled.
          </Text>
        </View>
      </View>
    );
  }
  return (
    <Card style={{ paddingTop: space.sm, paddingBottom: space.sm, gap: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 6 }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.extrabold, fontSize: 15 }}>
          {formatDayShort(day.date)}
        </Text>
        <Text variant="caption" color="textTertiary" style={{ fontFamily: fonts.bold }}>
          {relativeDay(day.date, today)}
        </Text>
      </View>
      {day.rows.map((row, i) => (
        <TurnRowView
          key={row.key}
          row={row}
          first={i === 0}
          afterMine={i > 0 && day.rows[i - 1].mine}
          time={formatTimeIn(row.startsAt, viewerTimeZone)}
          date={formatDayShort(day.date)}
          onPress={() => onOpen(row)}
        />
      ))}
    </Card>
  );
}

function TurnRowView({
  row,
  first,
  afterMine,
  time,
  date,
  onPress,
}: {
  row: TurnRow;
  first: boolean;
  afterMine: boolean;
  time: string;
  date: string;
  onPress: () => void;
}) {
  const { colors, fonts, radii, space } = useTheme();
  const details = turnDetails(row, time).join(' · ');
  const person = row.person;
  const whoText = row.needsCover ? 'Needs cover' : person.kind === 'open' ? 'Nobody yet' : person.label;
  const tag = person.kind === 'guest' ? 'Not in group' : person.kind === 'member' && person.isStandIn ? 'Stand-in' : null;
  const label = [
    `${row.jobName}, ${date}, ${details}`,
    row.swappedWith ? `swapped with ${row.swappedWith}` : null,
    row.needsCover ? 'Needs cover' : `${whoText}${tag ? ` (${tag})` : ''}`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 52,
        paddingVertical: 6,
        borderTopWidth: first || row.mine || afterMine ? 0 : 1,
        borderTopColor: colors.border,
        ...(row.mine
          ? { backgroundColor: colors.primaryTint, marginHorizontal: -10, paddingHorizontal: 10, borderRadius: radii.md }
          : null),
        opacity: pressed ? 0.7 : 1,
      })}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 }}>{row.jobName}</Text>
        <Text variant="caption" color="textSecondary">
          {details}
        </Text>
        {row.swappedWith ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Repeat size={12} color={colors.primary} strokeWidth={2.25} />
            <Text variant="caption" style={{ color: colors.primary, fontFamily: fonts.bold }}>
              {`swapped with ${row.swappedWith}`}
            </Text>
          </View>
        ) : null}
      </View>
      {row.needsCover ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: space.sm,
            paddingVertical: 4,
            borderRadius: radii.pill,
            backgroundColor: colors.dangerTint,
          }}>
          <CircleAlert size={14} color={colors.dangerText} strokeWidth={2.25} />
          <Text variant="caption" style={{ fontFamily: fonts.bold, color: colors.dangerText, fontSize: 12 }}>
            Needs cover
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, maxWidth: '50%' }}>
          {person.kind !== 'open' ? <PersonAvatar name={person.name} dashed={!!tag} size={28} onTint={row.mine} /> : null}
          <View style={{ flexShrink: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: row.mine ? fonts.extrabold : fonts.bold,
                fontSize: 14,
                color: row.mine ? colors.primary : colors.text,
              }}>
              {whoText}
            </Text>
            {tag ? (
              <Text variant="caption" color="textSecondary" style={{ fontSize: 11, lineHeight: 14, fontFamily: fonts.bold }}>
                {tag}
              </Text>
            ) : null}
          </View>
        </View>
      )}
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}

/** A text link (prototype `.link-btn`). */
export function LinkButton({ label, onPress, icon: Icon }: { label: string; onPress: () => void; icon?: typeof Repeat }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: pressed ? 0.6 : 1,
      })}>
      {Icon ? <Icon size={18} color={colors.primary} strokeWidth={2} /> : null}
      <Text style={{ fontFamily: fonts.extrabold, color: colors.primary, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
