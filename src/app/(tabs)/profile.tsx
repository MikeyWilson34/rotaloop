import {
  Mail,
  MessageSquare,
  Repeat,
  ShieldCheck,
  Smartphone,
  CalendarX,
  CalendarOff,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { SignOutButton } from '@/components/SignOutButton';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  FieldLabel,
  Notice,
  Screen,
  SettingsList,
  SwitchRow,
  Text,
  TextField,
  ValueRow,
} from '@/components/ui';
import { APP_NAME } from '@/config/app';
import {
  REMINDER_DAY_OPTIONS,
  REMINDER_TIME_OPTIONS,
  alertLeadLabel,
  formatTime,
  nextAlertLead,
  normalizeTime,
  toggleReminderDay,
} from '@/lib/notificationPrefs';
import { disablePushNotifications, enablePushNotifications, PUSH_PLATFORM } from '@/lib/push';
import { blockedHint, canTogglePush, INSTALL_HINT, pushStatusText, shownPushStatus } from '@/lib/pushStatus';
import { usePushStatus } from '@/lib/usePushStatus';
import { useProfile, useSession, type ProfilePatch } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { initials, isValidPhone, joinName, normalizePhone, splitName } from '@/lib/validation';
import { useTheme } from '@/theme';

/** How many Groups the person belongs to, and how many of those they're an Admin of. */
function useMembershipCounts(userId: string) {
  const [counts, setCounts] = useState<{ groups: number; admin: number } | null>(null);
  useEffect(() => {
    let current = true;
    supabase
      .from('members')
      .select('group_id, is_admin')
      .eq('account_id', userId)
      .is('left_at', null)
      .then(({ data }) => {
        if (!current || !data) return;
        setCounts({ groups: data.length, admin: data.filter((m) => m.is_admin).length });
      });
    return () => {
      current = false;
    };
  }, [userId]);
  return counts;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

export default function ProfileScreen() {
  const profile = useProfile();
  const { isGuest, session, setDisplayName, updateProfile } = useSession();
  const { colors, space, fonts } = useTheme();
  const counts = useMembershipCounts(profile.id);
  const [error, setError] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const push = usePushStatus();
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(() => splitName(profile.display_name).first);
  const [lastName, setLastName] = useState(() => splitName(profile.display_name).last);
  const [savingName, setSavingName] = useState(false);
  const [nameNote, setNameNote] = useState<string | null>(null);
  const nameChanged = joinName(firstName, lastName) !== profile.display_name;

  async function saveName() {
    if (savingName || !firstName.trim() || !nameChanged) return;
    setNameNote(null);
    setSavingName(true);
    const result = await setDisplayName(joinName(firstName, lastName));
    setSavingName(false);
    if (result.error) setNameNote(result.error);
  }

  async function save(patch: ProfilePatch) {
    setError(null);
    const result = await updateProfile(patch);
    if (result.error) setError(result.error);
  }

  /**
   * The push switch: on asks for permission and registers this device or browser (Web Push
   * on the website); off turns push off for the account and, on the website, unsubscribes
   * this browser.
   */
  async function setPushEnabled(on: boolean) {
    setPushNote(null);
    setPushBusy(true);
    try {
      if (!on) {
        await disablePushNotifications();
        await save({ push_enabled: false });
        return;
      }
      const result = await enablePushNotifications();
      if (result === 'denied') return setPushNote(blockedHint(PUSH_PLATFORM, APP_NAME));
      if (result === 'needsInstall') return setPushNote(INSTALL_HINT);
      if (result === 'failed') return setPushNote("Couldn't turn on notifications here. Please try again.");
      await save({ push_enabled: true });
    } finally {
      setPushBusy(false);
      push.refresh();
    }
  }

  function savePhone() {
    if (!phone.trim()) {
      setPhoneError('Enter a mobile number to get text messages.');
      return;
    }
    if (!isValidPhone(phone)) {
      setPhoneError('Enter a mobile number, like (555) 123-4567.');
      return;
    }
    setPhoneError(null);
    const normalized = normalizePhone(phone);
    if (normalized !== profile.phone) save({ phone: normalized });
  }

  const reminderTime = normalizeTime(profile.reminder_time);
  const pushStatus = push.status === null ? null : shownPushStatus(push.status, profile.push_enabled);
  const name = profile.display_name || 'Add your name';
  const meta =
    counts === null
      ? null
      : `${counts.groups} ${counts.groups === 1 ? 'group' : 'groups'}` +
        (counts.admin > 0 ? ` · Admin of ${counts.admin}` : '');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title="Profile" keyboardShouldPersistTaps="handled">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View
            accessible={false}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: colors.primaryTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text variant="title3" color="primary" style={{ fontFamily: fonts.extrabold }}>
              {initials(profile.display_name)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="title3" style={{ fontSize: 20, lineHeight: 26, fontFamily: fonts.extrabold }}>
              {name}
            </Text>
            <Text variant="subhead" color="textSecondary">
              {isGuest ? 'Guest account · on this device' : (session?.user.email ?? '')}
            </Text>
            {meta ? (
              <Text variant="caption" color="textSecondary" style={{ marginTop: 4 }}>
                {meta}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* Time Off (ticket 10). */}
        <SettingsList>
          <ValueRow
            icon={CalendarOff}
            label="Time Off"
            description="Days you can’t serve"
            onPress={() => router.push('/time-off')}
          />
        </SettingsList>

        {error ? <Notice>{error}</Notice> : null}

        <Section label="Your name">
          <TextField
            label="First name"
            value={firstName}
            onChangeText={(text) => {
              setFirstName(text);
              setNameNote(null);
            }}
            placeholder="First name"
            autoComplete="given-name"
            textContentType="givenName"
            autoCapitalize="words"
            returnKeyType="next"
            maxLength={60}
          />
          <TextField
            label="Last name"
            value={lastName}
            onChangeText={(text) => {
              setLastName(text);
              setNameNote(null);
            }}
            placeholder="Last name"
            autoComplete="family-name"
            textContentType="familyName"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={saveName}
            maxLength={60}
          />
          {nameChanged ? (
            <Button
              label="Save name"
              loading={savingName}
              disabled={!firstName.trim()}
              onPress={saveName}
            />
          ) : null}
          {nameNote ? <Notice>{nameNote}</Notice> : null}
          <Text variant="caption" color="textSecondary">
            Your groups see this name.
          </Text>
        </Section>

        <Section label="Remind me before an Assignment">
          <ChipGroup>
            {REMINDER_DAY_OPTIONS.map((option) => (
              <Chip
                key={option.days}
                label={option.label}
                selected={profile.reminder_days_before.includes(option.days)}
                onPress={() =>
                  save({
                    reminder_days_before: toggleReminderDay(
                      profile.reminder_days_before,
                      option.days,
                    ),
                  })
                }
              />
            ))}
          </ChipGroup>
        </Section>

        <Section label="Reminder time">
          <ChipGroup>
            {REMINDER_TIME_OPTIONS.map((time) => (
              <Chip
                key={time}
                label={formatTime(time)}
                selected={reminderTime === time}
                onPress={() => save({ reminder_time: time })}
              />
            ))}
          </ChipGroup>
        </Section>

        <Section label="How to reach me">
          <SettingsList>
            <SwitchRow
              icon={Smartphone}
              label="Push notifications"
              description={pushStatus ? pushStatusText(pushStatus, PUSH_PLATFORM) : 'Checking…'}
              value={profile.push_enabled && pushStatus === 'on'}
              onValueChange={setPushEnabled}
              disabled={pushBusy || pushStatus === null || !canTogglePush(pushStatus)}
            />
            <SwitchRow
              icon={Mail}
              label="Email"
              description="Optional"
              value={profile.email_enabled}
              onValueChange={(on) => save({ email_enabled: on })}
            />
            <SwitchRow
              icon={MessageSquare}
              label="Text message"
              description="Optional · standard rates may apply"
              value={profile.sms_enabled}
              onValueChange={(on) => {
                setPhoneError(null);
                save({ sms_enabled: on });
              }}
            />
          </SettingsList>
          {pushNote ? (
            <Notice tone="info">{pushNote}</Notice>
          ) : pushStatus === 'needsInstall' ? (
            <Notice tone="info">{INSTALL_HINT}</Notice>
          ) : pushStatus === 'blocked' ? (
            <Notice tone="info">{blockedHint(PUSH_PLATFORM, APP_NAME)}</Notice>
          ) : null}
          {profile.sms_enabled ? (
            <TextField
              label="Mobile number"
              value={phone}
              onChangeText={(text) => {
                setPhone(text);
                if (phoneError) setPhoneError(null);
              }}
              onBlur={savePhone}
              onSubmitEditing={savePhone}
              error={phoneError}
              placeholder="(555) 123-4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="done"
              maxLength={32}
            />
          ) : null}
        </Section>

        <Section label="Tell me about">
          <SettingsList>
            <SwitchRow
              icon={Repeat}
              label="Coverage Requests"
              description="When someone needs cover for a Responsibility I'm Qualified for"
              value={profile.notify_coverage_requests}
              onValueChange={(on) => save({ notify_coverage_requests: on })}
            />
            <SwitchRow
              icon={CalendarX}
              label="Schedule changes"
              description="Skip Dates, Time Off routing and Make-up Turns that affect me"
              value={profile.notify_changes}
              onValueChange={(on) => save({ notify_changes: on })}
            />
          </SettingsList>
        </Section>

        {counts && counts.admin > 0 ? (
          <Section label="As an Admin">
            <SettingsList>
              <ValueRow
                icon={ShieldCheck}
                label="Alert me about Unconfirmed / Needs coverage Assignments"
                description="In the groups you manage. Nothing is ever declined automatically."
                value={alertLeadLabel(profile.admin_alert_lead_time_ms)}
                onPress={() =>
                  save({ admin_alert_lead_time_ms: nextAlertLead(profile.admin_alert_lead_time_ms) })
                }
              />
            </SettingsList>
          </Section>
        ) : null}

        <View style={{ marginTop: space.xl }}>
          <SignOutButton />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
