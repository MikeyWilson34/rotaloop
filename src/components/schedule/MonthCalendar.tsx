import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { formatDayLong, formatMonthTitle } from '@/schedule/format';
import type { MonthDay } from '@/schedule/views';
import { useTheme } from '@/theme';

import { GroupDot } from './parts';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The month grid (prototype `schedMonth`): a dot per Group, the viewer's days filled, Skip
 * Dates dashed and struck, today ringed. Tapping a day selects it.
 */
export function MonthCalendar({
  month,
  days,
  selected,
  onSelect,
  onPrev,
  onNext,
  legendGroups,
}: {
  month: string;
  days: MonthDay[];
  selected: string | null;
  onSelect: (date: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  legendGroups: { id: string; name: string }[];
}) {
  const { colors, fonts, radii, shadows, space, minTapTarget } = useTheme();

  const navButton = (label: string, Icon: typeof ChevronLeft, onPress: (() => void) | null) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress ?? undefined}
      style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center', opacity: onPress ? 1 : 0.3 }}>
      <Icon size={22} color={colors.text} strokeWidth={1.75} />
    </Pressable>
  );

  return (
    <View
      style={{
        paddingVertical: space.md,
        paddingHorizontal: space.sm,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        {navButton('Previous month', ChevronLeft, onPrev)}
        <Text accessibilityRole="header" style={{ fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 22 }}>
          {formatMonthTitle(month)}
        </Text>
        {navButton('Next month', ChevronRight, onNext)}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {DOW.map((d, i) => (
          <Text
            key={i}
            importantForAccessibility="no"
            style={{
              width: `${100 / 7}%`,
              textAlign: 'center',
              fontFamily: fonts.extrabold,
              fontSize: 12,
              lineHeight: 16,
              paddingVertical: 4,
              color: colors.textTertiary,
            }}>
            {d}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {days.map((day) => (
          <DayCell key={day.date} day={day} selected={selected === day.date} onPress={() => onSelect(day.date)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.md, paddingHorizontal: 4 }}>
        <LegendItem swatch={<View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary }} />} label="You're serving" />
        <LegendItem
          swatch={
            <View style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong }} />
          }
          label="Day off"
        />
        {legendGroups.map((g) => (
          <LegendItem key={g.id} swatch={<GroupDot groupId={g.id} />} label={g.name} />
        ))}
      </View>
    </View>
  );
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  const { fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
      {swatch}
      <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 12, flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}

function DayCell({ day, selected, onPress }: { day: MonthDay; selected: boolean; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  const parts = [formatDayLong(day.date)];
  if (day.isToday) parts.push('today');
  if (day.mine) parts.push("you're serving");
  if (day.skipOnly) parts.push('Day off');
  if (!day.mine && day.groupIds.length) parts.push(day.groupIds.length === 1 ? '1 group' : `${day.groupIds.length} groups`);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={parts.join(', ')}
      accessibilityState={{ selected }}
      aria-pressed={selected}
      onPress={onPress}
      style={{
        width: `${100 / 7}%`,
        minHeight: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        paddingVertical: 4,
        backgroundColor: selected ? colors.primaryTint : 'transparent',
        opacity: day.inMonth ? 1 : 0.45,
      }}>
      {day.skipOnly ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 3,
            left: 3,
            right: 3,
            bottom: 3,
            borderRadius: 10,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: colors.borderStrong,
          }}
        />
      ) : null}
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: day.mine ? colors.primary : 'transparent',
          borderWidth: day.isToday ? 2 : 0,
          borderColor: day.mine ? colors.navy : colors.primary,
        }}>
        <Text
          style={{
            fontFamily: fonts.bold,
            fontSize: 15,
            lineHeight: 20,
            color: day.mine ? colors.onPrimary : day.skipOnly || !day.inMonth ? colors.textTertiary : colors.text,
            textDecorationLine: day.skipOnly ? 'line-through' : 'none',
          }}>
          {String(Number(day.date.slice(8, 10)))}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 2, height: 6 }}>
        {day.groupIds.slice(0, 4).map((id) => (
          <GroupDot key={id} groupId={id} size={6} />
        ))}
      </View>
    </Pressable>
  );
}
