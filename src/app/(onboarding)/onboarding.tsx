import { router } from 'expo-router';
import { Bell, Link, Mail, MessageSquare, Plus, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, View } from 'react-native';

import {
  Button,
  FieldLabel,
  FormScreen,
  IconTile,
  Notice,
  SettingsList,
  StepDots,
  SwitchRow,
  Text,
  TextField,
} from '@/components/ui';
import { ONBOARDING_STEPS } from '@/lib/gate';
import { inviteUrl, NOT_AN_INVITE, parseInviteToken } from '@/lib/invite';
import { clearPendingInvite, setPendingInvite, usePendingInvite } from '@/lib/pendingInvite';
import { enablePushNotifications } from '@/lib/push';
import { canTogglePush, INSTALL_HINT } from '@/lib/pushStatus';
import { usePushStatus } from '@/lib/usePushStatus';
import { useProfile, useSession } from '@/lib/session';
import { isValidPhone, normalizePhone } from '@/lib/validation';
import { useTheme, type ColorTokens } from '@/theme';

/** Onboarding's steps follow the name step in (auth)/name, which made the account. */
const FIRST_STEP = ONBOARDING_STEPS - 2;

type Choice = 'join' | 'create' | null;

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The rest of the prototype's onboarding (`onbHTML`): notifications, then join or create. Its
 * welcome and name steps are the signed-out screens (src/app/(auth)), which make the account.
 */
export default function OnboardingScreen() {
  const profile = useProfile();
  const { updateProfile } = useSession();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 0: notifications. Push is on by default.
  const [push, setPush] = useState(profile.push_enabled);
  const pushStatus = usePushStatus().status;
  // Ask only where push can work: not in an iPhone browser tab, an old browser or a simulator.
  const canAsk = pushStatus !== null && canTogglePush(pushStatus);
  const [email, setEmail] = useState(profile.email_enabled);
  const [sms, setSms] = useState(profile.sms_enabled);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Step 1: join or create.
  // An invite link opened before signing up (see pendingInvite.ts) preselects joining.
  const pending = usePendingInvite();
  const [pickedChoice, setChoice] = useState<Choice>(null);
  const [typedLink, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const choice: Choice = pickedChoice ?? (pending ? 'join' : null);
  const link = typedLink ?? (pending ? inviteUrl(pending) : '');

  function goTo(next: number) {
    setError(null);
    setStep(next);
  }

  // Android back button steps back through onboarding instead of leaving the app.
  useEffect(() => {
    if (step === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goTo(step - 1);
      return true;
    });
    return () => sub.remove();
  }, [step]);

  async function save(patch: Parameters<typeof updateProfile>[0]): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await updateProfile(patch);
    setBusy(false);
    if (result.error) setError(result.error);
    return !result.error;
  }

  async function saveNotifications() {
    if (sms && !isValidPhone(phone)) {
      setPhoneError('Enter a mobile number, like (555) 123-4567.');
      return;
    }
    setPhoneError(null);
    setBusy(true);
    let pushEnabled = push;
    // Where push can't work here (see canAsk), there is no prompt; the setting stays as it is.
    if (push && canAsk) {
      // Ask the OS now, while the reason is on screen. A "no" turns push off here too.
      const result = await enablePushNotifications();
      if (result === 'denied') pushEnabled = false;
    }
    setPush(pushEnabled);
    const saved = await save({
      push_enabled: pushEnabled,
      email_enabled: email,
      sms_enabled: sms,
      phone: sms ? normalizePhone(phone) : profile.phone,
    });
    if (saved) goTo(1);
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

  /** Marks onboarding done; the auth gate then moves on to the app. */
  async function finish() {
    await save({ onboarding_completed_at: new Date().toISOString(), time_zone: deviceTimeZone() });
  }

  async function later() {
    clearPendingInvite();
    await finish();
  }

  async function createGroup() {
    clearPendingInvite();
    // The create screen is reachable during onboarding too, so open it first, then finish.
    router.push('/create-group');
    await finish();
  }

  const dots = <StepDots count={ONBOARDING_STEPS} current={FIRST_STEP + step} />;
  const back = step > 0 ? () => goTo(step - 1) : undefined;
  const errorNotice = error ? <Notice>{error}</Notice> : null;

  if (step === 0) {
    return (
      <FormScreen
        onBack={back}
        topCenter={dots}
        title="Stay in the loop"
        lead="We'll remind you before your turns and let you know when someone needs cover. That's it: no noise."
        footer={<Button label="Continue" size="lg" loading={busy} onPress={saveNotifications} />}>
        {pushStatus === null || canAsk ? (
          <SettingsList>
            <SwitchRow
              icon={Bell}
              label="Push notifications"
              description="Recommended. Reminders and Coverage Requests arrive on this device."
              value={push}
              onValueChange={setPush}
            />
          </SettingsList>
        ) : (
          <Notice tone="info">
            {pushStatus === 'needsInstall'
              ? INSTALL_HINT
              : pushStatus === 'blocked'
                ? 'Notifications are blocked here. You can allow them later in your settings, and turn them on in Profile.'
                : "Notifications aren't available here. Everything still shows in the app."}
          </Notice>
        )}
        <FieldLabel>Also reach me by (optional)</FieldLabel>
        <SettingsList>
          <SwitchRow
            icon={Mail}
            label="Email"
            description="Optional · you can change this later"
            value={email}
            onValueChange={setEmail}
          />
          <SwitchRow
            icon={MessageSquare}
            label="Text message"
            description="Optional · you can change this later"
            value={sms}
            onValueChange={(on) => {
              setSms(on);
              if (!on) setPhoneError(null);
            }}
          />
        </SettingsList>
        {sms ? (
          <TextField
            label="Mobile number"
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              if (phoneError) setPhoneError(null);
            }}
            error={phoneError}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={32}
          />
        ) : null}
        <Text variant="subhead" color="textSecondary">
          You can change all of this later in Profile.
        </Text>
        {errorNotice}
      </FormScreen>
    );
  }

  const primary =
    choice === 'create' ? (
      <Button label="Create group" size="lg" loading={busy} onPress={createGroup} />
    ) : choice === 'join' ? (
      <Button
        label="Continue"
        size="lg"
        loading={busy}
        disabled={!link.trim()}
        onPress={continueWithInvite}
      />
    ) : (
      <Button label="Continue" size="lg" disabled />
    );

  return (
    <FormScreen
      onBack={back}
      topCenter={dots}
      title="Join or start a group"
      lead="A group is anyone who shares recurring Responsibilities: a team, a household, a club."
      footer={
        <>
          {primary}
          <Button label="I'll do this later" variant="quiet" disabled={busy} onPress={later} />
        </>
      }>
      <ChoiceCard
        icon={Link}
        tileBg="primaryTint"
        tileFg="primary"
        title="Join with an invite link"
        body="Someone sent you a link or QR code."
        selected={choice === 'join'}
        onPress={() => setChoice('join')}
      />
      {choice === 'join' ? (
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
        title="Create a group"
        body="Name it, add Responsibilities, invite people. You'll be its first Admin."
        selected={choice === 'create'}
        onPress={() => setChoice('create')}
      />
      {errorNotice}
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
  onPress,
}: {
  icon: LucideIcon;
  tileBg: keyof ColorTokens;
  tileFg: keyof ColorTokens;
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={title}
      accessibilityHint={body}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 14,
        alignItems: 'flex-start',
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
    </Pressable>
  );
}
