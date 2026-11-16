import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type TextFieldProps = TextInputProps & {
  label: string;
  /** Shown under the field in the danger colour; also marks the field invalid. */
  error?: string | null;
  /** Shown under the field when there's no error. */
  hint?: string;
  /** Marks the field invalid without a message under it (when the message is shown elsewhere). */
  invalid?: boolean;
};

/** A labelled text input (prototype `.field-label` + input): 52px tall, inset fill, 16px text. */
export function TextField({
  label,
  error,
  hint,
  invalid,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const { colors, radii, space, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  const isInvalid = !!error || !!invalid;
  const borderColor = isInvalid ? colors.dangerText : focused ? colors.primary : colors.borderStrong;
  return (
    <View style={{ gap: space.sm }}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        accessibilityLabel={label}
        aria-invalid={isInvalid}
        placeholderTextColor={colors.textTertiary}
        allowFontScaling
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          typography.body,
          {
            minHeight: 52,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: radii.md,
            borderWidth: 1.5,
            borderColor,
            backgroundColor: colors.surfaceAlt,
            color: colors.text,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="subhead" color="dangerText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="subhead" color="textSecondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A small bold section label (prototype `.field-label`): above fields, chip rows and lists. */
export function FieldLabel({ children }: { children: string }) {
  const { fonts } = useTheme();
  return (
    <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.extrabold }}>
      {children}
    </Text>
  );
}
