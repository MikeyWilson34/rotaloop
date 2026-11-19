import { router } from 'expo-router';
import { ChevronRight, CircleAlert, CircleCheck, Repeat } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { Text } from '@/components/ui';
import type { GroupCardView, TurnView } from '@/home/home';
import { dayOfMonth, monthAbbrev } from '@/schedule/format';
import { useTheme } from '@/theme';

/** A white list card (prototype `.list`). */
function ListCard({ children }: { children: React.ReactNode }) {
  const { colors, radii, shadows } = useTheme();
  return (
    <View style={{ borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, boxShadow: shadows.shadow1, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

function DateBox({ date }: { date: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ width: 48, borderRadius: 12, backgroundColor: colors.surfaceAlt, paddingVertical: 5, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, lineHeight: 14, letterSpacing: 0.66, color: colors.textSecondary }}>
        {monthAbbrev(date).toUpperCase()}
      </Text>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 24 }}>{String(dayOfMonth(date))}</Text>
    </View>
  );
}

function TurnPill({ turn }: { turn: TurnView }) {
  const { colors, fonts, radii } = useTheme();
  if (!turn.needsCover && !turn.covering) return null;
  const bad = turn.needsCover;
  const fg = bad ? colors.dangerText : colors.primary;
  const Icon = bad ? CircleAlert : Repeat;
  const label = bad ? 'Needs cover' : 'Covering';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 24,
        paddingHorizontal: 8,
        borderRadius: radii.pill,
        backgroundColor: bad ? colors.dangerTint : colors.primaryTint,
      }}>
      <Icon size={14} color={fg} strokeWidth={2.25} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: fg }}>{label}</Text>
    </View>
  );
}

/** "This week": the viewer's other turns in the next 7 days (prototype `.list` of `.li`). */
export function ThisWeekList({ turns, onOpen }: { turns: TurnView[]; onOpen: (turn: TurnView) => void }) {
  const { colors, fonts } = useTheme();
  return (
    <ListCard>
      {turns.map((t, i) => (
        <Pressable
          key={t.key}
          accessibilityRole="button"
          accessibilityLabel={`${t.responsibilityName}, ${t.groupName}. ${t.dayLabel}, ${t.timeLabel}.${t.needsCover ? ' Needs cover.' : t.covering ? ' Covering.' : ''}`}
          onPress={() => onOpen(t)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 64,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: colors.border,
            backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
          })}>
          <DateBox date={t.date} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 }}>
              {t.responsibilityName}
            </Text>
            <Text numberOfLines={1} variant="caption" color="textSecondary" style={{ fontSize: 13, lineHeight: 18 }}>
              {`${t.groupName} · ${t.timeLabel}`}
            </Text>
          </View>
          <TurnPill turn={t} />
        </Pressable>
      ))}
    </ListCard>
  );
}

/** Nothing due in the next 7 days (prototype `.calm`): names the next turn. */
export function NothingThisWeek({ nextTurn }: { nextTurn: string | null }) {
  const { colors, fonts, radii, shadows } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Nothing this week. ${nextTurn ? `Your next turn: ${nextTurn}.` : 'No turns coming up.'}`}
      style={{
        paddingVertical: 28,
        paddingHorizontal: 20,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        alignItems: 'center',
      }}>
      <View style={{ width: 48, height: 48, borderRadius: 16, marginBottom: 12, backgroundColor: colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
        <CircleCheck size={24} color={colors.successText} strokeWidth={1.75} />
      </View>
      <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, textAlign: 'center' }}>Nothing this week</Text>
      <Text variant="subhead" color="textSecondary" style={{ textAlign: 'center', marginTop: 2 }}>
        {nextTurn ? `Your next turn: ${nextTurn}` : 'No turns coming up.'}
      </Text>
    </View>
  );
}

/** "Your groups": one tappable card per group, with the viewer's next turn there. */
export function HomeGroupCard({ card }: { card: GroupCardView }) {
  const { colors, fonts, radii, shadows } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.name}. ${card.line}.`}
      accessibilityHint="Opens the group"
      onPress={() => router.push({ pathname: '/group/[groupId]', params: { groupId: card.groupId } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 72,
        padding: 14,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}>
      <GroupTile groupId={card.groupId} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 }}>
          {card.name}
        </Text>
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>
          {card.line}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}
