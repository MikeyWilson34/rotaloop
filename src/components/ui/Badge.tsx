import { Shield, UserRound, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';

import { Text } from './Text';

const tones = {
  admin: { bg: 'primaryTint', fg: 'primary' },
  neutral: { bg: 'neutralTint', fg: 'textSecondary' },
  warning: { bg: 'warningTint', fg: 'warningText' },
} as const satisfies Record<string, { bg: keyof ColorTokens; fg: keyof ColorTokens }>;

export type BadgeProps = {
  label: string;
  tone?: keyof typeof tones;
  icon?: LucideIcon | null;
};

/** A small 22px pill: "Admin", "Member", "Not joined yet" (prototype `.pill.admin`). */
export function Badge({ label, tone = 'neutral', icon }: BadgeProps) {
  const { colors, radii, fonts } = useTheme();
  const t = tones[tone];
  const Icon = icon === undefined ? (tone === 'admin' ? Shield : null) : icon;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        minHeight: 22,
        paddingLeft: Icon ? 6 : 8,
        paddingRight: 8,
        borderRadius: radii.pill,
        backgroundColor: colors[t.bg],
      }}>
      {Icon ? <Icon size={13} color={colors[t.fg]} strokeWidth={2} /> : null}
      <Text variant="caption" style={{ fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, color: colors[t.fg] }}>
        {label}
      </Text>
    </View>
  );
}

/** Round initials avatar (40px), or a person icon for a Placeholder. */
export function Avatar({ initials, placeholder }: { initials: string; placeholder?: boolean }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: placeholder ? colors.surfaceAlt : colors.primaryTint,
        borderWidth: placeholder ? 1.5 : 0,
        borderStyle: 'dashed',
        borderColor: colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {placeholder ? (
        <UserRound size={20} color={colors.textSecondary} strokeWidth={1.75} />
      ) : (
        <Text variant="subhead" style={{ fontFamily: fonts.extrabold, color: colors.primary }}>
          {initials}
        </Text>
      )}
    </View>
  );
}
