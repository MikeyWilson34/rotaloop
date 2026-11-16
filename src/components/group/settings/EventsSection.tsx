import { router } from 'expo-router';
import { CalendarClock, CalendarPlus, Plus, Repeat } from 'lucide-react-native';
import { useState } from 'react';

import {
  ActionRow,
  Button,
  Chip,
  ChipGroup,
  ConfirmSheet,
  FieldLabel,
  InfoRow,
  Notice,
  SettingsList,
  Sheet,
  Text,
  TextField,
  ValueRow,
} from '@/components/ui';
import type { GroupDetails } from '@/lib/groups';
import {
  andList,
  newId,
  responsibilityViews,
  seriesViews,
  todayIn,
  upcomingOneOffEvents,
  validateOneOffForm,
  type OneOffView,
} from '@/lib/groupSetup';
import { formatEventTime, timeZoneLabel } from '@/lib/groupViews';
import { useTheme } from '@/theme';

import type { RunCommand } from '../MemberActionsSheet';

export function openSeries(groupId: string, seriesId: string) {
  router.push({ pathname: '/group/[groupId]/series/[seriesId]', params: { groupId, seriesId } });
}

/** Settings → Events: the Event Series and upcoming one-off Events. */
export function EventsSection({ group, isAdmin, run }: { group: GroupDetails; isAdmin: boolean; run: RunCommand }) {
  const now = new Date();
  const series = seriesViews(group.state, group.timeZone);
  const oneOffs = upcomingOneOffEvents(group.state, now);
  const [addingOneOff, setAddingOneOff] = useState(false);
  const [removing, setRemoving] = useState<OneOffView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeOneOff() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'removeEvent', eventId: removing.id }, 'removeEvent');
    setBusy(false);
    if (failed) setError(failed);
    else setRemoving(null);
  }

  return (
    <>
      <FieldLabel>Event Series</FieldLabel>
      <SettingsList>
        {series.map((s) => (
          <ValueRow
            key={s.id}
            icon={Repeat}
            label={s.name}
            description={`${s.description}${s.responsibilityNames.length ? ` · ${andList(s.responsibilityNames)}` : ''}`}
            onPress={() => openSeries(group.id, s.id)}
          />
        ))}
        {isAdmin ? <ActionRow icon={Plus} label="Add Event Series" onPress={() => openSeries(group.id, 'new')} /> : null}
      </SettingsList>
      {series.length === 0 ? (
        <Text variant="subhead" color="textSecondary">
          {isAdmin
            ? 'An Event Series creates your Events, like every Sunday at 9:00 AM. Events are kept about 12 weeks ahead.'
            : "Your Admins haven't set when Events happen yet."}
        </Text>
      ) : null}

      <FieldLabel>One-off Events</FieldLabel>
      <SettingsList>
        {oneOffs.map((e) =>
          isAdmin ? (
            <ActionRow
              key={e.id}
              icon={CalendarClock}
              label={formatEventTime(e.startsAt, group.timeZone)}
              description={`${andList(e.responsibilityNames)} · Tap to remove`}
              onPress={() => {
                setError(null);
                setRemoving(e);
              }}
            />
          ) : (
            <InfoRow
              key={e.id}
              icon={CalendarClock}
              label={formatEventTime(e.startsAt, group.timeZone)}
              description={andList(e.responsibilityNames)}
            />
          ),
        )}
        {isAdmin ? (
          <ActionRow
            icon={CalendarPlus}
            label="Add a one-off Event"
            description="A single Event outside any series."
            onPress={() => setAddingOneOff(true)}
          />
        ) : null}
        {!isAdmin && oneOffs.length === 0 ? <InfoRow icon={CalendarClock} label="No one-off Events coming up" /> : null}
      </SettingsList>

      {addingOneOff ? <OneOffSheet group={group} run={run} onClose={() => setAddingOneOff(false)} /> : null}
      <ConfirmSheet
        visible={removing !== null}
        title="Remove this Event?"
        message={
          removing
            ? `${formatEventTime(removing.startsAt, group.timeZone)} comes off the schedule. Anyone assigned to it is freed up, and their turns move to the next Event in their Rotation.`
            : ''
        }
        confirmLabel="Remove Event"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={removeOneOff}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

function OneOffSheet({ group, run, onClose }: { group: GroupDetails; run: RunCommand; onClose: () => void }) {
  const { space } = useTheme();
  const responsibilities = responsibilityViews(group.state);
  const [date, setDate] = useState(() => todayIn(group.timeZone, new Date()));
  const [time, setTime] = useState('6:00 PM');
  const [picked, setPicked] = useState<string[]>(() => responsibilities.map((r) => r.id));
  const [errors, setErrors] = useState<Partial<Record<'date' | 'time' | 'responsibilities', string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const result = validateOneOffForm(
      { date, time, responsibilityIds: picked },
      group.timeZone,
      new Date(),
      responsibilities.map((r) => r.id),
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    const id = newId('e', group.state.events.map((e) => e.id));
    const failed = await run(
      { type: 'addEvents', events: [{ id, seriesId: null, startsAt: result.value.startsAt, responsibilityIds: result.value.responsibilityIds }] },
      'addEvent',
    );
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Sheet
      visible
      busy={busy}
      onClose={onClose}
      overline={group.name}
      title="Add a one-off Event"
      message={`Times are in ${timeZoneLabel(group.timeZone).split(' · ')[0]} time.`}
      footer={
        <>
          <Button label="Add Event" size="lg" loading={busy} onPress={add} />
          <Button label="Cancel" variant="quiet" disabled={busy} onPress={onClose} />
        </>
      }>
      <TextField
        label="Date"
        value={date}
        onChangeText={setDate}
        error={errors.date}
        hint="Year-month-day, e.g. 2026-12-05"
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="numeric"
      />
      <TextField
        label="Start time"
        value={time}
        onChangeText={setTime}
        error={errors.time}
        hint="e.g. 6:30 PM or 18:30"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FieldLabel>Responsibilities needed</FieldLabel>
      {responsibilities.length === 0 ? (
        <Text variant="subhead" color="textSecondary">
          Add a Responsibility first.
        </Text>
      ) : (
        <ChipGroup>
          {responsibilities.map((r) => (
            <Chip
              key={r.id}
              label={r.name}
              selected={picked.includes(r.id)}
              onPress={() => setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))}
            />
          ))}
        </ChipGroup>
      )}
      {errors.responsibilities ? (
        <Text variant="subhead" color="dangerText" style={{ marginTop: -space.xs }}>
          {errors.responsibilities}
        </Text>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
