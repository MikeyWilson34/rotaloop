import { CalendarOff, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { SignOutButton } from '@/components/SignOutButton';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  ConfirmSheet,
  FieldLabel,
  IconTile,
  Notice,
  Screen,
  SettingsList,
  showToast,
  SwitchRow,
  Text,
  TextField,
} from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { REMINDER_TIME_OPTIONS, formatTime, normalizeTime } from '@/lib/notificationPrefs';
import { disablePushNotifications, enablePushNotifications, PUSH_PLATFORM } from '@/lib/push';
import { blockedHint, canTogglePush, INSTALL_HINT, pushStatusText, shownPushStatus } from '@/lib/pushStatus';
import { useProfile, useSession, type ProfilePatch } from '@/lib/session';
import { outcomeErrors, removeTimeOff, useMyGroupStates } from '@/lib/timeOff';
import { usePushStatus } from '@/lib/usePushStatus';
import { initials, joinName, splitName } from '@/lib/validation';
import { timeOffItems, type TimeOffItem } from '@/schedule/timeOff';
import { useTheme } from '@/theme';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

/** "My dates off": the person's own list. Add opens the dates-off screen; remove happens here. */
function DatesOff() {
  const { colors, fonts, space, minTapTarget } = useTheme();
  const { data, reload } = useMyGroupStates();
  const groups = useMemo(() => data ?? [], [data]);
  const now = useMemo(() => new Date().toISOString(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => timeOffItems(groups, now), [groups, now]);
  const [removing, setRemoving] = useState<TimeOffItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    const message = outcomeErrors(await removeTimeOff(removing.entries, groups), 'remove');
    await reload();
    setBusy(false);
    if (message) return setError(message);
    setRemoving(null);
    showToast('Dates off removed', Trash2);
  }

  return (
    <Section label="My dates off">
      {items.length > 0 ? (
        <Card style={{ paddingVertical: space.xs, paddingHorizontal: 0 }}>
          {items.map((item, i) => (
            <View
              key={item.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingLeft: 16,
                paddingRight: 4,
                paddingVertical: 8,
                minHeight: 60,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}>
              <IconTile icon={CalendarOff} bg="dangerTint" fg="dangerText" />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
                  {item.label}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {item.detail}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove dates off: ${item.label}`}
                onPress={() => {
                  setError(null);
                  setRemoving(item);
                }}
                style={({ pressed }) => ({
                  width: minTapTarget,
                  height: minTapTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.6 : 1,
                })}>
                <Trash2 size={20} color={colors.textSecondary} strokeWidth={1.75} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : (
        <Text variant="subhead" color="textSecondary">
          No dates off yet.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add dates off"
        onPress={() => router.push('/time-off')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: minTapTarget,
          opacity: pressed ? 0.6 : 1,
        })}>
        <Plus size={20} color={colors.primary} strokeWidth={2} />
        <Text style={{ color: colors.primary, fontFamily: fonts.bold }}>Add dates off</Text>
      </Pressable>
      <ConfirmSheet
        visible={removing !== null}
        title="Remove these dates off?"
        message={`${removing?.label ?? ''}. You can be scheduled on these days again.`}
        confirmLabel="Remove"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Section>
  );
}

export default function MeScreen() {
  const profile = useProfile();
  const { isGuest, session, setDisplayName, updateProfile } = useSession();
  const { colors, space, fonts } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const push = usePushStatus();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(() => splitName(profile.display_name).first);
  const [lastName, setLastName] = useState(() => splitName(profile.display_name).last);
  const [savingName, setSavingName] = useState(false);
  const [nameNote, setNameNote] = useState<string | null>(null);
  const nameChanged = joinName(firstName, lastName) !== profile.display_name;

  async function saveName() {
    if (savingName || !firstName.trim()) return;
    if (!nameChanged) return setEditing(false);
    setNameNote(null);
    setSavingName(true);
    const result = await setDisplayName(joinName(firstName, lastName));
    setSavingName(false);
    if (result.error) setNameNote(result.error);
    else setEditing(false);
  }

  async function save(patch: ProfilePatch) {
    setError(null);
    const result = await updateProfile(patch);
    if (result.error) setError(result.error);
  }

  /** On asks for permission and registers this device or browser; off turns push off for the account. */
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

  const reminderTime = normalizeTime(profile.reminder_time);
  const pushStatus = push.status === null ? null : shownPushStatus(push.status, profile.push_enabled);
  const name = profile.display_name || 'Add your name';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title="Me" keyboardShouldPersistTaps="handled">
        {editing ? (
          <Card style={{ gap: space.sm }}>
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
            {nameNote ? <Notice>{nameNote}</Notice> : null}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label="Cancel"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  const parts = splitName(profile.display_name);
                  setFirstName(parts.first);
                  setLastName(parts.last);
                  setNameNote(null);
                  setEditing(false);
                }}
              />
              <Button label="Save name" loading={savingName} disabled={!firstName.trim()} onPress={saveName} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`${name}. Edit name`} onPress={() => setEditing(true)}>
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
              </View>
              <Pencil size={18} color={colors.textTertiary} strokeWidth={1.75} />
            </Card>
          </Pressable>
        )}

        {error ? <Notice>{error}</Notice> : null}

        <Section label="Notifications">
          <SettingsList>
            <SwitchRow
              icon={Smartphone}
              label="Notifications"
              description={pushStatus ? pushStatusText(pushStatus, PUSH_PLATFORM) : 'Checking…'}
              value={profile.push_enabled && pushStatus === 'on'}
              onValueChange={setPushEnabled}
              disabled={pushBusy || pushStatus === null || !canTogglePush(pushStatus)}
            />
          </SettingsList>
          {pushNote ? (
            <Notice tone="info">{pushNote}</Notice>
          ) : pushStatus === 'needsInstall' ? (
            <Notice tone="info">{INSTALL_HINT}</Notice>
          ) : pushStatus === 'blocked' ? (
            <Notice tone="info">{blockedHint(PUSH_PLATFORM, APP_NAME)}</Notice>
          ) : null}
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

        <DatesOff />

        <View style={{ marginTop: space.xl }}>
          <SignOutButton />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
