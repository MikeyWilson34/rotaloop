import { Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { Text } from './Text';

export type ChoiceOption<T extends string> = { value: T; label: string; description?: string };

/** A bottom sheet with one-of-several options (radio rows with descriptions). */
export function ChoiceSheet<T extends string>({
  visible,
  title,
  message,
  options,
  value,
  onPick,
  onClose,
  busy,
  error,
}: {
  visible: boolean;
  title: string;
  message?: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onPick: (value: T) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const { colors, radii, space, fonts } = useTheme();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      message={message}
      busy={busy}
      footer={<Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />}>
      <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected, disabled: !!busy }}
              aria-checked={selected}
              accessibilityLabel={o.label}
              accessibilityHint={o.description}
              disabled={busy}
              onPress={() => onPick(o.value)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                minHeight: 56,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderRadius: radii.lg,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
                opacity: busy && !selected ? 0.55 : 1,
              })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" style={{ fontFamily: fonts.bold }}>
                  {o.label}
                </Text>
                {o.description ? (
                  <Text variant="subhead" color="textSecondary">
                    {o.description}
                  </Text>
                ) : null}
              </View>
              {selected ? <Check size={22} color={colors.primary} strokeWidth={2} /> : null}
            </Pressable>
          );
        })}
      </View>
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
