import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { Text } from '@/components/ui';
import { formatDayLong, formatMonthTitle } from '@/schedule/format';
import { monthGrid } from '@/schedule/views';
import { useTheme } from '@/theme';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The Time Off month calendar (prototype `screenAvailability`): picked days filled red, days
 * already off hatched, the person's serving days dotted, today ringed. Past days can't be
 * picked.
 */
export function TimeOffCalendar({
  month,
  today,
  selected,
  rangeStart,
  off,
  serving,
  onPick,
  onPrev,
  onNext,
  hint,
}: {
  month: string;
  today: string;
  selected: Set<string>;
  rangeStart: string | null;
  off: Set<string>;
  serving: Set<string>;
  onPick: (date: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  hint?: string;
}) {
  const { colors, fonts, radii, shadows, space, minTapTarget } = useTheme();
  const nav = (label: string, Icon: typeof ChevronLeft, onPress: (() => void) | null) => (
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
        {nav('Previous month', ChevronLeft, onPrev)}
        <Text accessibilityRole="header" style={{ fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 22 }}>
          {formatMonthTitle(month)}
        </Text>
        {nav('Next month', ChevronRight, onNext)}
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
        {monthGrid(month).map((cell) => (
          <DayCell
            key={cell.date}
            date={cell.date}
            inMonth={cell.inMonth}
            isToday={cell.date === today}
            past={cell.date < today}
            picked={selected.has(cell.date)}
            rangeStart={rangeStart === cell.date}
            off={off.has(cell.date)}
            serving={serving.has(cell.date)}
            onPress={() => onPick(cell.date)}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.md, paddingHorizontal: 4 }}>
        <Legend swatch={<View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.danger }} />} label="Selected" />
        <Legend
          swatch={
            <View style={{ width: 14, height: 14, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: colors.dangerTint }}>
              <OffHatch />
            </View>
          }
          label="Already off"
        />
        <Legend swatch={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />} label="You’re serving" />
      </View>
      {hint ? (
        <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.bold, paddingTop: 6, paddingHorizontal: 4 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  const { fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch}
      <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.bold, fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

/** Red diagonal hatching for days already off (prototype `.cday.unav`). Fills its parent. */
function OffHatch() {
  const { colors, scheme } = useTheme();
  const id = `rl-off-hatch-${scheme}`;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={9} height={9} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={5} height={9} fill={colors.dangerTint} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

function DayCell({
  date,
  inMonth,
  isToday,
  past,
  picked,
  rangeStart,
  off,
  serving,
  onPress,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  past: boolean;
  picked: boolean;
  rangeStart: boolean;
  off: boolean;
  serving: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const parts = [formatDayLong(date)];
  if (isToday) parts.push('today');
  if (picked) parts.push('selected');
  if (off) parts.push('already off');
  if (serving) parts.push("you're serving");
  const ring = rangeStart ? colors.danger : isToday ? colors.primary : 'transparent';
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={parts.join(', ')}
      accessibilityState={{ checked: picked, disabled: past }}
      aria-checked={picked}
      disabled={past}
      onPress={onPress}
      style={{
        width: `${100 / 7}%`,
        minHeight: 52,
        borderRadius: 12,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        paddingVertical: 4,
        opacity: !inMonth || past ? 0.45 : 1,
      }}>
      {off ? <OffHatch /> : null}
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: picked ? colors.danger : 'transparent',
          borderWidth: 2,
          borderColor: picked && !rangeStart ? colors.danger : ring,
        }}>
        <Text
          style={{
            fontFamily: fonts.bold,
            fontSize: 15,
            lineHeight: 20,
            color: picked ? colors.onPrimary : off ? colors.dangerText : colors.text,
          }}>
          {String(Number(date.slice(8, 10)))}
        </Text>
      </View>
      <View style={{ height: 6, flexDirection: 'row' }}>
        {serving ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} /> : null}
      </View>
    </Pressable>
  );
}
