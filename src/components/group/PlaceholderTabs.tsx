import { CalendarDays, ListChecks } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, Card, IconTile, Text } from '@/components/ui';
import { formatEventTime, nextEventAt } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { useTheme } from '@/theme';

/** Overview: the setup prompt for a new Group. The real overview arrives with Home (ticket 12). */
export function OverviewTab({ group, isAdmin }: { group: GroupDetails; isAdmin: boolean }) {
  const { space } = useTheme();
  const hasResponsibilities = group.state.responsibilities.some((r) => r.removedAt === null);
  const next = nextEventAt(group.state, new Date());

  if (!hasResponsibilities) {
    return (
      <Card style={{ gap: space.md }}>
        <IconTile icon={ListChecks} size={44} bg="successTint" fg="successText" />
        <Text variant="overline" color="textSecondary">
          Next
        </Text>
        <Text variant="title3">Add Responsibilities</Text>
        <Text color="textSecondary">
          {isAdmin
            ? 'Responsibilities are the duties your group shares, like Host or Setup. Add them, choose who is Qualified for each, and set when your Events repeat.'
            : "Your Admins haven't added Responsibilities yet. Once they do, your turns show up here."}
        </Text>
        {isAdmin ? (
          <View style={{ gap: space.xs }}>
            <Button label="Add Responsibilities" disabled />
            <Text variant="caption" color="textSecondary">
              Setting up Responsibilities and Events arrives in the next update.
            </Text>
          </View>
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
