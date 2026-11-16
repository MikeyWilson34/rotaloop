import { View } from 'react-native';

import { Button, Card, Screen, StatusPill, Text, displayStatuses, type DisplayStatus } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useTheme } from '@/theme';

/**
 * Placeholder Home screen. Until the real Home ticket lands, it doubles as a
 * smoke test for the theme and the UI primitives.
 */
export default function HomeScreen() {
  const { space } = useTheme();

  return (
    <Screen title="Home">
      <Text color="textSecondary">Welcome to {APP_NAME}.</Text>

      <Card variant="hero" style={{ gap: space.md }}>
        <Text variant="overline" color="onNavy">
          Next up
        </Text>
        <Text variant="display" color="onNavy">
          Sun, Nov 22
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Confirm" variant="positive" size="lg" style={{ flex: 1 }} />
          <Button label="Can't make it" variant="secondary" size="lg" style={{ flex: 1 }} />
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <Text variant="title3">Buttons</Text>
        <Button label="Primary" variant="primary" />
        <Button label="Secondary" variant="secondary" />
        <Button label="Positive" variant="positive" />
        <Button label="Disabled" disabled />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text variant="title3">Statuses</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(Object.keys(displayStatuses) as DisplayStatus[]).map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </View>
      </Card>

      <Card style={{ gap: space.xs }}>
        <Text variant="title2">Type scale</Text>
        <Text variant="title3">Title 3</Text>
        <Text variant="body">Body text, 16/24.</Text>
        <Text variant="callout">Callout 15/22</Text>
        <Text variant="subhead" color="textSecondary">
          Subhead 14/20
        </Text>
        <Text variant="caption" color="textTertiary">
          Caption 13/18
        </Text>
      </Card>
    </Screen>
  );
}
