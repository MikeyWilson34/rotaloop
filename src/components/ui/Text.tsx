import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme, type ColorTokens, type TypeVariant } from '@/theme';

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  /** A colour token name. Defaults to `text`. */
  color?: keyof ColorTokens;
};

/** Themed text: applies a type-scale variant and a colour token. Font scaling stays on. */
export function Text({ variant = 'body', color = 'text', style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      allowFontScaling
      style={[theme.typography[variant], { color: theme.colors[color] }, style]}
      {...rest}
    />
  );
}
