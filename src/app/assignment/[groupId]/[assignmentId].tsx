import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, ChevronLeft, ChevronRight, Handshake } from 'lucide-react-native';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssignmentActions } from '@/components/assignment/AssignmentActions';
import { GroupTile } from '@/components/group/GroupTile';
import { eventTimeText, Tag } from '@/components/schedule/cards';
import { Timeline } from '@/components/schedule/history';
import { openAssignment } from '@/components/schedule/parts';
import { Button, Notice, StatusPill, Text } from '@/components/ui';
import { deviceTimeZone, myMember } from '@/lib/groupViews';
import { GROUP_GONE, useGroup, useSendBackIfDeleted } from '@/lib/groups';
import { useHistory } from '@/lib/schedule';
import { useSession } from '@/lib/session';
import { initials } from '@/lib/validation';
import { dateIn, formatDayLong, relativeDay } from '@/schedule/format';
import { assignmentHistory, movedNotice, type HistoryContext } from '@/schedule/history';
import { findSlot, type ScheduleGroup, type SlotView, type Who } from '@/schedule/views';
import { assignmentMakeUpNotices } from '@/schedule/workloadView';
import { useTheme } from '@/theme';

/**
 * A turn's details: the group, job, date and time, who does it (or covers it, or "Open"), its
 * status, the rest of that date, notices (moved, swapped turn) and its history. The cover flow
 * (Can't make it, I'll cover, Pick who's covering: simplify ticket 07) lives in
 * `AssignmentActions`. `?action=decline|markCovered` opens that sheet on arrival.
 */
export default function AssignmentScreen() {
  const { groupId, assignmentId, action } = useLocalSearchParams<{ groupId: string; assignmentId: string; action?: string }>();
  const { colors, space, minTapTarget, fonts } = useTheme();
  const { session } = useSession();
  const accountId = session?.user.id ?? null;
  const { data, loading, error, refresh, refreshing, reload, deleted } = useGroup(groupId);
  // The group was deleted (feedback-2 ticket 08): back to Groups with a plain message.
  useSendBackIfDeleted(groupId, deleted);
  const viewerTimeZone = deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dateIn(now, viewerTimeZone);

  const me = data ? myMember(data.state, accountId) : undefined;
  const group: ScheduleGroup | null = data
    ? { id: data.id, name: data.name, timeZone: data.timeZone, state: data.state, myMemberId: me?.id ?? null }
    : null;
  const found = group && assignmentId ? findSlot(group, assignmentId, now, viewerTimeZone) : null;
  const assignment = data?.state.assignments.find((a) => a.id === assignmentId);
  const history = useHistory(groupId, data?.stateVersion, {
    assignmentId,
    makeUpTurnId: assignment?.makeUpTurnId ?? null,
    limit: 50,
  });

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const navbar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={back}
        style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
        <ChevronLeft size={26} color={colors.text} strokeWidth={1.75} />
      </Pressable>
      <Text accessibilityRole="header" style={{ flex: 1, textAlign: 'center', fontFamily: fonts.extrabold, fontSize: 17 }}>
        Assignment
      </Text>
      <View style={{ width: minTapTarget }} />
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={{ paddingVertical: space.huge }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (error || !data || !group || !me) {
    body = (
      <View style={{ gap: space.md }}>
        <Notice>{error ?? GROUP_GONE}</Notice>
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  } else if (!found) {
    body = (
      <View style={{ gap: space.md }}>
        <Notice tone="info">{"This Assignment isn't on the schedule anymore. The schedule may have changed."}</Notice>
        <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
      </View>
    );
  } else {
    const { event, slot } = found;
    const ctx: HistoryContext = { state: data.state, myMemberId: me.id, timeZone: viewerTimeZone };
    const moved = history.entries ? movedNotice(history.entries, slot.assignmentId, ctx) : null;
    const makeUp = assignmentMakeUpNotices(data.state, slot.assignmentId, me.id, viewerTimeZone);
    const timeline = history.entries ? assignmentHistory(history.entries, slot.assignmentId, ctx) : [];
    const others = event.slots.filter((s) => s.assignmentId !== slot.assignmentId);
    const pillLabel = slot.covering ? "You're covering" : undefined;

    body = (
      <>
        <View
          style={{
            padding: space.xl,
            borderRadius: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            gap: space.xs,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <GroupTile groupId={group.id} size={32} />
            <Text variant="subhead" color="textSecondary" numberOfLines={1} style={{ flex: 1, fontFamily: fonts.bold }}>
              {group.name}
            </Text>
            <StatusPill status={slot.status} label={pillLabel} />
          </View>
          {slot.makeUpTurn ? (
            <View style={{ marginTop: space.md }}>
              <Tag label="Swapped turn" />
            </View>
          ) : null}
          <Text variant="title1" accessibilityRole="header" style={{ marginTop: slot.makeUpTurn ? space.xs : space.md }}>
            {slot.responsibilityName}
          </Text>
          <Text variant="bodyStrong">{formatDayLong(event.date)}</Text>
          <Text variant="subhead" color="textSecondary">
            {`${eventTimeText(event.startsAt, event.groupTimeZone, viewerTimeZone)} · ${relativeDay(event.date, today)}`}
          </Text>

          <View style={{ marginTop: space.md }}>
            <AssigneeRow slot={slot} />
          </View>

          {moved ? <InfoBox icon={CalendarClock} tone="warning" text={moved} /> : null}
          {makeUp.paying ? <InfoBox icon={Handshake} tone="primary" text={makeUp.paying} /> : null}
          {makeUp.created ? <InfoBox icon={Handshake} tone="primary" text={makeUp.created} /> : null}

          <AssignmentActions
            group={data}
            myMemberId={me.id}
            event={event}
            slot={slot}
            now={now}
            viewerTimeZone={viewerTimeZone}
            reload={reload}
            initialSheet={action}
          />
        </View>

        <View style={{ gap: space.md }}>
          <Text variant="title3" accessibilityRole="header">
            Also at this Event
          </Text>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }}>
            {others.length ? (
              others.map((o, i) => <OtherRow key={o.key} slot={o} first={i === 0} />)
            ) : (
              <Text color="textSecondary" style={{ padding: space.lg, textAlign: 'center' }}>
                Just this job
              </Text>
            )}
          </View>
        </View>

        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text variant="title3" accessibilityRole="header">
              History
            </Text>
            <Text variant="caption" color="textTertiary" style={{ fontFamily: fonts.bold }}>
              Visible to all Members
            </Text>
          </View>
          {history.error ? (
            <Notice>{history.error}</Notice>
          ) : history.loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : timeline.length ? (
            <Timeline items={timeline} now={now} timeZone={viewerTimeZone} />
          ) : (
            <Text color="textSecondary">No history yet.</Text>
          )}
        </View>
      </>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {navbar}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.huge, gap: space.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function WhoAvatar({ who }: { who: Who }) {
  const { colors, fonts } = useTheme();
  const open = who.kind === 'open';
  const label = who.kind === 'open' ? '?' : initials(who.name);
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: open ? colors.dangerTint : who.kind === 'guest' ? colors.surfaceAlt : colors.primaryTint,
      }}>
      <Text
        variant="subhead"
        style={{ fontFamily: fonts.extrabold, color: open ? colors.dangerText : who.kind === 'guest' ? colors.textSecondary : colors.primary }}>
        {label}
      </Text>
    </View>
  );
}

function AssigneeRow({ slot }: { slot: SlotView }) {
  const { fonts, space } = useTheme();
  const covered = slot.coveredFor !== null;
  const key = covered ? 'Covered by' : 'Assigned to';
  const aside = covered ? `for ${slot.coveredFor}` : slot.who.kind === 'open' && slot.requestedBy ? `was ${slot.requestedBy}` : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <WhoAvatar who={slot.who} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.bold }}>
          {key}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
          {slot.whoLabel}
        </Text>
      </View>
      {aside ? (
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {aside}
        </Text>
      ) : null}
    </View>
  );
}

function OtherRow({ slot, first }: { slot: SlotView; first: boolean }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${slot.responsibilityName}: ${slot.whoLabel}`}
      accessibilityHint="Opens the Assignment"
      onPress={() => openAssignment(slot.groupId, slot.assignmentId)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minHeight: 64,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        opacity: pressed ? 0.85 : 1,
      })}>
      <WhoAvatar who={slot.who} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold, color: slot.who.kind === 'open' ? colors.dangerText : colors.text }}>
          {slot.whoLabel}
        </Text>
        <Text variant="subhead" color="textSecondary" numberOfLines={1}>
          {slot.responsibilityName}
        </Text>
      </View>
      <StatusPill status={slot.status} />
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}

function InfoBox({
  icon: Icon,
  tone,
  text,
}: {
  icon: typeof Handshake;
  tone: 'primary' | 'warning' | 'danger';
  text: string;
}) {
  const { colors, radii, space } = useTheme();
  const bg = tone === 'primary' ? colors.primaryTint : tone === 'warning' ? colors.warningTint : colors.dangerTint;
  const fg = tone === 'primary' ? colors.primary : tone === 'warning' ? colors.warningText : colors.dangerText;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        padding: space.md,
        borderRadius: radii.md,
        backgroundColor: bg,
        marginTop: space.md,
      }}>
      <Icon size={20} color={fg} strokeWidth={1.75} />
      <Text variant="subhead" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
