import { router } from 'expo-router';
import { Bell, Link, Mail, MessageSquare, Plus, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, View } from 'react-native';

import {
  Button,
  Card,
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
import { parseInviteToken } from '@/lib/invite';
import { enablePushNotifications } from '@/lib/push';
import { useProfile, useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { isValidPhone, normalizePhone } from '@/lib/validation';
import { useTheme, type ColorTokens } from '@/theme';

/** Onboarding's steps follow the name step in (auth)/name, which made the account. */
const FIRST_STEP = ONBOARDING_STEPS - 2;

type Choice = 'join' | 'create' | null;
type InvitePreview = { groupName: string; placeholderName: string | null };

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
  const [email, setEmail] = useState(profile.email_enabled);
  const [sms, setSms] = useState(profile.sms_enabled);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Step 1: join or create.
  const [choice, setChoice] = useState<Choice>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);

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
    if (push) {
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

  async function checkInvite() {
    const token = parseInviteToken(link);
    if (!token) {
      setLinkError("That doesn't look like an invite link. Paste the whole link you were sent.");
      return;
    }
    setLinkError(null);
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('invite_link_preview', { p_token: token });
    setBusy(false);
    if (rpcError) {
      setLinkError("Couldn't check that link. Check your connection and try again.");
      return;
    }
    const row = data?.[0];
    if (!row) {
      setLinkError("That invite link isn't working. It may have been reset: ask for a new one.");
      return;
    }
    setPreview({ groupName: row.group_name, placeholderName: row.placeholder_name || null });
  }

  /** Marks onboarding done; the auth gate then moves on to the app. */
  async function finish() {
    await save({ onboarding_completed_at: new Date().toISOString(), time_zone: deviceTimeZone() });
  }

  async function createGroup() {
    // The placeholder is reachable during onboarding too, so open it first, then finish.
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
        <SettingsList>
          <SwitchRow
            icon={Bell}
            label="Push notifications"
            description="Recommended. Reminders and Coverage Requests arrive on this device."
            value={push}
            onValueChange={setPush}
          />
        </SettingsList>
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
    ) : choice === 'join' && preview ? (
      <Button label="Continue" size="lg" loading={busy} onPress={finish} />
    ) : choice === 'join' ? (
      <Button
        label="Check invite link"
        size="lg"
        loading={busy}
        disabled={!link.trim()}
        onPress={checkInvite}
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
          <Button label="I'll do this later" variant="quiet" disabled={busy} onPress={finish} />
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
        preview ? (
          <Card style={{ gap: 8 }}>
            <Text variant="overline" color="textSecondary">
              {"You're invited to"}
            </Text>
            <Text variant="title3">{preview.groupName}</Text>
            {preview.placeholderName ? (
              <Text variant="subhead" color="textSecondary">
                {`You'll join as ${preview.placeholderName}.`}
              </Text>
            ) : null}
            <Notice tone="info">
              {
                'Joining from the app arrives in the next update. Keep your link: you can use it from Groups then.'
              }
            </Notice>
            <Button
              label="Use a different link"
              variant="quiet"
              onPress={() => {
                setPreview(null);
                setLink('');
              }}
            />
          </Card>
        ) : (
          <TextField
            label="Invite link"
            value={link}
            onChangeText={(text) => {
              setLink(text);
              if (linkError) setLinkError(null);
            }}
            error={linkError}
            placeholder="Paste invite link"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={checkInvite}
          />
        )
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
