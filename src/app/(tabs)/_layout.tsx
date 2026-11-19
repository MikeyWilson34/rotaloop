import { Tabs } from 'expo-router';
import { CircleUser, House, Users, type LucideIcon } from 'lucide-react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

function tabIcon(Icon: LucideIcon) {
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon size={24} color={color} strokeWidth={1.75} />;
  }
  return TabIcon;
}

export default function TabLayout() {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon(House) }} />
      <Tabs.Screen name="groups" options={{ title: 'Groups', tabBarIcon: tabIcon(Users) }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: tabIcon(CircleUser) }} />
      {/* Not a tab any more; the route stays so old links and Back fallbacks keep working. */}
      <Tabs.Screen name="schedule" options={{ href: null }} />
    </Tabs>
  );
}
