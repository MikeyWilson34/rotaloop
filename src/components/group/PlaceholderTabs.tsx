import { CalendarDays, Check, ChevronRight, ListChecks } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Button, Card, IconTile, Text } from '@/components/ui';
import { firstUnstaffedResponsibility, setupChecklist, type ChecklistKey } from '@/lib/groupSetup';
import { formatEventTime, nextEventAt } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { useTheme } from '@/theme';

import { openSeries } from './settings/EventsSection';
import { openResponsibility } from './settings/ResponsibilitiesSection';

/**
 * Overview: the guided first setup while the Group has no Responsibilities or no Event
 * Series; otherwise the next Event. The full overview arrives with Home (ticket 12).
 */
export function OverviewTab({
  group,
  isAdmin,
  onInvite,
}: {
  group: GroupDetails;
  isAdmin: boolean;
  onInvite: () => void;
}) {
  const { space } = useTheme();
  const checklist = setupChecklist(group.state);
  const next = nextEventAt(group.state, new Date());

  if (checklist.show) {
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
          <Button
            label={checklist.items.find((i) => i.key === firstOpen)!.label}
            onPress={() => go(firstOpen)}
          />
        ) : null}
      </Card>
    );
  }

  return (
    <Card style={{ gap: space.sm }}>
      <Text variant="overline" color="textSecondary">
        Next Event
      </Text>
      <Text variant="title3">{next ? formatEventTime(next, group.timeZone) : 'No Events yet'}</Text>
      <Text color="textSecondary">The full overview with who is serving arrives in an upcoming update.</Text>
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

/** Schedule: placeholder until the schedule views (ticket 08). */
export function ScheduleTab() {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <IconTile icon={CalendarDays} size={44} bg="primaryTint" fg="primary" />
      <Text variant="title3">{"The group's schedule"}</Text>
      <Text color="textSecondary">
        {"Every Event and who's serving will show here. It arrives in an upcoming update."}
      </Text>
    </Card>
  );
}
