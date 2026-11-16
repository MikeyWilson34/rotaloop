import { router } from 'expo-router';
import { Calendar, Repeat, Scale, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { AppMark } from '@/components/AppMark';
import { Button, FormScreen, IconTile, Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useTheme } from '@/theme';

/** The first screen when signed out (prototype `onbHTML` welcome step). */
export default function WelcomeScreen() {
  const { space } = useTheme();
  return (
    <FormScreen
      footer={
        <>
          <Button label="Get started" size="lg" onPress={() => router.push('/name')} />
          <Text variant="subhead" color="textSecondary" style={{ textAlign: 'center' }}>
            No email or password. Your account lives on this device.
          </Text>
        </>
      }>
      <View style={{ gap: space.sm }}>
        <AppMark />
        <Text variant="title1" accessibilityRole="header">
          Welcome to {APP_NAME}
        </Text>
        <Text color="textSecondary">
          Know whose turn it is, know what to do, and handle changes without a group text.
        </Text>
      </View>
      <View>
        <Feature icon={Calendar} title="Your next turn, at a glance" body="Confirm in a tap." />
        <Feature
          icon={Repeat}
          title="Find cover fast"
          body="Can't make it? Everyone who can step in hears about it."
        />
        <Feature icon={Scale} title="Fair, automatically" body="Rotations keep track so nobody has to." />
      </View>
    </FormScreen>
  );
}

function Feature({ icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  const { fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 12 }}>
      <IconTile icon={icon} bg="primaryTint" fg="primary" />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bold }}>{title}</Text>
        <Text variant="subhead" color="textSecondary">
          {body}
        </Text>
      </View>
    </View>
  );
}
