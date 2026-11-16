import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { initials } from '@/lib/validation';
import { useTheme } from '@/theme';

export type NoteTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

/** A tinted note with an icon (prototype `.note` / `.debt`). */
export function Note({ icon: Icon, tone, children, live }: { icon: LucideIcon; tone: NoteTone; children: string; live?: boolean }) {
  const { colors, radii, space } = useTheme();
  const bg = {
    primary: colors.primaryTint,
    success: colors.successTint,
    warning: colors.warningTint,
    danger: colors.dangerTint,
    neutral: colors.surfaceAlt,
  }[tone];
  const fg = {
    primary: colors.primary,
    success: colors.successText,
    warning: colors.warningText,
    danger: colors.dangerText,
    neutral: colors.textSecondary,
  }[tone];
  return (
    <View
      accessibilityLiveRegion={live ? 'polite' : undefined}
      accessibilityRole={live ? 'alert' : undefined}
      style={{ flexDirection: 'row', gap: 10, padding: space.md, borderRadius: radii.md, backgroundColor: bg }}>
      <Icon size={20} color={fg} strokeWidth={1.75} />
      <Text variant="subhead" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

/** A small initials avatar; `stacked` overlaps it with the previous one (prototype `.av-stack`). */
export function MiniAvatar({ name, stacked, size = 28 }: { name: string; stacked?: boolean; size?: number }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        marginLeft: stacked ? -8 : 0,
        borderWidth: 2,
        borderColor: colors.surface,
        backgroundColor: colors.primaryTint,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: size < 32 ? 10 : 12, lineHeight: 14, color: colors.primary }}>
        {initials(name)}
      </Text>
    </View>
  );
}

/** Up to five overlapping avatars and the names beside them. */
export function PeopleRow({ names, text }: { names: string[]; text: string }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {names.length ? (
        <View style={{ flexDirection: 'row' }}>
          {names.slice(0, 5).map((n, i) => (
            <MiniAvatar key={`${n}-${i}`} name={n} stacked={i > 0} />
          ))}
        </View>
      ) : null}
      <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
