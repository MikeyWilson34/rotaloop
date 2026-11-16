import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { SettingsList } from './SettingsList';
import { Text } from './Text';

export type ReorderItem = { key: string; label: string; description?: string };

/**
 * An ordered list with numbered rows and 48px "Move up" / "Move down" buttons (works with a
 * keyboard, a screen reader and touch alike). Without `onMove` it is read-only.
 */
export function ReorderList({
  items,
  onMove,
  disabled,
  itemNoun = 'item',
}: {
  items: ReorderItem[];
  /** Move the item at `index` by `delta` (-1 up, +1 down). */
  onMove?: (index: number, delta: number) => void;
  disabled?: boolean;
  /** For screen readers: "Move Sam up" uses the label; the noun is used when there is none. */
  itemNoun?: string;
}) {
  const { colors, fonts, minTapTarget, radii } = useTheme();
  return (
    <SettingsList>
      {items.map((item, index) => (
        <View
          key={item.key}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 4, minHeight: 60 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: index === 0 ? colors.primaryTint : colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text variant="caption" color={index === 0 ? 'primary' : 'textSecondary'} style={{ fontFamily: fonts.extrabold }}>
              {String(index + 1)}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2, paddingVertical: 10 }}>
            <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
              {item.label}
            </Text>
            {item.description ? (
              <Text variant="caption" color="textSecondary">
                {item.description}
              </Text>
            ) : null}
          </View>
          {onMove
            ? ([
                [-1, ChevronUp, 'up'],
                [1, ChevronDown, 'down'],
              ] as const).map(([delta, Icon, word]) => {
                const blocked = disabled || (delta < 0 ? index === 0 : index === items.length - 1);
                return (
                  <Pressable
                    key={word}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${item.label || itemNoun} ${word}`}
                    accessibilityState={{ disabled: blocked }}
                    disabled={blocked}
                    onPress={() => onMove(index, delta)}
                    style={({ pressed }) => ({
                      width: minTapTarget,
                      height: minTapTarget,
                      borderRadius: radii.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: blocked ? 0.3 : 1,
                      backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                    })}>
                    <Icon size={22} color={colors.text} strokeWidth={1.75} />
                  </Pressable>
                );
              })
            : null}
        </View>
      ))}
    </SettingsList>
  );
}
