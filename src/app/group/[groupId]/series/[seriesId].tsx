import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Globe, Repeat, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { TimeZoneSheet } from '@/components/TimeZoneSheet';
import {
  ActionRow,
  Button,
  Card,
  Chip,
  ChipGroup,
  ConfirmSheet,
  FieldLabel,
  FormScreen,
  InfoRow,
  Notice,
  SettingsList,
  Text,
  TextField,
  ValueRow,
} from '@/components/ui';
import type { EventSeries } from '@/engine';
import { formatEventTime, myMember, timeZoneLabel } from '@/lib/groupViews';
import { useGroup, useRunCommand, type GroupDetails } from '@/lib/groups';
import {
  andList,
  describeRepeat,
  FREQUENCY_OPTIONS,
  NAME_MAX,
  newId,
  newSeriesForm,
  patternFromForm,
  previewInstants,
  responsibilityViews,
  seriesEdit,
  seriesFormFrom,
  validateSeriesForm,
  WEEK_OF_MONTH_OPTIONS,
  WEEKDAY_SHORT,
  type SeriesField,
  type SeriesForm,
} from '@/lib/groupSetup';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

type RunCommand = ReturnType<typeof useRunCommand>;

const PREVIEW_COUNT = 4;

function back(groupId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/group/[groupId]', params: { groupId, tab: 'settings' } });
}

/**
 * An Event Series: add or edit its name, repeat pattern, time, time zone, start date and
 * Responsibilities, with a preview of the next dates; or remove it. Members see it read-only.
 * `seriesId` "new" adds one.
 */
export default function SeriesScreen() {
  const { groupId, seriesId } = useLocalSearchParams<{ groupId: string; seriesId: string }>();
  const { colors, space } = useTheme();
  const { session } = useSession();
  const { data, loading, error, refresh, reload } = useGroup(groupId);
  const run = useRunCommand(groupId, reload);

  const isNew = seriesId === 'new';
  const me = data ? myMember(data.state, session?.user.id ?? null) : undefined;
  const series = data?.state.eventSeries.find((s) => s.id === seriesId && s.removedAt === null);

  if (loading || !data) {
    return (
      <FormScreen onBack={() => back(groupId)} title={isNew ? 'Add Event Series' : 'Event Series'}>
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
  if (!me || (!isNew && !series) || (isNew && !me.isAdmin)) {
    return (
      <FormScreen onBack={() => back(groupId)} title="Event Series">
        <Notice>{"This Event Series isn't in the group anymore."}</Notice>
        <Button label="Back" variant="secondary" onPress={() => back(groupId)} />
      </FormScreen>
    );
  }
  if (!me.isAdmin) return <ViewSeries group={data} series={series!} />;
  return <SeriesEditor key={series?.id ?? 'new'} group={data} series={series ?? null} run={run} />;
}

function SeriesEditor({ group, series, run }: { group: GroupDetails; series: EventSeries | null; run: RunCommand }) {
  const { space } = useTheme();
  const [form, setForm] = useState<SeriesForm>(() =>
    series ? seriesFormFrom(series, group.state, group.timeZone, new Date()) : newSeriesForm(group.state, group.timeZone, new Date()),
  );
  const [errors, setErrors] = useState<Partial<Record<SeriesField, string>>>({});
  const [pickingZone, setPickingZone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'remove' | 'move' | null>(null);

  const responsibilities = responsibilityViews(group.state);
  const activeIds = responsibilities.map((r) => r.id);
  const pattern = useMemo(() => patternFromForm(form), [form]);
  const preview = useMemo(() => (pattern ? previewInstants(pattern, new Date(), PREVIEW_COUNT) : []), [pattern]);
  const validated = validateSeriesForm(form, activeIds);
  const edit = series && validated.ok ? seriesEdit(series, validated.value) : null;

  const update = (patch: Partial<SeriesForm>, field?: SeriesField) => {
    setForm((f) => ({ ...f, ...patch }));
    if (field) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const toggle = (list: number[] | string[], value: number | string) =>
    (list as (number | string)[]).includes(value)
      ? (list as (number | string)[]).filter((x) => x !== value)
      : [...(list as (number | string)[]), value];

  async function submit(skipConfirm = false) {
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    if (series && edit?.movesEvents && !skipConfirm) {
      setError(null);
      setConfirm('move');
      return;
    }
    setBusy(true);
    setError(null);
    const failed = series
      ? edit
        ? await run({ type: 'editEventSeries', seriesId: series.id, changes: edit.changes }, 'saveSeries')
        : null
      : await run(
          {
            type: 'addEventSeries',
            series: { id: newId('s', group.state.eventSeries.map((s) => s.id)), ...validated.value },
          },
          'saveSeries',
        );
    setBusy(false);
    if (failed) setError(failed);
    else back(group.id);
  }

  async function remove() {
    if (!series) return;
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'removeEventSeries', seriesId: series.id }, 'removeSeries');
    setBusy(false);
    if (failed) setError(failed);
    else back(group.id);
  }

  return (
    <FormScreen
      onBack={() => back(group.id)}
      title={series ? series.name : 'Add Event Series'}
      lead={
        series
          ? 'Events are kept about 12 weeks ahead and filled from each Rotation.'
          : 'When your Events happen. They are created about 12 weeks ahead and filled from each Rotation.'
      }
      footer={
        <Button
          label={series ? 'Save changes' : 'Add Event Series'}
          size="lg"
          loading={busy && confirm === null}
          disabled={busy || (series !== null && edit === null && validated.ok)}
          onPress={() => submit()}
        />
      }>
      <TextField
        label="Name"
        value={form.name}
        onChangeText={(name) => update({ name }, 'name')}
        error={errors.name}
        placeholder="e.g. Sunday mornings, Practice, Game night"
        maxLength={NAME_MAX}
        autoCapitalize="sentences"
      />

      <View style={{ gap: space.sm }}>
        <FieldLabel>Repeats</FieldLabel>
        <ChipGroup>
          {FREQUENCY_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} selected={form.frequency === o.value} onPress={() => update({ frequency: o.value })} />
          ))}
        </ChipGroup>
      </View>

      {form.frequency === 'custom' ? (
        <TextField
          label="Every how many weeks"
          value={form.intervalWeeks}
          onChangeText={(intervalWeeks) => update({ intervalWeeks: intervalWeeks.replace(/[^0-9]/g, '') }, 'interval')}
          error={errors.interval}
          inputMode="numeric"
          maxLength={2}
          hint="e.g. 3 for every third week"
        />
      ) : null}

      {form.frequency === 'monthly' ? (
        <View style={{ gap: space.sm }}>
          <FieldLabel>Which week of the month</FieldLabel>
          <ChipGroup>
            {WEEK_OF_MONTH_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} selected={form.weekOfMonth === o.value} onPress={() => update({ weekOfMonth: o.value })} />
            ))}
          </ChipGroup>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <FieldLabel>{form.frequency === 'monthly' ? 'On' : 'Days'}</FieldLabel>
        <ChipGroup>
          {WEEKDAY_SHORT.map((label, day) => (
            <Chip
              key={label}
              label={label}
              selected={form.daysOfWeek.includes(day)}
              onPress={() => update({ daysOfWeek: (toggle(form.daysOfWeek, day) as number[]).sort((a, b) => a - b) }, 'days')}
            />
          ))}
        </ChipGroup>
        {errors.days ? (
          <Text variant="subhead" color="dangerText">
            {errors.days}
          </Text>
        ) : null}
      </View>

      <TextField
        label="Start time"
        value={form.time}
        onChangeText={(time) => update({ time }, 'time')}
        error={errors.time}
        hint="e.g. 9:00 AM or 18:30"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <SettingsList>
        <ValueRow
          icon={Globe}
          label="Time zone"
          description="Events stay at this local time, even when the clocks change."
          value={timeZoneLabel(form.timeZone).split(' · ')[0]}
          onPress={() => setPickingZone(true)}
        />
      </SettingsList>
      {errors.timeZone ? (
        <Text variant="subhead" color="dangerText">
          {errors.timeZone}
        </Text>
      ) : null}
      <TextField
        label="Starts on"
        value={form.startsOn}
        onChangeText={(startsOn) => update({ startsOn }, 'startsOn')}
        error={errors.startsOn}
        hint="Year-month-day, e.g. 2026-11-22"
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="numeric"
      />

      <View style={{ gap: space.sm }}>
        <FieldLabel>Responsibilities these Events need</FieldLabel>
        {responsibilities.length === 0 ? (
          <Text variant="subhead" color="textSecondary">
            Add a Responsibility first, from Settings.
          </Text>
        ) : (
          <ChipGroup>
            {responsibilities.map((r) => (
              <Chip
                key={r.id}
                label={r.name}
                selected={form.responsibilityIds.includes(r.id)}
                onPress={() => update({ responsibilityIds: toggle(form.responsibilityIds, r.id) as string[] }, 'responsibilities')}
              />
            ))}
          </ChipGroup>
        )}
        {errors.responsibilities ? (
          <Text variant="subhead" color="dangerText">
            {errors.responsibilities}
          </Text>
        ) : null}
      </View>

      <PreviewCard pattern={pattern ? describeRepeat(pattern) : null} instants={preview} timeZone={form.timeZone} />

      {edit?.movesEvents ? (
        <Notice tone="info">
          {"Changing the days or time moves this series' upcoming Events. People's turns follow them to the new dates, and they'll be asked to confirm again."}
        </Notice>
      ) : null}
      {error && confirm === null ? <Notice>{error}</Notice> : null}

      {series ? (
        <SettingsList>
          <ActionRow
            icon={Trash2}
            label="Remove Event Series"
            destructive
            disabled={busy}
            onPress={() => {
              setError(null);
              setConfirm('remove');
            }}
          />
        </SettingsList>
      ) : null}

      <TimeZoneSheet
        visible={pickingZone}
        value={form.timeZone}
        onClose={() => setPickingZone(false)}
        onPick={(timeZone) => {
          update({ timeZone }, 'timeZone');
          setPickingZone(false);
        }}
      />
      <ConfirmSheet
        visible={confirm === 'move'}
        title="Move the upcoming Events?"
        message={`From now on this series runs ${pattern ? describeRepeat(pattern).replace(/^E/, 'e') : 'on the new pattern'}. Upcoming Events that no longer fit are replaced. People's turns follow them to the new dates, and they'll be asked to confirm again. Past Events don't change.`}
        confirmLabel="Move Events"
        loading={busy}
        error={error}
        onConfirm={() => submit(true).then(() => setConfirm(null))}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === 'remove'}
        title={`Remove ${series?.name ?? 'this series'}?`}
        message="Its upcoming Events come off the schedule and the people assigned are freed up. Past Events stay in the history."
        confirmLabel="Remove Event Series"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </FormScreen>
  );
}

function PreviewCard({ pattern, instants, timeZone }: { pattern: string | null; instants: string[]; timeZone: string }) {
  const { space, colors } = useTheme();
  return (
    <Card style={{ gap: space.sm }} accessibilityLabel="Preview of the next dates">
      <Text variant="overline" color="textSecondary">
        Next dates
      </Text>
      {pattern ? <Text variant="callout">{pattern}</Text> : null}
      {instants.length > 0 ? (
        instants.map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <CalendarDays size={18} strokeWidth={1.75} color={colors.textSecondary} />
            <Text variant="subhead">{formatEventTime(i, timeZone)}</Text>
          </View>
        ))
      ) : (
        <Text variant="subhead" color="textSecondary">
          {pattern ? 'No dates coming up. Check the start date.' : 'Pick at least one day, a time and a start date to see the dates.'}
        </Text>
      )}
    </Card>
  );
}

function ViewSeries({ group, series }: { group: GroupDetails; series: EventSeries }) {
  const { space } = useTheme();
  const names = series.responsibilityIds.flatMap((id) => {
    const r = group.state.responsibilities.find((x) => x.id === id && x.removedAt === null);
    return r ? [r.name] : [];
  });
  const upcoming = series.repeat ? previewInstants(series.repeat, new Date(), PREVIEW_COUNT) : [];
  return (
    <FormScreen onBack={() => back(group.id)} title={series.name} lead="Only Admins can change Event Series.">
      <SettingsList>
        <InfoRow icon={Repeat} label="Repeats" description={series.repeat ? describeRepeat(series.repeat) : 'No repeat pattern'} />
        {series.repeat ? (
          <InfoRow icon={Globe} label="Time zone" value={timeZoneLabel(series.repeat.timeZone).split(' · ')[0]} />
        ) : null}
        <InfoRow icon={CalendarDays} label="Responsibilities" description={andList(names) || 'None'} />
      </SettingsList>
      {series.repeat ? (
        <View style={{ gap: space.sm }}>
          <PreviewCard pattern={null} instants={upcoming} timeZone={series.repeat.timeZone} />
        </View>
      ) : null}
    </FormScreen>
  );
}
