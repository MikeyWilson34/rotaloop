import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
};

/** A toggle chip: 40px visual, 48px hit area (design-system §7). */
export function Chip({ label, selected, onPress, disabled }: ChipProps) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      aria-checked={selected}
      aria-disabled={!!disabled}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: disabled ? 0.4 : 1 })}>
      <View
        style={{
          minHeight: 40,
          paddingHorizontal: 14,
          borderRadius: radii.pill,
          borderWidth: 1,
          borderColor: selected ? colors.chipOn : colors.borderStrong,
          backgroundColor: selected ? colors.chipOn : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text
          variant="subhead"
          style={{ fontFamily: fonts.bold, color: selected ? colors.onChipOn : colors.text }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** Wrapping row of chips. */
export function ChipGroup({ children }: { children: React.ReactNode }) {
  const { space } = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}
