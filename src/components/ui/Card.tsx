import { View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme';

export type CardProps = ViewProps & {
  /** `hero` is the navy, extra-rounded, raised card used for the next Assignment. */
  variant?: 'default' | 'hero';
};

export function Card({ variant = 'default', style, ...rest }: CardProps) {
  const { colors, radii, space, shadows, scheme } = useTheme();
  const hero = variant === 'hero';
  return (
    <View
      style={[
        {
          backgroundColor: hero ? colors.navy : colors.surface,
          borderRadius: hero ? radii.xl : radii.lg,
          padding: hero ? space.xl : space.lg,
          boxShadow: hero ? shadows.shadow2 : shadows.shadow1,
          // Surface cards keep a hairline; in dark mode shadows are replaced by it.
          borderWidth: scheme === 'dark' || !hero ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
      {...rest}
    />
  );
}
