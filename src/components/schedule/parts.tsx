import { router } from 'expo-router';
import { View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { Text } from '@/components/ui';
import { accentFor } from '@/lib/groupViews';
import { dayOfMonth, monthAbbrev } from '@/schedule/format';
import type { DisplayStatus } from '@/schedule/views';
import { useTheme, type ColorTokens } from '@/theme';

/** Status dot colours (prototype `.sdot`): decorative, always next to a label or in a labelled row. */
export const statusDotColor: Record<DisplayStatus, keyof ColorTokens> = {
  confirmed: 'success',
  pending: 'warning',
  needsCoverage: 'danger',
  covered: 'primary',
  scheduled: 'borderStrong',
};

export function StatusDot({ status, size = 10 }: { status: DisplayStatus; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors[statusDotColor[status]] }}
    />
  );
}

/** A Group's identity dot (accent colour). */
export function GroupDot({ groupId, size = 8 }: { groupId: string; size?: number }) {
  const { groupAccents } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: groupAccents[accentFor(groupId)].icon }}
    />
  );
}

/** The 52px date box (prototype `.datebox`): month and day; tinted when it's the viewer's day. */
export function DateBox({ date, mine, skipped }: { date: string; mine?: boolean; skipped?: boolean }) {
  const { colors, fonts, radii } = useTheme();
  const fg = skipped ? colors.textTertiary : mine ? colors.primary : colors.text;
  return (
    <View
      style={{
        width: 52,
        paddingVertical: 6,
        borderRadius: radii.md,
        alignItems: 'center',
        backgroundColor: skipped ? 'transparent' : mine ? colors.primaryTint : colors.surfaceAlt,
        borderWidth: skipped ? 1.5 : 0,
        borderStyle: 'dashed',
        borderColor: colors.borderStrong,
      }}>
      <Text
        style={{
          fontFamily: fonts.extrabold,
          fontSize: 11,
          lineHeight: 14,
          letterSpacing: 0.66,
          textTransform: 'uppercase',
          color: skipped ? colors.textTertiary : mine ? colors.primary : colors.textSecondary,
        }}>
        {monthAbbrev(date)}
      </Text>
      <Text
        style={{
          fontFamily: fonts.extrabold,
          fontSize: 22,
          lineHeight: 26,
          color: fg,
          textDecorationLine: skipped ? 'line-through' : 'none',
        }}>
        {String(dayOfMonth(date))}
      </Text>
    </View>
  );
}

/** Diagonal hatching for Skip Dates (prototype `.skipcard` background). Fills its parent. */
export function Hatch() {
  const { colors, scheme } = useTheme();
  const id = `rl-hatch-${scheme}`;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={20} height={20} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={10} height={20} fill={colors.surfaceAlt} fillOpacity={0.7} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A week heading (prototype `.week-h`): "Next week" and its date range. */
export function SectionHeading({ title, aside }: { title: string; aside?: string }) {
  const { fonts, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: space.sm,
        marginTop: space.md,
      }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 20, flexShrink: 1 }}>
        {title}
      </Text>
      {aside ? (
        <Text variant="caption" color="textTertiary" style={{ fontFamily: fonts.bold }}>
          {aside}
        </Text>
      ) : null}
    </View>
  );
}

/** A grey placeholder block for loading states. */
export function SkeletonBlock({ height, width = '100%', radius }: { height: number; width?: number | `${number}%`; radius?: number }) {
  const { colors, radii } = useTheme();
  return <View style={{ height, width, borderRadius: radius ?? radii.md, backgroundColor: colors.surfaceAlt }} />;
}

/** Loading placeholder for schedule lists: a heading and a few cards. */
export function ScheduleSkeleton({ cards = 3 }: { cards?: number }) {
  const { colors, radii, space } = useTheme();
  return (
    <View accessible accessibilityLabel="Loading" style={{ gap: space.md }}>
      <SkeletonBlock height={18} width="40%" radius={6} />
      {Array.from({ length: cards }, (_, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            gap: 14,
            padding: 14,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}>
          <SkeletonBlock height={56} width={52} />
          <View style={{ flex: 1, gap: space.sm, justifyContent: 'center' }}>
            <SkeletonBlock height={16} width="60%" radius={6} />
            <SkeletonBlock height={14} width="40%" radius={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Opens an Assignment's details. */
export function openAssignment(groupId: string, assignmentId: string) {
  router.push({ pathname: '/assignment/[groupId]/[assignmentId]', params: { groupId, assignmentId } });
}
