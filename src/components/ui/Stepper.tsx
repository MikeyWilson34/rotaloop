import { Minus, Plus } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { FieldLabel } from './TextField';
import { Text } from './Text';

/** A labelled number with 48px minus / plus buttons (e.g. a Responsibility's headcount). */
export function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 50,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const { colors, radii, space, fonts, minTapTarget } = useTheme();
  const button = (delta: number) => {
    const blocked = disabled || (delta < 0 ? value <= min : value >= max);
    const Icon = delta < 0 ? Minus : Plus;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${delta < 0 ? 'Fewer' : 'More'}: ${label}`}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={() => onChange(Math.max(min, Math.min(max, value + delta)))}
        style={({ pressed }) => ({
          width: minTapTarget,
          height: minTapTarget,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: blocked ? 0.4 : 1,
        })}>
        <Icon size={22} color={colors.text} strokeWidth={1.75} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <FieldLabel>{label}</FieldLabel>
      <View
        accessible={false}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {button(-1)}
        <Text
          variant="title2"
          accessibilityLabel={`${label}: ${value}`}
          accessibilityLiveRegion="polite"
          style={{ minWidth: 40, textAlign: 'center', fontFamily: fonts.extrabold }}>
          {String(value)}
        </Text>
        {button(1)}
      </View>
      {error ? (
        <Text variant="subhead" color="dangerText">
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
