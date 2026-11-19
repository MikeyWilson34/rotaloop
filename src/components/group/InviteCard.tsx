import { UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import type { GroupDetails } from '@/lib/groups';
import { fetchGroupInviteToken, resetGroupInviteToken } from '@/lib/inviteLinks';
import { useTheme } from '@/theme';

import { InviteSheet } from './InviteSheet';

/**
 * The invite call to action: a tinted card (not a filled button, so the screen keeps one main
 * button) with a filled round icon. The whole card opens the group's join link and QR code.
 */
export function InviteCard({
  group,
  title = 'Invite people',
  subtitle = 'Send a link so everyone gets their own reminders',
}: {
  group: GroupDetails;
  title?: string;
  subtitle?: string | null;
}) {
  const { colors, radii, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Invite people"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          padding: 16,
          minHeight: 72,
          borderRadius: radii.md,
          backgroundColor: colors.primaryTint,
          opacity: pressed ? 0.85 : 1,
        })}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <UserPlus size={22} color={colors.onPrimary} strokeWidth={1.75} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.extrabold, color: colors.primary, fontSize: 17 }}>{title}</Text>
          {subtitle ? (
            <Text variant="subhead" style={{ color: colors.text }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <InviteSheet
        visible={open}
        onClose={() => setOpen(false)}
        groupName={group.name}
        title="Invite people"
        message="Anyone with this link or QR code joins the group directly."
        loadToken={() => fetchGroupInviteToken(group.id)}
        resetToken={() => resetGroupInviteToken(group.id)}
        shareMessage={`Join ${group.name} on ${APP_NAME}:`}
      />
    </>
  );
}
