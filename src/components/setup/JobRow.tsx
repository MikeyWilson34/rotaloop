import { ChevronDown, X } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui';
import { JOB_TYPE_OPTIONS, jobTimeText, repeatText, type JobDraft, type JobType } from '@/lib/groupCreate';
import { useTheme } from '@/theme';

/**
 * One Job as a sentence (prototype `jobRow`): `[Greeter] · [every Sunday ▾] · [10:00am]`, with
 * a small `Take turns | Headcount` toggle. Used by group setup and (later) to edit a Job.
 */
export function JobRow({
  job,
  index,
  onChange,
  onPickRepeat,
  onPickTime,
  onRemove,
  autoFocus,
}: {
  job: JobDraft;
  index: number;
  onChange: (job: JobDraft) => void;
  onPickRepeat: () => void;
  onPickTime: () => void;
  /** Shown when the row can be removed. */
  onRemove?: () => void;
  autoFocus?: boolean;
}) {
  const { colors, radii, space, typography, fonts, minTapTarget } = useTheme();
  const label = job.name.trim() || `Job ${index + 1}`;
  const hint = JOB_TYPE_OPTIONS.find((o) => o.value === job.type)?.hint ?? '';

  return (
    <View
      style={{
        padding: space.md,
        gap: space.sm,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <TextInput
          accessibilityLabel={`Job ${index + 1} name`}
          value={job.name}
          onChangeText={(name) => onChange({ ...job, name })}
          placeholder="Job name"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="words"
          autoFocus={autoFocus}
          maxLength={80}
          returnKeyType="done"
          style={[
            typography.body,
            {
              flexGrow: 1,
              flexBasis: 140,
              minHeight: minTapTarget,
              paddingHorizontal: 12,
              borderRadius: radii.md,
              borderWidth: 1.5,
              borderColor: colors.borderStrong,
              backgroundColor: colors.surfaceAlt,
              color: colors.text,
              fontFamily: fonts.bold,
            },
          ]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Select
            label={repeatText(job.repeat)}
            accessibilityLabel={`${label}: how often, ${repeatText(job.repeat)}`}
            onPress={onPickRepeat}
            chevron
          />
          <Text color="textTertiary" aria-hidden>
            ·
          </Text>
          <Select
            label={jobTimeText(job.time)}
            accessibilityLabel={`${label}: time, ${jobTimeText(job.time)}`}
            onPress={onPickTime}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`${label}: job type`}
          style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radii.pill, padding: 3 }}>
          {JOB_TYPE_OPTIONS.map((o) => (
            <TypeOption
              key={o.value}
              label={o.label}
              selected={job.type === o.value}
              onPress={() => onChange({ ...job, type: o.value as JobType })}
            />
          ))}
        </View>
        <View style={{ flex: 1 }} />
        {onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
            onPress={onRemove}
            style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      <Text variant="subhead" color="textSecondary">
        {hint}
      </Text>
    </View>
  );
}

function Select({
  label,
  accessibilityLabel,
  onPress,
  chevron,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  chevron?: boolean;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        minHeight: 44,
        paddingHorizontal: 10,
        borderRadius: radii.md,
        backgroundColor: pressed ? colors.primaryTint : 'transparent',
      })}>
      <Text style={{ fontFamily: fonts.bold, color: colors.primary }}>{label}</Text>
      {chevron ? <ChevronDown size={16} color={colors.primary} strokeWidth={2.25} /> : null}
    </Pressable>
  );
}

function TypeOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors, radii, fonts, shadows, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={{
        minHeight: 36,
        paddingHorizontal: 12,
        justifyContent: 'center',
        borderRadius: radii.pill,
        backgroundColor: selected ? (scheme === 'dark' ? colors.border : colors.surface) : 'transparent',
        boxShadow: selected ? shadows.shadow1 : undefined,
      }}>
      <Text variant="caption" style={{ fontFamily: fonts.bold, color: selected ? colors.text : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}
