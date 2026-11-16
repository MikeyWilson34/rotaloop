import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { StatusPill, Text } from '@/components/ui';
import { formatDayShort, formatTimeIn, groupZoneNote, relativeDay } from '@/schedule/format';
import { skipDateText } from '@/schedule/skipDate';
import { displayStatusLabel, type EventView, type SlotView } from '@/schedule/views';
import { useTheme } from '@/theme';

import { DateBox, GroupDot, Hatch, openAssignment, StatusDot } from './parts';

/** The surface card frame used by every schedule card. */
function CardFrame({ children, padding = 14 }: { children: React.ReactNode; padding?: number }) {
  const { colors, radii, shadows } = useTheme();
  return (
    <View
      style={{
        padding,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
      }}>
      {children}
    </View>
  );
}

/** A small `primaryTint` tag, e.g. "Make-up Turn". */
export function Tag({ label }: { label: string }) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 7,
        minHeight: 20,
        justifyContent: 'center',
        borderRadius: radii.sm - 2,
        backgroundColor: colors.primaryTint,
      }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, lineHeight: 16, color: colors.primary, letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
}

/** "9:00 AM", plus "10:00 AM Chicago time" when the Group's clock reads differently. */
export function eventTimeText(startsAt: string, groupTimeZone: string, viewerTimeZone: string): string {
  const note = groupZoneNote(startsAt, groupTimeZone, viewerTimeZone);
  return `${formatTimeIn(startsAt, viewerTimeZone)}${note ? ` (${note})` : ''}`;
}

/** The pill for one of the viewer's own Assignments: "Covering" when they cover someone. */
function myPill(slot: SlotView) {
  if (slot.covering) return <StatusPill status="covered" label="Covering" />;
  return <StatusPill status={slot.status} />;
}

/** One of the viewer's Assignments (prototype `mySlotCard`). Opens its details. */
export function MySlotCard({ event, slot, viewerTimeZone }: { event: EventView; slot: SlotView; viewerTimeZone: string }) {
  const { colors, fonts, radii, shadows, space } = useTheme();
  const time = eventTimeText(event.startsAt, event.groupTimeZone, viewerTimeZone);
  const label = [
    slot.makeUpTurn ? 'Make-up Turn.' : '',
    `${slot.responsibilityName}, ${event.groupName}.`,
    `${formatDayShort(event.date)}, ${time}.`,
    slot.covering ? 'Covering.' : `${displayStatusLabel(slot.status)}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the Assignment"
      onPress={() => openAssignment(slot.groupId, slot.assignmentId)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        boxShadow: shadows.shadow1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}>
      <DateBox date={event.date} mine />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {slot.makeUpTurn ? <Tag label="Make-up Turn" /> : null}
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 }}>
          {slot.responsibilityName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <GroupDot groupId={event.groupId} />
          <Text variant="subhead" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {event.groupName}
          </Text>
        </View>
        <Text variant="caption" color="textTertiary" numberOfLines={2}>
          {time}
        </Text>
        <View style={{ marginTop: space.xs }}>{myPill(slot)}</View>
      </View>
      <ChevronRight size={20} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}

/** One row of an Event (prototype `slotRow`): Responsibility, who (or "Open"), status dot. */
export function SlotRow({ slot }: { slot: SlotView }) {
  const { colors, fonts } = useTheme();
  const open = slot.who.kind === 'open';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${slot.responsibilityName}: ${slot.whoLabel}. ${displayStatusLabel(slot.status)}.`}
      accessibilityHint="Opens the Assignment"
      onPress={() => openAssignment(slot.groupId, slot.assignmentId)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text numberOfLines={1} style={{ width: 96, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.textSecondary }}>
        {slot.responsibilityName}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: fonts.bold,
          fontSize: 14,
          lineHeight: 20,
          color: open ? colors.dangerText : slot.mine ? colors.primary : colors.text,
        }}>
        {slot.makeUpTurn && !open ? `${slot.whoLabel} · Make-up Turn` : slot.whoLabel}
      </Text>
      <StatusDot status={slot.status} />
    </Pressable>
  );
}

/**
 * An Event with its rows. On the Schedule tab (`showGroup`) the header names the Group and
 * opens it; on the Group screen it shows the date and how far away it is.
 */
export function EventCard({
  event,
  viewerTimeZone,
  today,
  showGroup,
}: {
  event: EventView;
  viewerTimeZone: string;
  today: string;
  showGroup?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const time = eventTimeText(event.startsAt, event.groupTimeZone, viewerTimeZone);
  const header = (
    <>
      <DateBox date={event.date} mine={event.mine} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {showGroup ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <GroupDot groupId={event.groupId} />
            <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, flexShrink: 1 }}>
              {event.groupName}
            </Text>
          </View>
        ) : (
          <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 }}>
            {formatDayShort(event.date)}
          </Text>
        )}
        <Text variant="caption" color="textTertiary" numberOfLines={2}>
          {showGroup ? `${formatDayShort(event.date)} · ${time}` : `${relativeDay(event.date, today)} · ${time}`}
        </Text>
      </View>
    </>
  );
  return (
    <CardFrame>
      {showGroup ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${event.groupName}, ${formatDayShort(event.date)}, ${time}`}
          accessibilityHint="Opens the group"
          onPress={() =>
            router.push({ pathname: '/group/[groupId]', params: { groupId: event.groupId, tab: 'schedule' } })
          }
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.8 : 1 })}>
          {header}
          <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>{header}</View>
      )}
      <View style={{ marginTop: 6 }}>
        {event.slots.length ? (
          event.slots.map((s) => <SlotRow key={s.key} slot={s} />)
        ) : (
          <Text variant="subhead" color="textSecondary" style={{ paddingVertical: 8 }}>
            No Responsibilities at this Event.
          </Text>
        )}
      </View>
    </CardFrame>
  );
}

/** A Skip Date (prototype `skipCard`): dashed, hatched, struck date, who marked it. */
export function SkipCard({ event, showGroup = true }: { event: EventView; showGroup?: boolean }) {
  const { colors, fonts, radii, space } = useTheme();
  // The reason (ticket 10) and who marked it.
  const text = skipDateText(event.skipDate ?? { markedBy: null, reason: null });
  return (
    <View
      accessible
      accessibilityLabel={`Skip Date, ${formatDayShort(event.date)}${showGroup ? `, ${event.groupName}` : ''}. ${text}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: radii.lg,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.borderStrong,
        overflow: 'hidden',
      }}>
      <Hatch />
      <DateBox date={event.date} skipped />
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <StatusPill status="skipped" label="Skip Date" />
          <Text
            variant="caption"
            color="textSecondary"
            numberOfLines={1}
            style={{ fontFamily: fonts.bold, flexShrink: 1 }}>
            {showGroup ? event.groupName : formatDayShort(event.date)}
          </Text>
        </View>
        <Text variant="subhead" color="textSecondary">
          {text}
        </Text>
      </View>
    </View>
  );
}
