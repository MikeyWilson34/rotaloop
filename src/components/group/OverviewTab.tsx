import { Check, ChevronRight, ListChecks } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { eventTimeText, SlotRow } from '@/components/schedule/cards';
import { HistoryList } from '@/components/schedule/history';
import { SectionHeading } from '@/components/schedule/parts';
import { Button, Card, IconTile, Notice, Text } from '@/components/ui';
import { firstUnstaffedResponsibility, setupChecklist, type ChecklistKey } from '@/lib/groupSetup';
import { deviceTimeZone } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { scheduleGroupOf, useHistory } from '@/lib/schedule';
import { dateIn, formatDayLong, relativeDay } from '@/schedule/format';
import { historyLines } from '@/schedule/history';
import { nextEvent } from '@/schedule/views';
import { useTheme } from '@/theme';

import { openSeries } from './settings/EventsSection';
import { openResponsibility } from './settings/ResponsibilitiesSection';

const HISTORY_PAGE = 8;

/**
 * Overview: the guided first setup while the Group has no Responsibilities or no Event
 * Series; otherwise the next Event with who is serving. Below, the Group's schedule history,
 * which every Member can read.
 */
export function OverviewTab({
  group,
  accountId,
  isAdmin,
  onInvite,
}: {
  group: GroupDetails;
  accountId: string | null;
  isAdmin: boolean;
  onInvite: () => void;
}) {
  const { space } = useTheme();
  const checklist = setupChecklist(group.state);
  return (
    <>
      {checklist.show ? (
        <SetupChecklist group={group} isAdmin={isAdmin} onInvite={onInvite} />
      ) : (
        <NextEventCard group={group} accountId={accountId} />
      )}
      <View style={{ gap: space.md }}>
        <SectionHeading title="Schedule history" aside="Visible to all Members" />
        <GroupHistory group={group} accountId={accountId} />
      </View>
    </>
  );
}

function NextEventCard({ group, accountId }: { group: GroupDetails; accountId: string | null }) {
  const { space } = useTheme();
  const viewerTimeZone = deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = nextEvent(scheduleGroupOf(group, accountId), now, viewerTimeZone);
  if (!next) {
    return (
      <Card style={{ gap: space.xs }}>
        <Text variant="overline" color="textSecondary">
          Next Event
        </Text>
        <Text variant="title3">No upcoming Events</Text>
        <Text color="textSecondary">No Events yet. An Admin can add an Event Series in Settings.</Text>
      </Card>
    );
  }
  const today = dateIn(now, viewerTimeZone);
  return (
    <Card style={{ gap: 2 }}>
      <Text variant="overline" color="textSecondary">
        {`Next Event · ${relativeDay(next.date, today)}`}
      </Text>
      <Text variant="title3">{formatDayLong(next.date)}</Text>
      <Text variant="caption" color="textTertiary">
        {eventTimeText(next.startsAt, next.groupTimeZone, viewerTimeZone)}
      </Text>
      <View style={{ marginTop: space.sm }}>
        {next.slots.length ? (
          next.slots.map((s) => <SlotRow key={s.key} slot={s} />)
        ) : (
          <Text variant="subhead" color="textSecondary">
            No Responsibilities at this Event.
          </Text>
        )}
      </View>
    </Card>
  );
}

function GroupHistory({ group, accountId }: { group: GroupDetails; accountId: string | null }) {
  const { colors, space } = useTheme();
  const [shown, setShown] = useState(HISTORY_PAGE);
  const limit = Math.max(30, shown);
  const history = useHistory(group.id, group.stateVersion, { limit });
  const viewerTimeZone = deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [history.entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const myMemberId = scheduleGroupOf(group, accountId).myMemberId;
  const lines = useMemo(
    () => (history.entries ? historyLines(history.entries, { state: group.state, myMemberId, timeZone: viewerTimeZone }) : []),
    [history.entries, group.state, myMemberId, viewerTimeZone],
  );
  if (history.error) {
    return (
      <View style={{ gap: space.sm }}>
        <Notice>{history.error}</Notice>
        <Button label="Try again" variant="secondary" onPress={history.reload} />
      </View>
    );
  }
  if (history.loading) return <ActivityIndicator color={colors.primary} />;
  if (lines.length === 0) {
    return (
      <Card>
        <Text color="textSecondary" style={{ textAlign: 'center' }}>
          No history yet
        </Text>
      </Card>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <HistoryList items={lines.slice(0, shown)} now={now} timeZone={viewerTimeZone} />
      {lines.length > shown || (history.entries?.length ?? 0) >= limit ? (
        <Button label="Show more" variant="quiet" onPress={() => setShown((n) => n + 20)} />
      ) : null}
    </View>
  );
}

function SetupChecklist({ group, isAdmin, onInvite }: { group: GroupDetails; isAdmin: boolean; onInvite: () => void }) {
  const { space } = useTheme();
  const checklist = setupChecklist(group.state);
  if (!isAdmin) {
    return (
      <Card style={{ gap: space.md }}>
        <IconTile icon={ListChecks} size={44} bg="successTint" fg="successText" />
        <Text variant="title3">Getting set up</Text>
        <Text color="textSecondary">
          {"Your Admins are still setting up Responsibilities and when Events happen. Once they're done, your turns show up here."}
        </Text>
      </Card>
    );
  }
  const go = (key: ChecklistKey) => {
    switch (key) {
      case 'responsibilities':
        openResponsibility(group.id, 'new');
        break;
      case 'qualified': {
        const id = firstUnstaffedResponsibility(group.state);
        openResponsibility(group.id, id ?? 'new');
        break;
      }
      case 'series':
        openSeries(group.id, 'new');
        break;
      case 'invite':
        onInvite();
        break;
    }
  };
  const firstOpen = checklist.items.find((i) => !i.done)?.key;
  return (
    <Card style={{ gap: space.md }}>
      <IconTile icon={ListChecks} size={44} bg="successTint" fg="successText" />
      <View style={{ gap: space.xs }}>
        <Text variant="overline" color="textSecondary">
          Set up your group
        </Text>
        <Text variant="title3">A few steps and your Rotations start</Text>
      </View>
      <View style={{ gap: space.xs }}>
        {checklist.items.map((item, i) => (
          <ChecklistRow
            key={item.key}
            step={i + 1}
            label={item.label}
            description={item.description}
            done={item.done}
            onPress={() => go(item.key)}
          />
        ))}
      </View>
      {firstOpen ? (
        <Button label={checklist.items.find((i) => i.key === firstOpen)!.label} onPress={() => go(firstOpen)} />
      ) : null}
    </Card>
  );
}

function ChecklistRow({
  step,
  label,
  description,
  done,
  onPress,
}: {
  step: number;
  label: string;
  description: string;
  done: boolean;
  onPress: () => void;
}) {
  const { colors, fonts, radii, space } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${done ? ', done' : ''}`}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 56,
        paddingVertical: space.sm,
        paddingHorizontal: space.sm,
        marginHorizontal: -space.sm,
        borderRadius: radii.md,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
      })}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? colors.success : 'transparent',
          borderWidth: done ? 0 : 1.5,
          borderColor: colors.borderStrong,
        }}>
        {done ? (
          <Check size={16} color={colors.onPrimary} strokeWidth={3} />
        ) : (
          <Text variant="caption" color="textSecondary" style={{ fontFamily: fonts.extrabold }}>
            {String(step)}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="callout"
          color={done ? 'textSecondary' : 'text'}
          style={{ fontFamily: fonts.bold, textDecorationLine: done ? 'line-through' : 'none' }}>
          {label}
        </Text>
        <Text variant="caption" color="textSecondary">
          {description}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}

