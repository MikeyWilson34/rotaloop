import { CircleAlert, Info, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';

import { Text } from './Text';

const tones: Record<
  'error' | 'info',
  { icon: LucideIcon; bg: keyof ColorTokens; fg: keyof ColorTokens }
> = {
  error: { icon: CircleAlert, bg: 'dangerTint', fg: 'dangerText' },
  info: { icon: Info, bg: 'primaryTint', fg: 'primary' },
};

/** An inline message box: errors in plain words, or a short informational note. */
export function Notice({ tone = 'error', children }: { tone?: 'error' | 'info'; children: string }) {
  const { colors, radii, space } = useTheme();
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        gap: space.sm,
        alignItems: 'flex-start',
        padding: space.md,
        borderRadius: radii.md,
        backgroundColor: colors[t.bg],
      }}>
      <Icon size={20} color={colors[t.fg]} strokeWidth={1.75} />
      <Text variant="subhead" color={tone === 'error' ? t.fg : 'text'} style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}
