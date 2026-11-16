import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';

const tones: Record<'info' | 'warn' | 'bad' | 'ok', { bg: keyof ColorTokens; fg: keyof ColorTokens }> = {
  info: { bg: 'primaryTint', fg: 'primary' },
  warn: { bg: 'warningTint', fg: 'warningText' },
  bad: { bg: 'dangerTint', fg: 'dangerText' },
  ok: { bg: 'successTint', fg: 'successText' },
};

/**
 * A tinted note with an icon and rich content (prototype `.note`, `.note.warn`): explanations
 * and previews. For plain error or info strings, use Notice.
 */
export function InfoNote({
  icon: Icon,
  tone = 'info',
  children,
}: {
  icon: LucideIcon;
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  const { colors, radii } = useTheme();
  const t = tones[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: radii.md,
        backgroundColor: colors[t.bg],
      }}>
      <Icon size={20} color={colors[t.fg]} strokeWidth={1.75} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 6 }}>{children}</View>
    </View>
  );
}
