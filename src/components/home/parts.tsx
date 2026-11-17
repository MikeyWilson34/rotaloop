import {
  Activity,
  Calendar,
  CalendarClock,
  CalendarOff,
  CalendarX,
  CircleAlert,
  CircleCheck,
  Clock,
  Handshake,
  Repeat,
  Send,
  Settings,
  Shield,
  Shuffle,
  Undo2,
  UserCheck,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { SkeletonBlock } from '@/components/schedule/parts';
import { Text } from '@/components/ui';
import type { ActivityIcon } from '@/activity/feed';
import type { AttentionIcon } from '@/home/home';
import { useTheme, type ColorTokens } from '@/theme';

export const ICONS: Record<ActivityIcon | AttentionIcon, LucideIcon> = {
  alert: CircleAlert,
  repeat: Repeat,
  send: Send,
  clock: Clock,
  calendar: CalendarClock,
  handshake: Handshake,
  userCheck: UserCheck,
  checkCircle: CircleCheck,
  calX: CalendarX,
  calOff: CalendarOff,
  userPlus: UserPlus,
  userMinus: UserMinus,
  settings: Settings,
  shuffle: Shuffle,
  shield: Shield,
  undo: Undo2,
  activity: Activity,
};
// The schedule-change icon in the feed is a plain calendar.
export const FEED_ICONS: Record<ActivityIcon, LucideIcon> = { ...ICONS, calendar: Calendar };

export type Tone = 'bad' | 'warn' | 'info' | 'ok' | 'neutral';

export const TONES: Record<Tone, { bg: keyof ColorTokens; fg: keyof ColorTokens; bar: keyof ColorTokens }> = {
  bad: { bg: 'dangerTint', fg: 'dangerText', bar: 'danger' },
  warn: { bg: 'warningTint', fg: 'warningText', bar: 'warning' },
  info: { bg: 'primaryTint', fg: 'primary', bar: 'primary' },
  ok: { bg: 'successTint', fg: 'successText', bar: 'success' },
  neutral: { bg: 'neutralTint', fg: 'textSecondary', bar: 'borderStrong' },
};

/** A 40px tinted icon square (prototype `.att-ic`). */
export function ToneIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  const { colors } = useTheme();
  const t = TONES[tone];
  return (
    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors[t.bg], alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={20} color={colors[t.fg]} strokeWidth={1.75} />
    </View>
  );
}

/** A section heading with an optional count and a link (prototype `.sec-head`). */
export function SectionHead({
  title,
  count,
  link,
}: {
  title: string;
  count?: number;
  link?: { label: string; onPress: () => void };
}) {
  const { colors, fonts, minTapTarget } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.extrabold, fontSize: 18, lineHeight: 24 }}>
          {title}
        </Text>
        {count ? (
          <View
            accessibilityLabel={`${count} items`}
            style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.warningTint, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, lineHeight: 16, color: colors.warningText }}>{String(count)}</Text>
          </View>
        ) : null}
      </View>
      {link ? (
        <Pressable
          accessibilityRole="link"
          onPress={link.onPress}
          style={({ pressed }) => ({ minHeight: minTapTarget, paddingHorizontal: 4, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.primary }}>{link.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "You're all caught up." (prototype `.caught`). */
export function CaughtUp({ text }: { text: string }) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: radii.lg,
        backgroundColor: colors.successTint,
      }}>
      <CircleCheck size={20} color={colors.successText} strokeWidth={1.75} />
      <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.successText }}>{text}</Text>
    </View>
  );
}

/** A filter chip with an optional count; the row scrolls sideways instead of wrapping. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { colors, fonts, radii, space } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      style={{ marginHorizontal: -space.lg, flexGrow: 0 }}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 4 }}>
      {options.map((o) => {
        const selected = o.value === value;
        const fg = selected ? colors.onChipOn : colors.text;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            aria-checked={selected}
            accessibilityLabel={o.count !== undefined ? `${o.label}, ${o.count}` : o.label}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <View
              style={{
                minHeight: 40,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 14,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: selected ? colors.chipOn : colors.borderStrong,
                backgroundColor: selected ? colors.chipOn : colors.surface,
              }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: fg }}>{o.label}</Text>
              {o.count !== undefined ? (
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: fg, opacity: 0.8 }}>{String(o.count)}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Loading placeholder for Home: the hero, two attention cards and a group card. */
export function HomeSkeleton() {
  const { colors, radii, space } = useTheme();
  const card = (h: number, key: string) => (
    <View key={key} style={{ height: h, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, gap: 8 }}>
      <SkeletonBlock height={16} width="55%" radius={6} />
      <SkeletonBlock height={14} width="35%" radius={6} />
    </View>
  );
  return (
    <View accessible accessibilityLabel="Loading" style={{ gap: space.md }}>
      <View style={{ height: 230, borderRadius: radii.xl, backgroundColor: colors.surfaceAlt }} />
      <SkeletonBlock height={20} width="50%" radius={6} />
      {card(96, 'a')}
      {card(96, 'b')}
      <SkeletonBlock height={20} width="40%" radius={6} />
      {card(72, 'c')}
    </View>
  );
}
