import { router, useLocalSearchParams } from 'expo-router';
import { BellRing, Scale, Star, Trash2, Users } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import {
  ActionRow,
  Button,
  Chip,
  ChipGroup,
  ConfirmSheet,
  FieldLabel,
  FormScreen,
  InfoRow,
  Notice,
  ReorderList,
  SettingsList,
  Stepper,
  SwitchRow,
  Text,
  TextField,
} from '@/components/ui';
import { myMember } from '@/lib/groupViews';
import { useGroup, useRunCommand, type GroupDetails } from '@/lib/groups';
import {
  HEADCOUNT_MAX,
  moveItem,
  NAME_MAX,
  newId,
  outstandingMakeUpTurns,
  qualificationOptions,
  responsibilityChanges,
  rotationQueue,
  teamLabel,
  validateResponsibilityForm,
} from '@/lib/groupSetup';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

type RunCommand = ReturnType<typeof useRunCommand>;

function back(groupId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/group/[groupId]', params: { groupId, tab: 'settings' } });
}

/**
 * A Responsibility: add or edit it (name, headcount, confirmation, Primary), pick its
 * team, reorder its Rotation, Rebalance, or remove it. Members see it read-only.
 * `responsibilityId` "new" adds one.
 */
export default function ResponsibilityScreen() {
  const { groupId, responsibilityId } = useLocalSearchParams<{ groupId: string; responsibilityId: string }>();
  const { colors, space } = useTheme();
  const { session } = useSession();
  const { data, loading, error, refresh, reload } = useGroup(groupId);
  const run = useRunCommand(groupId, reload);

  const isNew = responsibilityId === 'new';
  const me = data ? myMember(data.state, session?.user.id ?? null) : undefined;
  const responsibility = data?.state.responsibilities.find((r) => r.id === responsibilityId && r.removedAt === null);

  if (loading || !data) {
    return (
      <FormScreen onBack={() => back(groupId)} title={isNew ? 'Add Responsibility' : 'Responsibility'}>
        {error ? (
          <View style={{ gap: space.md }}>
            <Notice>{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={refresh} />
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </FormScreen>
    );
  }
  if (!me || (!isNew && !responsibility) || (isNew && !me.isAdmin)) {
    return (
      <FormScreen onBack={() => back(groupId)} title="Responsibility">
        <Notice>{"This Responsibility isn't in the group anymore."}</Notice>
        <Button label="Back" variant="secondary" onPress={() => back(groupId)} />
      </FormScreen>
    );
  }
  if (isNew) return <NewResponsibility group={data} run={run} />;
  return me.isAdmin ? (
    <EditResponsibility key={responsibility!.id} group={data} responsibilityId={responsibility!.id} run={run} />
  ) : (
    <ViewResponsibility group={data} responsibilityId={responsibility!.id} />
  );
}

// ---------------------------------------------------------------------------

function DetailsFields({
  name,
  setName,
  headcount,
  setHeadcount,
  requiresConfirmation,
  setRequiresConfirmation,
  errors,
  disabled,
  headcountHint,
}: {
  name: string;
  setName: (v: string) => void;
  headcount: number;
  setHeadcount: (v: number) => void;
  requiresConfirmation: boolean;
  setRequiresConfirmation: (v: boolean) => void;
  errors: Partial<Record<'name' | 'headcount', string>>;
  disabled?: boolean;
  headcountHint: string;
}) {
  return (
    <>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        error={errors.name}
        placeholder="e.g. Host, Setup, Driver"
        maxLength={NAME_MAX}
        autoCapitalize="words"
        editable={!disabled}
      />
      <Stepper
        label="People needed at each Event"
        value={headcount}
        onChange={setHeadcount}
        min={1}
        max={HEADCOUNT_MAX}
        hint={headcountHint}
        error={errors.headcount}
        disabled={disabled}
      />
      <SettingsList>
        <SwitchRow
          icon={BellRing}
          label="Needs confirmation"
          description="People are asked to confirm each of their turns."
          value={requiresConfirmation}
          onValueChange={setRequiresConfirmation}
          disabled={disabled}
        />
      </SettingsList>
    </>
  );
}

function NewResponsibility({ group, run }: { group: GroupDetails; run: RunCommand }) {
  const { space } = useTheme();
  const [name, setName] = useState('');
  const [headcount, setHeadcount] = useState(1);
  const [requiresConfirmation, setRequiresConfirmation] = useState(true);
  const [qualified, setQualified] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'headcount', string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = qualificationOptions(group.state, null);
  const otherNames = group.state.responsibilities.filter((r) => r.removedAt === null).map((r) => r.name);

  async function add() {
    const result = validateResponsibilityForm({ name, headcount: String(headcount), requiresConfirmation }, otherNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    const id = newId('r', group.state.responsibilities.map((r) => r.id));
    const failed = await run(
      { type: 'addResponsibility', responsibility: { id, ...result.value }, qualifiedMemberIds: qualified },
      'saveResponsibility',
    );
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    // Continue on the new Responsibility, where its Rotation order shows.
    router.replace({
      pathname: '/group/[groupId]/responsibility/[responsibilityId]',
      params: { groupId: group.id, responsibilityId: id },
    });
  }

  return (
    <FormScreen
      onBack={() => back(group.id)}
      title="Add Responsibility"
      lead="A duty your group shares at its Events. Pick who can take it: they rotate in the order you add them."
      footer={<Button label="Add Responsibility" size="lg" loading={busy} onPress={add} />}>
      <DetailsFields
        name={name}
        setName={(v) => {
          setName(v);
          setErrors((e) => ({ ...e, name: undefined }));
        }}
        headcount={headcount}
        setHeadcount={setHeadcount}
        requiresConfirmation={requiresConfirmation}
        setRequiresConfirmation={setRequiresConfirmation}
        errors={errors}
        disabled={busy}
        headcountHint="How many people fill this at each Event."
      />
      <View style={{ gap: space.sm }}>
        <FieldLabel>{name.trim() ? `${name.trim()} team` : 'Team'}</FieldLabel>
        <ChipGroup>
          {options.map((o) => (
            <Chip
              key={o.memberId}
              label={o.name}
              selected={qualified.includes(o.memberId)}
              disabled={busy}
              onPress={() =>
                setQualified((q) => (q.includes(o.memberId) ? q.filter((x) => x !== o.memberId) : [...q, o.memberId]))
              }
            />
          ))}
        </ChipGroup>
        <Text variant="subhead" color="textSecondary">
          {"Not everyone here yet? Add people by name from the Members tab, and add them to the team later."}
        </Text>
      </View>
      {error ? <Notice>{error}</Notice> : null}
    </FormScreen>
  );
}

type Confirm = 'remove' | 'rebalance' | null;

function EditResponsibility({ group, responsibilityId, run }: { group: GroupDetails; responsibilityId: string; run: RunCommand }) {
  const { space } = useTheme();
  const r = group.state.responsibilities.find((x) => x.id === responsibilityId)!;
  const isPrimary = group.state.primaryResponsibilityId === r.id;
  const [name, setName] = useState(r.name);
  const [headcount, setHeadcount] = useState(r.headcount);
  const [requiresConfirmation, setRequiresConfirmation] = useState(r.requiresConfirmation);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'headcount', string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [draftQueue, setDraftQueue] = useState<string[] | null>(null);

  const queue = rotationQueue(group.state, r.id);
  const queueIds = queue.map((q) => q.memberId);
  // A draft order only stands while it lists the same people as the saved queue.
  const draftValid =
    draftQueue !== null && draftQueue.length === queueIds.length && draftQueue.every((id) => queueIds.includes(id));
  const shownQueue = draftValid ? draftQueue.map((id) => queue.find((q) => q.memberId === id)!) : queue;
  const queueChanged = draftValid && draftQueue.some((id, i) => id !== queueIds[i]);
  const options = qualificationOptions(group.state, r.id);
  const owed = outstandingMakeUpTurns(group.state, r.id);
  const otherNames = group.state.responsibilities.filter((x) => x.removedAt === null && x.id !== r.id).map((x) => x.name);

  const changes = (() => {
    const result = validateResponsibilityForm({ name, headcount: String(headcount), requiresConfirmation }, otherNames);
    return result.ok ? responsibilityChanges(r, result.value) : 'invalid';
  })();

  async function act(command: Parameters<RunCommand>[0], action: Parameters<RunCommand>[1], done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const failed = await run(command, action);
    setBusy(false);
    if (failed) setError(failed);
    else if (done) setNotice(done);
    return !failed;
  }

  async function save() {
    const result = validateResponsibilityForm({ name, headcount: String(headcount), requiresConfirmation }, otherNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const diff = responsibilityChanges(r, result.value);
    if (!diff) return;
    const seats = diff.headcount !== undefined;
    await act(
      { type: 'editResponsibility', responsibilityId: r.id, changes: diff },
      'saveResponsibility',
      seats ? 'Saved. Upcoming Events now have the new number of seats, filled from the Rotation.' : 'Saved.',
    );
  }

  async function confirmed() {
    if (confirm === 'remove') {
      if (await act({ type: 'removeResponsibility', responsibilityId: r.id }, 'removeResponsibility')) back(group.id);
    } else if (confirm === 'rebalance') {
      if (await act({ type: 'rebalance', responsibilityId: r.id }, 'rebalance', 'Rebalanced. Whoever has served least is now first.')) {
        setDraftQueue(null);
        setConfirm(null);
      }
    }
  }

  return (
    <FormScreen
      onBack={() => back(group.id)}
      title={r.name}
      lead="Changes apply from the next Event on. Past Events keep their history."
      footer={
        <Button
          label="Save changes"
          size="lg"
          loading={busy && confirm === null}
          disabled={changes === null || busy}
          onPress={save}
        />
      }>
      <DetailsFields
        name={name}
        setName={(v) => {
          setName(v);
          setErrors((e) => ({ ...e, name: undefined }));
        }}
        headcount={headcount}
        setHeadcount={setHeadcount}
        requiresConfirmation={requiresConfirmation}
        setRequiresConfirmation={setRequiresConfirmation}
        errors={errors}
        disabled={busy}
        headcountHint="Changing it adds or removes seats from the next Event on."
      />
      <SettingsList>
        <SwitchRow
          icon={Star}
          label="Primary Responsibility"
          description="Whoever holds it at the next Event is shown on the group's card."
          value={isPrimary}
          disabled={busy}
          onValueChange={(on) => act({ type: 'setPrimaryResponsibility', responsibilityId: on ? r.id : null }, 'saveResponsibility')}
        />
      </SettingsList>
      {notice ? (
        <Text variant="subhead" color="successText" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {error && confirm === null ? <Notice>{error}</Notice> : null}

      <View style={{ gap: space.sm }}>
        <FieldLabel>{teamLabel(r.name, queue.length)}</FieldLabel>
        <Text variant="subhead" color="textSecondary">
          Tap a name to add them to the {r.name} team or take them off. New people join the end of the Rotation.
        </Text>
        <ChipGroup>
          {options.map((o) => (
            <Chip
              key={o.memberId}
              label={o.name}
              selected={o.qualified}
              disabled={busy}
              onPress={() => {
                setDraftQueue(null);
                act(
                  { type: o.qualified ? 'unqualifyMember' : 'qualifyMember', memberId: o.memberId, responsibilityId: r.id },
                  'qualify',
                );
              }}
            />
          ))}
        </ChipGroup>
      </View>

      <View style={{ gap: space.sm }}>
        <FieldLabel>Rotation: who is next</FieldLabel>
        {shownQueue.length === 0 ? (
          <Text variant="subhead" color="textSecondary">
            Nobody is on the {r.name} team yet, so these seats stay open. Add people to the team above.
          </Text>
        ) : (
          <>
            <ReorderList
              itemNoun="person"
              items={shownQueue.map((q, i) => ({
                key: q.memberId,
                label: q.name,
                description: i === 0 ? 'Next up' : q.isPlaceholder ? 'Not joined yet' : undefined,
              }))}
              disabled={busy}
              onMove={(index, delta) => setDraftQueue(moveItem(draftValid ? draftQueue : queueIds, index, delta))}
            />
            {queueChanged ? (
              <View style={{ gap: space.sm }}>
                <Button
                  label="Save Rotation order"
                  loading={busy}
                  onPress={async () => {
                    if (await act({ type: 'reorderQueue', responsibilityId: r.id, queue: draftQueue! }, 'reorder', 'Rotation order saved.')) {
                      setDraftQueue(null);
                    }
                  }}
                />
                <Button label="Undo changes" variant="quiet" disabled={busy} onPress={() => setDraftQueue(null)} />
              </View>
            ) : null}
          </>
        )}
      </View>

      <SettingsList>
        <ActionRow
          icon={Scale}
          label="Rebalance"
          description="Whoever has served least goes first. Settles this Responsibility's Make-up Turns."
          disabled={busy || queue.length < 2}
          onPress={() => {
            setError(null);
            setConfirm('rebalance');
          }}
        />
        <ActionRow
          icon={Trash2}
          label="Remove Responsibility"
          destructive
          disabled={busy}
          onPress={() => {
            setError(null);
            setConfirm('remove');
          }}
        />
      </SettingsList>

      <ConfirmSheet
        visible={confirm === 'rebalance'}
        title={`Rebalance ${r.name}?`}
        message={`The Rotation is reordered by workload: whoever has served least goes first. ${
          owed > 0
            ? `${owed} outstanding Make-up ${owed === 1 ? 'Turn is' : 'Turns are'} settled, so nobody owes a turn for ${r.name} anymore.`
            : `Any outstanding Make-up Turns for ${r.name} are settled.`
        } Upcoming turns may move, and anyone whose turn changes is asked to confirm again. This is recorded in the schedule history.`}
        confirmLabel="Rebalance"
        loading={busy}
        error={error}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === 'remove'}
        title={`Remove ${r.name}?`}
        message={`${r.name} won't be needed at any upcoming Event, so its future seats go away and the people assigned are freed up. Past Events keep their history. Its Make-up Turns are cancelled.`}
        confirmLabel="Remove Responsibility"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
    </FormScreen>
  );
}

function ViewResponsibility({ group, responsibilityId }: { group: GroupDetails; responsibilityId: string }) {
  const { space } = useTheme();
  const r = group.state.responsibilities.find((x) => x.id === responsibilityId)!;
  const queue = rotationQueue(group.state, r.id);
  return (
    <FormScreen onBack={() => back(group.id)} title={r.name} lead="Only Admins can change Responsibilities.">
      <SettingsList>
        <InfoRow icon={Users} label="People needed at each Event" value={String(r.headcount)} />
        <InfoRow icon={BellRing} label="Needs confirmation" value={r.requiresConfirmation ? 'Yes' : 'No'} />
        {group.state.primaryResponsibilityId === r.id ? <InfoRow icon={Star} label="Primary Responsibility" value="Yes" /> : null}
      </SettingsList>
      <View style={{ gap: space.sm }}>
        <FieldLabel>Rotation: who is next</FieldLabel>
        {queue.length === 0 ? (
          <Text variant="subhead" color="textSecondary">
            Nobody is on the {r.name} team yet.
          </Text>
        ) : (
          <ReorderList
            items={queue.map((q, i) => ({ key: q.memberId, label: q.name, description: i === 0 ? 'Next up' : undefined }))}
          />
        )}
      </View>
    </FormScreen>
  );
}
