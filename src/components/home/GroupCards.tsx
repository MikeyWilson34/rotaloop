import { router } from 'expo-router';
import { CalendarX, CircleAlert, Clock, Repeat, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { GroupTile } from '@/components/group/GroupTile';
import { Badge, StatusPill, Text } from '@/components/ui';
import { skipDatesLabel, type GroupCardView } from '@/home/home';
import { useTheme, type ColorTokens } from '@/theme';

function openGroup(groupId: string) {
  router.push({ pathname: '/group/[groupId]', params: { groupId } });
}

function CardPress({ label, groupId, children, column }: { label: string; groupId: string; children: React.ReactNode; column?: boolean }) {
  const { colors, radii, shadows } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the group"
      onPress={() => openGroup(groupId)}
      style={({ pressed }) => ({
        flexDirection: column ? 'column' : 'row',
        alignItems: column ? 'stretch' : 'center',
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
      {children}
    </Pressable>
  );
}

/** A Member's card (prototype `groupCard`): no group-level health, only their own next turn. */
export function MemberGroupCard({ card }: { card: GroupCardView }) {
  const { fonts } = useTheme();
  const mine = card.myNext;
  return (
    <CardPress groupId={card.groupId} label={`${card.name}. ${card.nextLine}. ${mine ? mine.label : 'No turns soon'}.`}>
      <GroupTile groupId={card.groupId} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 22 }}>
          {card.name}
        </Text>
        <Text variant="subhead" color="textSecondary" numberOfLines={1}>
          {card.nextLine}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        {mine ? (
          <>
            <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.bold, fontSize: 12 }}>
              {mine.label}
            </Text>
            <StatusPill status={mine.status} label={mine.pillLabel ?? undefined} />
          </>
        ) : (
          <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.bold, fontSize: 12 }}>
            No turns soon
          </Text>
        )}
      </View>
    </CardPress>
  );
}

type StatTone = 'bad' | 'warn' | 'info' | null;
const STAT_TONES: Record<Exclude<StatTone, null>, { bg: keyof ColorTokens; fg: keyof ColorTokens }> = {
  bad: { bg: 'dangerTint', fg: 'dangerText' },
  warn: { bg: 'warningTint', fg: 'warningText' },
  info: { bg: 'primaryTint', fg: 'primary' },
};

function Stat({ icon: Icon, tone, children, label }: { icon: LucideIcon; tone: StatTone; children: React.ReactNode; label: string }) {
  const { colors } = useTheme();
  const t = tone ? STAT_TONES[tone] : null;
  const fg = t ? colors[t.fg] : colors.textSecondary;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        minHeight: 40,
        borderRadius: 10,
        backgroundColor: t ? colors[t.bg] : colors.surfaceAlt,
      }}>
      <Icon size={16} color={fg} strokeWidth={1.75} />
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: fg }}>{children}</Text>
    </View>
  );
}

/** A managed Group's card (prototype `managedCard`): identity plus the Admin-only health stats. */
export function ManagedGroupCard({ card }: { card: GroupCardView }) {
  const { colors, fonts } = useTheme();
  const h = card.health!;
  const b = (n: number | string, tone: StatTone) => (
    <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, color: tone ? colors[STAT_TONES[tone].fg] : colors.text }}>{String(n)}</Text>
  );
  const bold = { fontFamily: fonts.bold } as const;
  const openTone: StatTone = h.openCoverage ? 'bad' : null;
  const pendingTone: StatTone = h.pendingSoon ? 'warn' : null;
  const changeTone: StatTone = h.recentChanges ? 'info' : null;
  const skip = skipDatesLabel(h.skipDates);
  return (
    <CardPress groupId={card.groupId} column label={`${card.name}. You're an Admin. ${card.nextLine}.`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <GroupTile groupId={card.groupId} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.extrabold, fontSize: 16, lineHeight: 22 }}>
            {card.name}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
            {card.nextLine}
          </Text>
        </View>
        <Badge label="Admin" tone="admin" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Stat
          icon={CircleAlert}
          tone={openTone}
          label={`${h.openCoverage} open coverage${h.findingReplacement ? `, ${h.findingReplacement} finding a replacement` : ''}`}>
          {b(h.openCoverage, openTone)}
          <Text style={bold}>{' open coverage'}</Text>
          {h.findingReplacement ? <Text style={{ fontFamily: fonts.semibold }}>{` (${h.findingReplacement} finding a replacement)`}</Text> : null}
        </Stat>
        <Stat icon={Clock} tone={pendingTone} label={`${h.pendingSoon} pending in the next 3 weeks`}>
          {b(h.pendingSoon, pendingTone)}
          <Text style={bold}>{' pending · 3 wks'}</Text>
        </Stat>
        <Stat icon={Repeat} tone={changeTone} label={`${h.recentChanges} recent changes`}>
          {b(h.recentChanges, changeTone)}
          <Text style={bold}>{` recent ${h.recentChanges === 1 ? 'change' : 'changes'}`}</Text>
        </Stat>
        <Stat icon={CalendarX} tone={null} label={skip}>
          {h.skipDates.length ? (
            <>
              <Text style={bold}>{'Skip '}</Text>
              <Text style={{ fontFamily: fonts.extrabold, color: colors.text }}>{skip.slice('Skip '.length)}</Text>
            </>
          ) : (
            <Text style={bold}>{skip}</Text>
          )}
        </Stat>
      </View>
    </CardPress>
  );
}
