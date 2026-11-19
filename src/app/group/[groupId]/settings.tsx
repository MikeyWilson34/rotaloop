import { router, useLocalSearchParams } from 'expo-router';
import { CalendarOff, ChevronDown, ChevronLeft, ChevronRight, Plus, QrCode, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinkButton } from '@/components/group/ComingUp';
import { InviteSheet } from '@/components/group/InviteSheet';
import { JobEditSheet } from '@/components/group/JobEditSheet';
import type { RunCommand } from '@/components/group/runCommand';
import { TimeZoneSheet } from '@/components/TimeZoneSheet';
import {
  Button,
  ChoiceSheet,
  ConfirmSheet,
  Notice,
  SettingsList,
  Sheet,
  showToast,
  Text,
  TextField,
} from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { dateOffCandidates, groupDatesOff, jobViews, type GroupDateOff, type JobView } from '@/lib/groupPage';
import { NAME_MAX, validateGroupName } from '@/lib/groupSetup';
import { myMember, timeZoneLabel } from '@/lib/groupViews';
import { GROUP_GONE, updateGroupDetails, useGroup, useRunCommand, type GroupDetails } from '@/lib/groups';
import { inviteUrl } from '@/lib/invite';
import { fetchGroupInviteToken, resetGroupInviteToken } from '@/lib/inviteLinks';
import { useSession } from '@/lib/session';
import { copyText, shareLink } from '@/lib/share';
import { formatDayShort } from '@/schedule/format';
import { useTheme } from '@/theme';

/**
 * Group settings (simplify ticket 06, prototype `PAGES.settings`): jobs (tap to edit the same
 * sentence row as setup), the group's dates off, the invite link, more options (name, time
 * zone) and leaving. Every member may change all of it (there are no admins for now).
 */
export default function GroupSettingsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { colors, space, minTapTarget } = useTheme();
  const { session } = useSession();
  const accountId = session?.user.id ?? null;
  const { data, loading, error, refresh, reload } = useGroup(groupId);
  const run: RunCommand = useRunCommand(groupId, reload);
  const me = data ? myMember(data.state, accountId) : undefined;

  function back() {
    if (router.canGoBack()) router.back();
    else if (groupId) router.replace({ pathname: '/group/[groupId]', params: { groupId } });
    else router.replace('/groups');
  }

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator color={colors.primary} style={{ paddingVertical: space.huge }} />;
  } else if (error || !data || !me) {
    const gone = error === GROUP_GONE || (data && !me);
    body = (
      <View style={{ gap: space.md }}>
        <Notice>{gone ? GROUP_GONE : (error ?? GROUP_GONE)}</Notice>
        {gone ? (
          <Button label="Back to Groups" variant="secondary" onPress={() => router.replace('/groups')} />
        ) : (
          <Button label="Try again" variant="secondary" onPress={refresh} />
        )}
      </View>
    );
  } else {
    body = <SettingsBody group={data} meId={me.id} run={run} reload={reload} />;
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={26} color={colors.text} strokeWidth={1.75} />
        </Pressable>
        <Text variant="title3" accessibilityRole="header" style={{ flex: 1 }}>
          Group settings
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: space.huge, gap: space.md }}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsBody({
  group,
  meId,
  run,
  reload,
}: {
  group: GroupDetails;
  meId: string;
  run: RunCommand;
  reload: () => Promise<void>;
}) {
  const { colors, fonts, space } = useTheme();
  const now = useMemo(() => new Date(), [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const jobs = useMemo(() => jobViews(group.state, group.timeZone, now), [group, now]);
  const datesOff = useMemo(() => groupDatesOff(group.state, group.timeZone, now), [group, now]);
  const [editing, setEditing] = useState<JobView | 'new' | null>(null);
  const [addingOff, setAddingOff] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState<'name' | 'timeZone' | 'qr' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeDateOff(d: GroupDateOff) {
    setError(null);
    for (const eventId of d.eventIds) {
      const failed = await run({ type: 'removeSkipDate', eventId }, 'removeSkipDate');
      if (failed) {
        setError(failed);
        return;
      }
    }
    showToast(`${formatDayShort(d.date)} is back on`);
  }

  async function saveDetails(name: string, timeZone: string): Promise<string | null> {
    const failed = await updateGroupDetails(group.id, name, timeZone);
    if (!failed) await reload();
    return failed;
  }

  async function leave() {
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'removeMember', memberId: meId }, 'leave');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    setSheet(null);
    router.dismissAll();
    router.replace('/groups');
    showToast(`You left ${group.name}`);
  }

  return (
    <>
      <Heading title="Jobs" first />
      <SettingsList>
        {jobs.map((job) => (
          <ListRow
            key={job.responsibilityId}
            title={job.name}
            subtitle={job.description}
            accessibilityLabel={`${job.name}, ${job.description}`}
            onPress={() => setEditing(job)}
          />
        ))}
        <AddRow label="Add a job" onPress={() => setEditing('new')} />
      </SettingsList>

      <Heading title="Dates off" />
      <SettingsList>
        {datesOff.map((d) => (
          <DateOffRow key={d.date} dateOff={d} onRemove={() => removeDateOff(d)} />
        ))}
        <AddRow label="Add a group date off" onPress={() => setAddingOff(true)} />
      </SettingsList>
      {error && sheet === null ? <Notice>{error}</Notice> : null}

      <Heading title="Invite link" />
      <InviteLink group={group} onQr={() => setSheet('qr')} />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        accessibilityLabel="More options"
        onPress={() => setMoreOpen((o) => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, marginTop: space.md }}>
        {moreOpen ? <ChevronDown size={18} color={colors.textSecondary} /> : <ChevronRight size={18} color={colors.textSecondary} />}
        <Text color="textSecondary" style={{ fontWeight: '800', fontSize: 14 }}>
          More options
        </Text>
      </Pressable>
      {moreOpen ? (
        <SettingsList>
          <ListRow title="Group name" subtitle={group.name} onPress={() => setSheet('name')} />
          <ListRow
            title="Time zone"
            subtitle={timeZoneLabel(group.timeZone).split(' · ')[0]}
            onPress={() => setSheet('timeZone')}
          />
        </SettingsList>
      ) : null}

      <View style={{ marginTop: space.xxl, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Leave group"
          onPress={() => {
            setError(null);
            setSheet('leave');
          }}
          style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: space.lg, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontFamily: fonts.extrabold, color: colors.dangerText, fontSize: 15 }}>Leave group</Text>
        </Pressable>
      </View>

      {editing ? (
        <JobEditSheet group={group} job={editing === 'new' ? null : editing} run={run} onClose={() => setEditing(null)} />
      ) : null}
      {addingOff ? <AddDateOffSheet group={group} run={run} onClose={() => setAddingOff(false)} /> : null}
      {sheet === 'name' ? (
        <RenameSheet initial={group.name} onClose={() => setSheet(null)} save={(name) => saveDetails(name, group.timeZone)} />
      ) : null}
      <TimeZoneSheet
        visible={sheet === 'timeZone'}
        value={group.timeZone}
        onClose={() => setSheet(null)}
        onPick={async (timeZone) => {
          setSheet(null);
          if (timeZone === group.timeZone) return;
          setError(await saveDetails(group.name, timeZone));
        }}
      />
      <InviteSheet
        visible={sheet === 'qr'}
        onClose={() => setSheet(null)}
        groupName={group.name}
        title="Invite people"
        message="Anyone with this link or QR code joins the group directly."
        loadToken={() => fetchGroupInviteToken(group.id)}
        resetToken={() => resetGroupInviteToken(group.id)}
        shareMessage={`Join ${group.name} on ${APP_NAME}:`}
      />
      <ConfirmSheet
        visible={sheet === 'leave'}
        title={`Leave ${group.name}?`}
        message="Your upcoming turns will be shared out fairly among everyone else. To come back you'll need the invite link."
        confirmLabel="Leave group"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={leave}
        onCancel={() => setSheet(null)}
      />
    </>
  );
}

function Heading({ title, first }: { title: string; first?: boolean }) {
  const { fonts, space } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 20, marginTop: first ? 0 : space.lg }}>
      {title}
    </Text>
  );
}

function ListRow({
  title,
  subtitle,
  accessibilityLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}: ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 64,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
      })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 15 }}>
          {title}
        </Text>
        <Text variant="subhead" color="textSecondary" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
    </Pressable>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        minHeight: 56,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Plus size={22} color={colors.primary} strokeWidth={2} />
      <Text style={{ fontFamily: fonts.extrabold, color: colors.primary, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function DateOffRow({ dateOff, onRemove }: { dateOff: GroupDateOff; onRemove: () => void }) {
  const { colors, fonts, radii, minTapTarget } = useTheme();
  const day = formatDayShort(dateOff.date);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 4, minHeight: 64 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radii.sm,
          backgroundColor: colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <CalendarOff size={20} color={colors.textSecondary} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 15 }}>{day}</Text>
        <Text variant="subhead" color="textSecondary">
          Whole group
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove date off: ${day}`}
        onPress={onRemove}
        style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
        <X size={20} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

/** "Add a group date off": pick one of the upcoming dates; nobody is needed that day. */
function AddDateOffSheet({ group, run, onClose }: { group: GroupDetails; run: RunCommand; onClose: () => void }) {
  const candidates = useMemo(() => dateOffCandidates(group.state, group.timeZone, new Date()), [group]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(group.state.responsibilities.map((r) => [r.id, r.name]));
  const what = (d: GroupDateOff) => {
    const jobs = new Set(
      group.state.assignments.filter((a) => d.eventIds.includes(a.eventId)).map((a) => names.get(a.responsibilityId) ?? ''),
    );
    return [...jobs].filter(Boolean).join(', ');
  };

  async function pick(date: string) {
    const d = candidates.find((c) => c.date === date);
    if (!d || busy) return;
    setPicked(date);
    setBusy(true);
    setError(null);
    for (const eventId of d.eventIds) {
      const failed = await run({ type: 'addSkipDate', eventId, reason: null }, 'addSkipDate');
      if (failed) {
        setBusy(false);
        setError(failed);
        return;
      }
    }
    setBusy(false);
    onClose();
    showToast('Group date off saved');
  }

  if (candidates.length === 0) {
    return (
      <Sheet
        visible
        onClose={onClose}
        title="Group date off"
        footer={<Button label="Close" variant="quiet" onPress={onClose} />}>
        <Notice tone="info">{"Nothing is scheduled yet, so there's no date to take off."}</Notice>
      </Sheet>
    );
  }
  return (
    <ChoiceSheet
      visible
      title="Group date off"
      message={`No one in ${group.name} is needed on this date. Everyone's turns move along, so nobody loses one.`}
      options={candidates.map((d) => ({ value: d.date, label: formatDayShort(d.date), description: what(d) || undefined }))}
      value={picked}
      onPick={pick}
      onClose={onClose}
      busy={busy}
      error={error}
    />
  );
}

/** The group's join link with Copy and Share; the QR code opens in a sheet. */
function InviteLink({ group, onQr }: { group: GroupDetails; onQr: () => void }) {
  const { colors, radii, space, fonts } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetchGroupInviteToken(group.id).then(
      (t) => current && setToken(t),
      (e: unknown) => current && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      current = false;
    };
  }, [group.id]);

  const url = token ? inviteUrl(token) : null;

  async function copy() {
    if (!url) return;
    setStatus((await copyText(url)) ? 'Link copied.' : "Couldn't copy. Press and hold the link to copy it.");
  }

  async function share() {
    if (!url) return;
    const result = await shareLink(url, `Join ${group.name} on ${APP_NAME}:`);
    if (result === 'copied') setStatus('Link copied. Paste it wherever you like.');
    if (result === 'failed') setStatus("Couldn't open sharing. Use Copy instead.");
  }

  return (
    <View style={{ gap: space.xs }}>
      <View
        style={{
          gap: space.sm,
          padding: space.md,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}>
        {error ? <Notice>{error}</Notice> : null}
        {url ? (
          <Text variant="subhead" selectable numberOfLines={2} style={{ fontFamily: fonts.bold }} accessibilityLabel="Invite link">
            {url}
          </Text>
        ) : error ? null : (
          <ActivityIndicator color={colors.primary} />
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Copy link" variant="secondary" style={{ flex: 1 }} disabled={!url} onPress={copy} />
          <Button label="Share" variant="secondary" style={{ flex: 1 }} disabled={!url} onPress={share} />
        </View>
        {status ? (
          <Text variant="subhead" color="successText" accessibilityLiveRegion="polite">
            {status}
          </Text>
        ) : null}
      </View>
      <LinkButton icon={QrCode} label="Show QR code" onPress={onQr} />
    </View>
  );
}

function RenameSheet({
  initial,
  onClose,
  save,
}: {
  initial: string;
  onClose: () => void;
  save: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const invalid = validateGroupName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    const failed = await save(name.trim());
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      title="Group name"
      footer={
        <>
          <Button label="Save name" size="lg" loading={busy} onPress={submit} />
          <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
        </>
      }>
      <TextField
        label="Name"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError(null);
        }}
        error={error}
        maxLength={NAME_MAX}
        autoCapitalize="words"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </Sheet>
  );
}
