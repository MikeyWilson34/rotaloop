import { Check, CalendarCheck } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { displayStatuses, Text } from '@/components/ui';
import type { HeroView } from '@/home/home';
import { useTheme } from '@/theme';

/** Colours on the navy card (prototype `--on-navy-2`, `--hero-*`), the same in both schemes. */
const HERO = {
  text2: '#C7D0DD',
  raise: 'rgba(255,255,255,0.10)',
  confirm: '#86BC95',
  onConfirm: '#10213A',
  amber: '#F2C46D',
  sage: '#A9D4B3',
  red: '#F2A196',
  glass: 'rgba(255,255,255,0.12)',
};

const pillIconColor = (status: HeroView['status']) =>
  status === 'pending' ? HERO.amber : status === 'confirmed' ? HERO.sage : status === 'scheduled' ? HERO.text2 : HERO.red;

function HeroPill({ status, label }: { status: HeroView['status']; label: string | null }) {
  const { fonts } = useTheme();
  const s = displayStatuses[status];
  const Icon = s.icon;
  return (
    <View
      accessible
      accessibilityLabel={label ?? s.label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: HERO.glass }}>
      <Icon size={15} color={pillIconColor(status)} strokeWidth={2} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: '#FFFFFF' }}>{label ?? s.label}</Text>
    </View>
  );
}

function SmallAvatar({ initials, index }: { initials: string; index: number }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        marginLeft: index === 0 ? 0 : -8,
        borderWidth: 2,
        borderColor: colors.navy,
        backgroundColor: '#DCE6F2',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, lineHeight: 12, color: '#1F2D45' }}>{initials}</Text>
    </View>
  );
}

export type HeroProps = {
  hero: HeroView;
  busy: boolean;
  onOpen: () => void;
  onConfirm: () => void;
  onDecline: () => void;
};

/** "Your next Assignment" (prototype `heroCard`): the navy card at the top of Home. */
export function Hero({ hero, busy, onOpen, onConfirm, onDecline }: HeroProps) {
  const { colors, fonts, radii, shadows, scheme } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel="Your next Assignment"
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
        style={{
          position: 'absolute',
          right: -60,
          top: -60,
          width: 200,
          height: 200,
          borderRadius: 100,
          backgroundColor: 'rgba(134,174,219,0.14)',
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="overline" style={{ color: HERO.text2, flexShrink: 1 }}>
          {`Next up · ${hero.relative}`}
        </Text>
        <HeroPill status={hero.status} label={hero.pillLabel} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the Assignment"
        accessibilityLabel={`${hero.responsibilityName}, ${hero.groupName}. ${hero.dateLabel}, ${hero.timeLabel}.`}
        onPress={onOpen}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        {hero.makeUpTurn ? (
          <Text style={{ marginTop: 14, fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.3, color: HERO.amber }}>MAKE-UP TURN</Text>
        ) : null}
        <Text
          style={{
            fontFamily: fonts.extrabold,
            fontSize: 30,
            lineHeight: 36,
            letterSpacing: -0.3,
            color: '#FFFFFF',
            marginTop: hero.makeUpTurn ? 2 : 14,
            marginBottom: 2,
          }}>
          {hero.responsibilityName}
        </Text>
        <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: '#FFFFFF' }}>{hero.dateLabel}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: HERO.text2, marginTop: 2, fontFamily: fonts.regular }}>{hero.timeLabel}</Text>
        {hero.notes.map((note) => (
          <Text key={note} style={{ fontSize: 14, lineHeight: 20, color: HERO.amber, marginTop: 6, fontFamily: fonts.semibold }}>
            {note}
          </Text>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <GroupTile groupId={hero.groupId} size={28} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.bold, fontSize: 14, color: HERO.text2 }}>
            {hero.groupName}
          </Text>
        </View>
        {hero.withLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <View style={{ flexDirection: 'row' }}>
              {hero.with.slice(0, 3).map((p, i) => (
                <SmallAvatar key={`${p.name}-${i}`} initials={p.initials} index={i} />
              ))}
            </View>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: HERO.text2, fontFamily: fonts.regular }}>
              {hero.withLabel}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {hero.mode === 'confirm' ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
          <HeroButton label="Confirm" icon onPress={onConfirm} busy={busy} primary />
          <HeroButton label="Can't make it" onPress={onDecline} busy={false} disabled={busy} />
        </View>
      ) : (
        <View
          style={{
            marginTop: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: 'rgba(255,255,255,0.08)',
            borderRadius: 14,
            paddingVertical: 8,
            paddingLeft: 14,
            paddingRight: 4,
          }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: HERO.confirm, alignItems: 'center', justifyContent: 'center' }}>
            {hero.mode === 'later' ? (
              <CalendarCheck size={17} color={HERO.onConfirm} strokeWidth={2.25} />
            ) : (
              <Check size={18} color={HERO.onConfirm} strokeWidth={2.5} />
            )}
          </View>
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: '#FFFFFF', fontFamily: fonts.semibold }}>{hero.doneText}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Details"
            onPress={onOpen}
            style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' }}>Details</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function HeroButton({
  label,
  onPress,
  busy,
  primary,
  icon,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  primary?: boolean;
  icon?: boolean;
  disabled?: boolean;
}) {
  const { fonts, radii } = useTheme();
  const fg = primary ? HERO.onConfirm : '#FFFFFF';
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
        backgroundColor: primary ? HERO.confirm : '#2F4363',
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

/** No upcoming Assignments (prototype `.hero-empty`). */
export function HeroEmpty({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  const { colors, fonts, radii, shadows } = useTheme();
  return (
    <View
      style={{
        padding: 24,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        alignItems: 'center',
        gap: 4,
      }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 24, textAlign: 'center' }}>{title}</Text>
      <Text variant="subhead" color="textSecondary" style={{ textAlign: 'center' }}>
        {text}
      </Text>
      {children ? <View style={{ marginTop: 12, alignSelf: 'stretch' }}>{children}</View> : null}
    </View>
  );
}
