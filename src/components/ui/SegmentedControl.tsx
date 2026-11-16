import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type SegmentedControlProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/** Design system "Segmented control": `surfaceAlt` track, `surface` selected thumb. 48px tall. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const { colors, radii, fonts, shadows, scheme } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceAlt,
        borderRadius: radii.md,
        padding: 3,
        gap: 2,
      }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 42,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
              backgroundColor: selected ? (scheme === 'dark' ? colors.borderStrong : colors.surface) : 'transparent',
              boxShadow: selected ? shadows.shadow1 : undefined,
            }}
            hitSlop={{ top: 3, bottom: 3 }}>
            <Text
              variant="subhead"
              numberOfLines={1}
              style={{ fontFamily: fonts.bold, color: selected ? colors.text : colors.textSecondary }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
