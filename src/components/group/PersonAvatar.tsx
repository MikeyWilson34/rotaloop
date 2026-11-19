import { View } from 'react-native';

import { Text } from '@/components/ui';
import { initials } from '@/lib/validation';
import { useTheme } from '@/theme';

/**
 * Round initials avatar (prototype `.av`). A stand-in or someone from outside the group gets a
 * dashed outline: they aren't on the app. `size` 28 is the small one in "Coming up" rows.
 */
export function PersonAvatar({ name, dashed, size = 40 }: { name: string; dashed?: boolean; size?: number }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: dashed ? colors.surfaceAlt : colors.primaryTint,
        borderWidth: dashed ? 1.5 : 0,
        borderStyle: 'dashed',
        borderColor: colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text
        variant={size < 36 ? 'caption' : 'subhead'}
        style={{
          fontFamily: fonts.extrabold,
          color: dashed ? colors.textSecondary : colors.primary,
          fontSize: size < 36 ? 11 : undefined,
          lineHeight: size < 36 ? 14 : undefined,
        }}>
        {initials(name)}
      </Text>
    </View>
  );
}
