import { Tabs } from 'expo-router';
import { Activity, Calendar, CircleUser, House, Users, type LucideIcon } from 'lucide-react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActivityUnreadCount } from '@/activity/data';
import { badgeLabel } from '@/activity/feed';
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
  // Unread schedule history since the person last looked at Activity (ticket 12).
  const unread = badgeLabel(useActivityUnreadCount());

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
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: tabIcon(Calendar) }} />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: tabIcon(Activity),
          tabBarBadge: unread ?? undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onPrimary, fontFamily: fonts.extrabold, fontSize: 11 },
          tabBarAccessibilityLabel: unread ? `Activity, ${unread} unread` : 'Activity',
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon(CircleUser) }} />
    </Tabs>
  );
}
