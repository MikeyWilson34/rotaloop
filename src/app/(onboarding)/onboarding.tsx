import { router } from 'expo-router';
import { ChevronRight, Link, Plus, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, FormScreen, IconTile, Notice, StepDots, Text, TextField } from '@/components/ui';
import { ONBOARDING_STEPS } from '@/lib/gate';
import { inviteUrl, NOT_AN_INVITE, parseInviteToken } from '@/lib/invite';
import { clearPendingInvite, setPendingInvite, usePendingInvite } from '@/lib/pendingInvite';
import { enablePushNotifications } from '@/lib/push';
import { useProfile, useSession } from '@/lib/session';
import { useTheme, type ColorTokens } from '@/theme';

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The last onboarding step (prototype `renderFlow` → `onb` step 2): join or start a group.
 * Welcome and name are the signed-out screens (src/app/(auth)), which make the account. There
 * is no notifications step: push is on by default (profiles.push_enabled) and can be turned
 * off in Me.
 */
export default function OnboardingScreen() {
  const profile = useProfile();
  const { updateProfile } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An invite link opened before signing up (see pendingInvite.ts) opens the join field.
  const pending = usePendingInvite();
  const [joining, setJoining] = useState(false);
  const [typedLink, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const showJoin = joining || !!pending;
  const link = typedLink ?? (pending ? inviteUrl(pending) : '');

  /**
   * Push is on by default. Ask the device for permission on this first tap (browsers only
   * allow the prompt from a tap); the answer doesn't hold anything up.
   */
  function askForPush() {
    if (profile.push_enabled) void enablePushNotifications();
  }

  /** Marks onboarding done; the auth gate then moves on to the app. */
  async function finish(): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await updateProfile({ onboarding_completed_at: new Date().toISOString(), time_zone: deviceTimeZone() });
    setBusy(false);
    if (result.error) setError(result.error);
    return !result.error;
  }

  /**
   * Keeps the invite and finishes onboarding; once in the app, the join screen opens with it
   * (resumeInviteRoute in invite.ts) to preview the group and join.
   */
  async function continueWithInvite() {
    const token = parseInviteToken(link);
    if (!token) {
      setLinkError(NOT_AN_INVITE);
      return;
    }
    setLinkError(null);
    setPendingInvite(token);
    await finish();
  }

  async function startGroup() {
    askForPush();
    clearPendingInvite();
    // The create screen is reachable during onboarding too, so open it first, then finish.
    router.push('/create-group');
    await finish();
  }

  async function later() {
    clearPendingInvite();
    await finish();
  }

  return (
    <FormScreen
      topCenter={<StepDots count={ONBOARDING_STEPS} current={ONBOARDING_STEPS - 1} />}
      title="Join or start a group?"
      lead="You can always do the other later."
      footer={
        showJoin ? (
          <>
            <Button label="Join" size="lg" loading={busy} disabled={!link.trim()} onPress={continueWithInvite} />
            <Button label="I'll do this later" variant="quiet" disabled={busy} onPress={later} />
          </>
        ) : (
          <Button label="I'll do this later" variant="quiet" disabled={busy} onPress={later} />
        )
      }>
      <ChoiceCard
        icon={Link}
        tileBg="primaryTint"
        tileFg="primary"
        title="Join a group"
        body="I have an invite link"
        selected={showJoin}
        onPress={() => {
          askForPush();
          setJoining(true);
        }}
      />
      {showJoin ? (
        <TextField
          label="Invite link"
          value={link}
          onChangeText={(text) => {
            setLink(text);
            if (linkError) setLinkError(null);
          }}
          error={linkError}
          hint="Next, you'll see the group and join it."
          placeholder="Paste invite link"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={continueWithInvite}
        />
      ) : null}
      <ChoiceCard
        icon={Plus}
        tileBg="successTint"
        tileFg="successText"
        title="Start a group"
        body="I'm the one organizing"
        selected={false}
        disabled={busy}
        onPress={startGroup}
      />
      {error ? <Notice>{error}</Notice> : null}
    </FormScreen>
  );
}

function ChoiceCard({
  icon,
  tileBg,
  tileFg,
  title,
  body,
  selected,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  tileBg: keyof ColorTokens;
  tileFg: keyof ColorTokens;
  title: string;
  body: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={title}
      accessibilityHint={body}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 14,
        alignItems: 'center',
        padding: 16,
        borderRadius: radii.lg,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primaryTint : colors.surface,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}>
      <IconTile icon={icon} bg={tileBg} fg={tileFg} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bold }}>{title}</Text>
        <Text variant="subhead" color="textSecondary">
          {body}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textTertiary} strokeWidth={2} />
    </Pressable>
  );
}
