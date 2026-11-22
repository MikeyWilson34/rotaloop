import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'positive' | 'quiet' | 'quietDanger' | 'destructive';
export type ButtonSize = 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  /** `md` is 48px tall (default), `lg` is 56px (hero and sheet actions). */
  size?: ButtonSize;
  /** Shows a spinner and blocks presses while an action is in flight. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

const variantColors: Record<
  ButtonVariant,
  { bg?: keyof ColorTokens; fg: keyof ColorTokens; border?: keyof ColorTokens }
> = {
  primary: { bg: 'primary', fg: 'onPrimary' },
  positive: { bg: 'success', fg: 'onPrimary' },
  secondary: { bg: 'surface', fg: 'text', border: 'borderStrong' },
  quiet: { fg: 'primary' },
  quietDanger: { fg: 'danger' },
  destructive: { bg: 'danger', fg: 'onPrimary' },
};

const sizes = {
  md: { height: 48, paddingHorizontal: 16, fontSize: 15 },
  lg: { height: 56, paddingHorizontal: 20, fontSize: 16 },
} as const;

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
  ...rest
}: ButtonProps) {
  const { colors, radii, fonts } = useTheme();
  const v = variantColors[variant];
  const s = sizes[size];
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive}
      style={({ pressed }) => [
        {
          height: s.height,
          paddingHorizontal: s.paddingHorizontal,
          borderRadius: radii.md,
          backgroundColor: v.bg ? colors[v.bg] : 'transparent',
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border ? colors[v.border] : undefined,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          // Approximates the design's "8% darker" pressed state.
          filter: pressed ? 'brightness(0.92)' : undefined,
        },
        style,
      ]}
      {...rest}>
      <View style={{ opacity: loading ? 0 : 1 }}>
        <Text
          variant="callout"
          style={{ color: colors[v.fg], fontFamily: fonts.bold, fontSize: s.fontSize }}
          numberOfLines={1}>
          {label}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors[v.fg]} style={{ position: 'absolute' }} />
      ) : null}
    </Pressable>
  );
}
