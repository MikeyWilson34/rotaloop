import { Check, CircleAlert, CircleCheck } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { Text } from '@/components/ui';
import type { HeadcountReply } from '@/engine/types';
import type { HeroView } from '@/home/home';
import { useTheme } from '@/theme';

import { YesNoButtons } from './YesNo';

/** Colours on the navy card (prototype `--on-navy-2` and the note icons), the same in both schemes. */
const ON_NAVY_2 = '#C7D0DD';
const AMBER = '#F2C46D';
const SAGE = '#A9D4B3';
/** The prototype's thin inner ring that keeps filled buttons distinct on navy. */
const RING = 'inset 0 0 0 1.5px rgba(255,255,255,0.4)';

export type HeroProps = {
  hero: HeroView;
  /** An action on the card is being sent. */
  busy: boolean;
  onOpen: () => void;
  onCantMakeIt: () => void;
  onConfirm: () => void;
  onAnswer?: (answer: HeadcountReply) => void;
  /** Headcount: the answer being sent, if any. */
  answering?: HeadcountReply | null;
};

/** The big navy card at the top of Home (prototype `heroCard`): one main button. */
export function Hero({ hero, busy, onOpen, onCantMakeIt, onConfirm, onAnswer, answering = null }: HeroProps) {
  const { colors, fonts, radii, shadows, scheme } = useTheme();
  const headcount = hero.mode === 'headcount';
  const label = headcount ? 'Coming?' : 'Your next turn';
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={label}
      style={{
        backgroundColor: colors.navy,
        borderRadius: radii.xl,
        padding: 20,
        boxShadow: shadows.shadow2,
        borderWidth: scheme === 'dark' ? 1 : 0,
        borderColor: colors.border,
        overflow: 'hidden',
      }}>
      {/* The soft glow in the corner. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', right: -60, top: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(134,174,219,0.14)' }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the details"
        accessibilityLabel={`${hero.responsibilityName}, ${hero.groupName}. ${hero.dayLabel}, ${hero.timeLabel}. ${hero.relative}.`}
        onPress={onOpen}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <Text variant="overline" style={{ color: ON_NAVY_2 }}>
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <GroupTile groupId={hero.groupId} size={24} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.bold, fontSize: 14, color: ON_NAVY_2 }}>
            {hero.groupName}
          </Text>
        </View>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.3, color: colors.onNavy, marginTop: 4, marginBottom: 2 }}>
          {hero.responsibilityName}
        </Text>
        <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.onNavy }}>{`${hero.dayLabel} · ${hero.timeLabel}`}</Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: ON_NAVY_2, marginTop: 2 }}>{hero.relative}</Text>
        {headcount && hero.headcount ? (
          <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: ON_NAVY_2, marginTop: 10 }}>
            {`${hero.headcount.counts.coming} coming so far`}
          </Text>
        ) : null}
      </Pressable>

      {hero.note ? (
        <View
          style={{
            marginTop: 18,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            backgroundColor: 'rgba(255,255,255,0.08)',
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
          }}>
          {hero.note.tone === 'warn' ? (
            <CircleAlert size={20} color={AMBER} strokeWidth={2} />
          ) : (
            <CircleCheck size={20} color={SAGE} strokeWidth={2} />
          )}
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colors.onNavy, fontFamily: fonts.regular }}>
            {hero.note.strong ? <Text style={{ fontFamily: fonts.extrabold, color: colors.onNavy }}>{`${hero.note.strong} `}</Text> : null}
            {hero.note.text}
          </Text>
        </View>
      ) : null}

      {hero.mode === 'headcount' ? (
        <View style={{ marginTop: 22 }}>
          <YesNoButtons
            appearance="filled"
            value={hero.headcount?.answer ?? null}
            busy={answering}
            disabled={busy}
            onChange={(a) => onAnswer?.(a)}
          />
        </View>
      ) : hero.mode === 'confirm' ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <HeroButton label="Confirm" tone="success" icon onPress={onConfirm} busy={busy} />
          <HeroButton label="Can't make it" tone="danger" onPress={onCantMakeIt} busy={false} disabled={busy} />
        </View>
      ) : hero.mode === 'cantMakeIt' ? (
        <View style={{ flexDirection: 'row', marginTop: 22 }}>
          <HeroButton label="Can't make it" tone="danger" onPress={onCantMakeIt} busy={busy} />
        </View>
      ) : null}
    </View>
  );
}

function HeroButton({
  label,
  tone,
  onPress,
  busy,
  icon,
  disabled,
}: {
  label: string;
  tone: 'success' | 'danger';
  onPress: () => void;
  busy: boolean;
  icon?: boolean;
  disabled?: boolean;
}) {
  const { colors, fonts, radii } = useTheme();
  const fg = colors.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy || !!disabled, busy }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 56,
        borderRadius: radii.md,
        backgroundColor: tone === 'success' ? colors.success : colors.danger,
        boxShadow: RING,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: disabled ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Check size={20} color={fg} strokeWidth={2.25} /> : null}
          <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 16, color: fg }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
