import { router } from 'expo-router';
import { Globe, Plus, QrCode, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, View } from 'react-native';

import { InviteSheet } from '@/components/group/InviteSheet';
import { JobRow } from '@/components/setup/JobRow';
import { RepeatSheet, TimeSheet } from '@/components/setup/JobSheets';
import { Button, FormScreen, Notice, showToast, StepDots, Text, TextField } from '@/components/ui';
import { createGroup, runGroupCommand } from '@/lib/groupCommand';
import {
  addPersonName,
  checkJobs,
  createGroupRequest,
  newJobDraft,
  placeholderCommands,
  type JobDraft,
} from '@/lib/groupCreate';
import { groupCommandMessage } from '@/lib/groupErrors';
import { NAME_MAX, todayIn, validateGroupName } from '@/lib/groupSetup';
import { deviceTimeZone, timeZoneLabel } from '@/lib/groupViews';
import { inviteUrl } from '@/lib/invite';
import { fetchGroupInviteToken } from '@/lib/inviteLinks';
import { useProfile } from '@/lib/session';
import { copyText, shareLink } from '@/lib/share';
import { useTheme } from '@/theme';

const STEPS = 3;

type Step = 0 | 1 | 2;
type Created = { groupId: string; name: string; jobIds: string[] };
type Picking = { kind: 'repeat' | 'time'; index: number } | null;

/**
 * Start a group in 3 screens (simplify ticket 03, prototype `renderFlow` → `create`):
 * 1. Name your group (time zone detected; changeable later in group settings).
 * 2. What needs doing, and when? One sentence row per Job.
 * 3. Who's in? Share the link or QR code, or type names.
 * The group is made when leaving screen 2, so screen 3 can show its real invite link. Done
 * adds the typed names and opens the group with its schedule already filled in.
 */
export default function CreateGroupScreen() {
  const profile = useProfile();
  const { space } = useTheme();
  const timeZone = useMemo(() => deviceTimeZone(), []);
  const today = useMemo(() => todayIn(timeZone, new Date()), [timeZone]);

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobDraft[]>(() => [newJobDraft(today)]);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creatorName = profile.display_name?.trim() || 'Admin';

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/groups');
  }

  function back() {
    setError(null);
    if (step === 1) setStep(0);
    else leave();
  }

  // Android back steps back through setup. Once the group exists (screen 3) there is no going
  // back to change it here: Done finishes, and Jobs can be changed in the group's settings.
  useEffect(() => {
    if (step === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 1) setStep(0);
      return true;
    });
    return () => sub.remove();
  }, [step]);

  function nameNext() {
    const problem = validateGroupName(name);
    if (problem) {
      setNameError(problem);
      return;
    }
    setStep(1);
  }

  function updateJob(index: number, job: JobDraft) {
    setJobs((list) => list.map((j, i) => (i === index ? job : j)));
    if (error) setError(null);
  }

  async function jobsNext() {
    const check = checkJobs(jobs, timeZone, new Date());
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    setError(null);
    const request = createGroupRequest({ name, memberName: creatorName, timeZone, jobs, now: new Date() });
    const { action: _, ...group } = request;
    const result = await createGroup(group);
    setBusy(false);
    if (!result.ok) {
      setError(groupCommandMessage(result.reason, 'createGroup'));
      return;
    }
    setCreated({ groupId: result.groupId, name: request.name, jobIds: (request.responsibilities ?? []).map((r) => r.id) });
    setStep(2);
  }

  function addTyped() {
    const result = addPersonName(people, typed, creatorName);
    if (!result.ok) {
      setTypedError(result.message);
      return;
    }
    setPeople(result.people);
    setTyped('');
    setTypedError(null);
  }

  async function done() {
    if (!created) return;
    // A name still in the box counts, as if Add was tapped.
    let list = people;
    if (typed.trim()) {
      const result = addPersonName(people, typed, creatorName);
      if (!result.ok) {
        setTypedError(result.message);
        return;
      }
      list = result.people;
      setPeople(list);
      setTyped('');
    }
    setBusy(true);
    setError(null);
    const commands = placeholderCommands(list, created.jobIds);
    for (let i = 0; i < commands.length; i++) {
      const result = await runGroupCommand(created.groupId, commands[i]);
      if (!result.ok) {
        // Keep the names not added yet, so Done can try again.
        setPeople(list.slice(i));
        setBusy(false);
        setError(`Couldn't add ${list[i]}. ${groupCommandMessage(result.reason, 'addPlaceholder')}`);
        return;
      }
    }
    setBusy(false);
    showToast('Your schedule is ready');
    router.replace({ pathname: '/group/[groupId]', params: { groupId: created.groupId } });
  }

  const dots = <StepDots count={STEPS} current={step} />;
  const errorNotice = error ? <Notice>{error}</Notice> : null;

  if (step === 0) {
    return (
      <FormScreen
        onBack={back}
        topCenter={dots}
        title="Name your group"
        lead="Something everyone will recognise."
        footer={<Button label="Next" size="lg" disabled={!name.trim()} onPress={nameNext} />}>
        <TextField
          label="Group name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError) setNameError(null);
          }}
          error={nameError}
          placeholder="e.g. Coffee team"
          maxLength={NAME_MAX}
          autoCapitalize="words"
          autoFocus
          returnKeyType="next"
          onSubmitEditing={nameNext}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <TimeZoneIcon />
          <Text variant="subhead" color="textSecondary">
            Time zone: {timeZoneLabel(timeZone).split(' · ')[0]}
          </Text>
        </View>
      </FormScreen>
    );
  }

  if (step === 1) {
    const picked = picking ? jobs[picking.index] : null;
    return (
      <FormScreen
        onBack={back}
        topCenter={dots}
        title="What needs doing, and when?"
        lead="One line per job. You can change these any time."
        footer={
          <Button
            label="Next"
            size="lg"
            loading={busy}
            disabled={!jobs.some((j) => j.name.trim())}
            onPress={jobsNext}
          />
        }>
        <View style={{ gap: space.md }}>
          {jobs.map((job, i) => (
            <JobRow
              key={i}
              job={job}
              index={i}
              autoFocus={focusRow === i}
              onChange={(next) => updateJob(i, next)}
              onPickRepeat={() => setPicking({ kind: 'repeat', index: i })}
              onPickTime={() => setPicking({ kind: 'time', index: i })}
              onRemove={jobs.length > 1 ? () => setJobs((list) => list.filter((_, k) => k !== i)) : undefined}
            />
          ))}
        </View>
        <LinkButton
          icon={Plus}
          label="Add another job"
          onPress={() => {
            setFocusRow(jobs.length);
            setJobs((list) => [...list, newJobDraft(today)]);
          }}
        />
        {errorNotice}
        <RepeatSheet
          visible={picking?.kind === 'repeat'}
          value={picked?.repeat ?? newJobDraft(today).repeat}
          today={today}
          onClose={() => setPicking(null)}
          onDone={(repeat) => {
            if (picking && picked) updateJob(picking.index, { ...picked, repeat });
            setPicking(null);
          }}
        />
        <TimeSheet
          visible={picking?.kind === 'time'}
          value={picked?.time ?? '10:00'}
          onClose={() => setPicking(null)}
          onDone={(time) => {
            if (picking && picked) updateJob(picking.index, { ...picked, time });
            setPicking(null);
          }}
        />
      </FormScreen>
    );
  }

  return (
    <WhoIsIn
      dots={dots}
      created={created!}
      people={people}
      typed={typed}
      typedError={typedError}
      busy={busy}
      error={errorNotice}
      onType={(text) => {
        setTyped(text);
        if (typedError) setTypedError(null);
      }}
      onAdd={addTyped}
      onRemove={(i) => setPeople((list) => list.filter((_, k) => k !== i))}
      onDone={done}
    />
  );
}

/** Screen 3: the group's invite link (Copy, Share, QR code), or typed names. */
function WhoIsIn({
  dots,
  created,
  people,
  typed,
  typedError,
  busy,
  error,
  onType,
  onAdd,
  onRemove,
  onDone,
}: {
  dots: React.ReactNode;
  created: Created;
  people: string[];
  typed: string;
  typedError: string | null;
  busy: boolean;
  error: React.ReactNode;
  onType: (text: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  const { colors, radii, space, fonts } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    let current = true;
    fetchGroupInviteToken(created.groupId).then(
      (t) => current && setToken(t),
      (e: unknown) => current && setLinkError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      current = false;
    };
  }, [created.groupId]);

  const url = token ? inviteUrl(token) : null;
  const shareMessage = `Join ${created.name} so we can take turns fairly.`;

  async function copy() {
    if (!url) return;
    setStatus((await copyText(url)) ? 'Link copied.' : "Couldn't copy. Press and hold the link to copy it.");
  }

  async function share() {
    if (!url) return;
    const result = await shareLink(url, shareMessage);
    if (result === 'copied') setStatus('Link copied. Paste it wherever you like.');
    if (result === 'failed') setStatus("Couldn't open sharing. Use Copy instead.");
  }

  return (
    <FormScreen
      topCenter={dots}
      title="Who's in?"
      lead="Send this link to your group. Anyone who opens it can join."
      footer={<Button label="Done" size="lg" loading={busy} onPress={onDone} />}>
      {linkError ? <Notice>{linkError}</Notice> : null}
      <View
        style={{
          gap: space.sm,
          padding: space.md,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}>
        {url ? (
          <Text variant="subhead" selectable numberOfLines={2} style={{ fontFamily: fonts.bold }} accessibilityLabel="Invite link">
            {url}
          </Text>
        ) : linkError ? null : (
          <ActivityIndicator color={colors.primary} />
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Copy link" style={{ flex: 1 }} disabled={!url} onPress={copy} />
          <Button label="Share" variant="secondary" style={{ flex: 1 }} disabled={!url} onPress={share} />
        </View>
        {status ? (
          <Text variant="subhead" color="successText" accessibilityLiveRegion="polite">
            {status}
          </Text>
        ) : null}
      </View>
      <LinkButton icon={QrCode} label="Show QR code" onPress={() => setShowQr(true)} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text variant="subhead" color="textSecondary">
          or type names
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Name"
            value={typed}
            onChangeText={onType}
            invalid={!!typedError}
            placeholder="Name"
            autoCapitalize="words"
            maxLength={NAME_MAX}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={onAdd}
          />
        </View>
        <Button label="Add" variant="secondary" style={{ height: 52 }} onPress={onAdd} />
      </View>
      {typedError ? (
        <Text variant="subhead" color="dangerText" accessibilityLiveRegion="polite">
          {typedError}
        </Text>
      ) : null}
      {people.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {people.map((person, i) => (
              <View
                key={person}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingLeft: 14,
                  borderRadius: radii.pill,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}>
                <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
                  {person}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${person}`}
                  onPress={() => onRemove(i)}
                  style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <X size={16} color={colors.textSecondary} strokeWidth={2.25} />
                </Pressable>
              </View>
            ))}
          </View>
          <Text variant="caption" color="textSecondary">
            They&apos;ll get turns now and can claim their spot from the link later.
          </Text>
        </View>
      ) : null}
      {error}
      <InviteSheet
        visible={showQr}
        onClose={() => setShowQr(false)}
        groupName={created.name}
        title="Scan to join"
        message="Point a phone camera at the code to open the link."
        loadToken={() => fetchGroupInviteToken(created.groupId)}
        shareMessage={shareMessage}
      />
    </FormScreen>
  );
}

function TimeZoneIcon() {
  const { colors } = useTheme();
  return <Globe size={14} color={colors.textSecondary} strokeWidth={2} />;
}

function LinkButton({ icon: Icon, label, onPress }: { icon: typeof Plus; label: string; onPress: () => void }) {
  const { colors, fonts, space, minTapTarget } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: space.xs,
        minHeight: minTapTarget,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Icon size={18} color={colors.primary} strokeWidth={2.25} />
      <Text style={{ fontFamily: fonts.bold, color: colors.primary }}>{label}</Text>
    </Pressable>
  );
}
