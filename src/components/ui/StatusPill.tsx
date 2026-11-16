import {
  Calendar,
  CalendarX,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Repeat,
  type LucideIcon,
} from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme, type ColorTokens } from '@/theme';

import { Text } from './Text';

/** The display statuses from design-system.md section 2. Always shown as icon + label + colour. */
export type DisplayStatus =
  | 'confirmed'
  | 'pending'
  | 'declined'
  | 'needsCoverage'
  | 'covered'
  | 'skipped'
  | 'scheduled';

export const displayStatuses: Record<
  DisplayStatus,
  { label: string; icon: LucideIcon; bg: keyof ColorTokens; fg: keyof ColorTokens }
> = {
  confirmed: { label: 'Confirmed', icon: CircleCheck, bg: 'successTint', fg: 'successText' },
  pending: { label: 'Pending', icon: Clock, bg: 'warningTint', fg: 'warningText' },
  declined: { label: 'Declined', icon: CircleX, bg: 'dangerTint', fg: 'dangerText' },
  needsCoverage: {
    label: 'Needs coverage',
    icon: CircleAlert,
    bg: 'dangerTint',
    fg: 'dangerText',
  },
  covered: { label: 'Covered', icon: Repeat, bg: 'primaryTint', fg: 'primary' },
  skipped: { label: 'Skipped', icon: CalendarX, bg: 'neutralTint', fg: 'textSecondary' },
  scheduled: { label: 'Scheduled', icon: Calendar, bg: 'neutralTint', fg: 'textSecondary' },
};

export type StatusPillProps = {
  status: DisplayStatus;
  /** Overrides the default label, e.g. "Covered by Sam". */
  label?: string;
};

export function StatusPill({ status, label }: StatusPillProps) {
  const { colors, radii, space } = useTheme();
  const s = displayStatuses[status];
  const Icon = s.icon;
  return (
    <View
      accessible
      accessibilityLabel={label ?? s.label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: space.xs,
        minHeight: 24,
        paddingHorizontal: space.sm,
        borderRadius: radii.pill,
        backgroundColor: colors[s.bg],
      }}>
      <Icon size={14} color={colors[s.fg]} strokeWidth={2} />
      <Text variant="caption" color={s.fg}>
        {label ?? s.label}
      </Text>
    </View>
  );
}
