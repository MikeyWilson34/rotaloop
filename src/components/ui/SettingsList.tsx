import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, Fragment, isValidElement } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';

import { Text } from './Text';

/** A rounded surface list whose rows are separated by hairlines (prototype `.list`). */
export function SettingsList({ children }: { children: React.ReactNode }) {
  const { colors, radii, shadows } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        overflow: 'hidden',
      }}>
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: colors.border }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** A 36px rounded square holding a 20px icon (prototype `.li-ic`). */
export function IconTile({
  icon: Icon,
  size = 36,
  bg = 'surfaceAlt',
  fg = 'textSecondary',
}: {
  icon: LucideIcon;
  size?: number;
  bg?: keyof ColorTokens;
  fg?: keyof ColorTokens;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: colors[bg],
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Icon size={Math.round(size * 0.56)} color={colors[fg]} strokeWidth={1.75} />
    </View>
  );
}

/** The 52×32 on/off switch from the prototype. Purely visual: the row handles the press. */
function SwitchVisual({ on }: { on: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 52,
        height: 32,
        borderRadius: 16,
        backgroundColor: on ? colors.success : colors.borderStrong,
        padding: 3,
        alignItems: on ? 'flex-end' : 'flex-start',
      }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: '#FFFFFF',
          boxShadow: '0px 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </View>
  );
}

type RowBaseProps = {
  icon: LucideIcon;
  label: string;
  description?: string;
  disabled?: boolean;
};

function RowText({ label, description }: { label: string; description?: string }) {
  const { fonts } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
        {label}
      </Text>
      {description ? (
        <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.regular }}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

const rowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingHorizontal: 16,
  paddingVertical: 12,
  minHeight: 60,
} as const;

/** A settings row with an on/off switch. The whole row is the tap target. */
export function SwitchRow({
  icon,
  label,
  description,
  value,
  onValueChange,
  disabled,
}: RowBaseProps & { value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      aria-checked={value}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [rowStyle, { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }]}>
      <IconTile icon={icon} />
      <RowText label={label} description={description} />
      <SwitchVisual on={value} />
    </Pressable>
  );
}

/** A settings row that shows a value (optional) and opens or cycles something when tapped. */
export function ValueRow({
  icon,
  label,
  description,
  value,
  onPress,
  disabled,
}: RowBaseProps & { value?: string; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityHint={description}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }]}>
      <IconTile icon={icon} />
      <RowText label={label} description={description} />
      {value ? (
        <Text variant="subhead" color="textSecondary" style={{ fontFamily: fonts.bold, maxWidth: '45%' }} numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}

/** A settings row that runs an action (no value), e.g. "Leave group". */
export function ActionRow({
  icon,
  label,
  description,
  onPress,
  disabled,
  destructive,
}: RowBaseProps & { onPress: () => void; destructive?: boolean }) {
  const { fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }]}>
      <IconTile icon={icon} bg={destructive ? 'dangerTint' : 'surfaceAlt'} fg={destructive ? 'dangerText' : 'textSecondary'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subhead" color={destructive ? 'dangerText' : 'text'} style={{ fontFamily: fonts.bold }}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.regular }}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A read-only settings row: a label with a value on the right or a description under it. */
export function InfoRow({ icon, label, description, value }: Omit<RowBaseProps, 'disabled'> & { value?: string }) {
  const { fonts } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value ?? description ?? ''}`} style={rowStyle}>
      <IconTile icon={icon} />
      <RowText label={label} description={description} />
      {value ? (
        <Text variant="subhead" color="textSecondary" style={{ fontFamily: fonts.bold }}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}
