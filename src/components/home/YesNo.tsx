import { Check, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import type { HeadcountReply } from '@/engine/types';
import { useTheme } from '@/theme';

/**
 * Headcount "Coming?" answers: green Yes / red No (spec "Button colours").
 * - `filled` (the Home card): both filled, with a thin inner ring so they hold up on navy.
 * - `choice` (a details sheet): the unselected answer is outlined in its colour, the selected
 *   one filled with a check or an X.
 */
export function YesNoButtons({
  value,
  onChange,
  appearance = 'choice',
  busy = null,
  disabled = false,
  who,
}: {
  value: HeadcountReply | null;
  onChange: (answer: HeadcountReply) => void;
  appearance?: 'filled' | 'choice';
  /** The answer being sent, if any (both buttons are disabled meanwhile). */
  busy?: HeadcountReply | null;
  disabled?: boolean;
  /** Answering for someone else: the buttons read "Yes for Pat" / "No for Pat". */
  who?: string;
}) {
  const off = disabled || busy !== null;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <AnswerButton answer="yes" who={who} selected={value === 'yes'} appearance={appearance} busy={busy === 'yes'} disabled={off} onPress={() => onChange('yes')} />
      <AnswerButton answer="no" who={who} selected={value === 'no'} appearance={appearance} busy={busy === 'no'} disabled={off} onPress={() => onChange('no')} />
    </View>
  );
}

function AnswerButton({
  answer,
  who,
  selected,
  appearance,
  busy,
  disabled,
  onPress,
}: {
  answer: HeadcountReply;
  who?: string;
  selected: boolean;
  appearance: 'filled' | 'choice';
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const yes = answer === 'yes';
  const fill = yes ? colors.success : colors.danger;
  const filled = appearance === 'filled' || selected;
  const fg = filled ? colors.onPrimary : yes ? colors.successText : colors.dangerText;
  const Icon = yes ? Check : X;
  const label = yes ? 'Yes' : 'No';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={who ? `${label} for ${who}` : label}
      accessibilityState={{ selected, disabled, busy }}
      aria-pressed={appearance === 'choice' ? selected : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 56,
        borderRadius: radii.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: filled ? fill : 'transparent',
        borderWidth: filled ? 0 : 2,
        borderColor: fill,
        boxShadow: appearance === 'filled' ? 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' : undefined,
        opacity: disabled && !busy ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {selected ? <Icon size={20} color={fg} strokeWidth={2.5} /> : null}
          <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: fg }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
