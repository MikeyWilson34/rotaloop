import { router } from 'expo-router';
import { CalendarOff, ChevronLeft, Route, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TimeOffCalendar } from '@/components/timeOff/TimeOffCalendar';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  ConfirmSheet,
  FieldLabel,
  IconTile,
  InfoNote,
  Notice,
  SegmentedControl,
  showToast,
  Text,
  TextField,
} from '@/components/ui';
import { deviceTimeZone } from '@/lib/groupViews';
import { outcomeErrors, removeTimeOff, saveTimeOff, useMyGroupStates } from '@/lib/timeOff';
import { dateIn, zoneCity } from '@/schedule/format';
import {
  myResponsibilityNames,
  newBatchId,
  rangeDates,
  REPEAT_OPTIONS,
  savedToast,
  saveLabel,
  servingDates,
  timeOffDates,
  timeOffItems,
  timeOffPlan,
  timeOffPreview,
  toggleDate,
  toggleScope,
  type RepeatChoice,
  type TimeOffItem,
  type TimeOffScope,
} from '@/schedule/timeOff';
import { monthGrid, monthOf, shiftMonth } from '@/schedule/views';
import { useTheme } from '@/theme';

const MODES = [
  { value: 'single', label: 'Single days' },
  { value: 'range', label: 'Date range' },
] as const;
type Mode = (typeof MODES)[number]['value'];

/** How far ahead the calendar goes. */
const MONTHS_AHEAD = 12;

/**
 * Dates off (prototype `screenAvailability`): pick single days or a range on a month calendar,
 * choose a repeat, which jobs it applies to and a note, see what saving would
 * change, then save it to each of the person's Groups. Below, "Your dates off" with remove.
 */
export default function TimeOffScreen() {
  const { colors, fonts, space, minTapTarget } = useTheme();
  const { data, loading, error, refresh, reload, refreshing } = useMyGroupStates();
  const [viewerTimeZone] = useState(deviceTimeZone);
  const now = useMemo(() => new Date().toISOString(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dateIn(now, viewerTimeZone);

  const [mode, setMode] = useState<Mode>('single');
  const [month, setMonth] = useState(monthOf(today));
  const [dates, setDates] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<RepeatChoice>('none');
  const [scope, setScope] = useState<TimeOffScope>('all');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TimeOffItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const groups = useMemo(() => data ?? [], [data]);
  const draft = useMemo(() => ({ dates, repeat, scope, note }), [dates, repeat, scope, note]);
  const plan = useMemo(() => timeOffPlan(draft, groups, 'preview'), [draft, groups]);
  const preview = useMemo(() => timeOffPreview(plan, now, viewerTimeZone), [plan, now, viewerTimeZone]);
  const items = useMemo(() => timeOffItems(groups, now), [groups, now]);
  const names = useMemo(() => myResponsibilityNames(groups), [groups]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const off = useMemo(
    () => timeOffDates(groups, grid[0].date, grid[grid.length - 1].date, now),
    [groups, grid, now],
  );
  const serving = useMemo(() => servingDates(groups, viewerTimeZone, now), [groups, viewerTimeZone, now]);

  const firstMonth = monthOf(today);
  const lastMonth = shiftMonth(firstMonth, MONTHS_AHEAD);
  const selected = new Set(dates);
  const otherZones = [...new Set(groups.map((g) => g.timeZone).filter((z) => z !== viewerTimeZone))];

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function pick(date: string) {
    setSaveError(null);
    if (mode === 'single') {
      setDates((d) => toggleDate(d, date));
    } else if (!rangeStart) {
      setRangeStart(date);
      setDates([date]);
    } else {
      setDates(rangeDates(rangeStart, date));
      setRangeStart(null);
    }
  }

  function clear() {
    setDates([]);
    setRangeStart(null);
    setSaveError(null);
  }

  async function save() {
    if (saving || plan.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const outcomes = await saveTimeOff(timeOffPlan(draft, groups, newBatchId()));
    const message = outcomeErrors(outcomes, 'save');
    await reload();
    setSaving(false);
    if (outcomes.some((o) => !o.error)) {
      showToast(savedToast(preview), Route);
      clear();
      setRepeat('none');
      setNote('');
    }
    setSaveError(message);
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    const outcomes = await removeTimeOff(removing.entries, groups);
    const message = outcomeErrors(outcomes, 'remove');
    await reload();
    setRemoveBusy(false);
    if (message) {
      setRemoveError(message);
      return;
    }
    setRemoving(null);
    showToast('Dates off removed.', Trash2);
  }

  const topBar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, minHeight: 56 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={back}
        style={{ width: minTapTarget, height: minTapTarget, alignItems: 'center', justifyContent: 'center' }}>
        <ChevronLeft size={26} color={colors.text} strokeWidth={1.75} />
      </Pressable>
      <Text
        accessibilityRole="header"
        style={{ flex: 1, textAlign: 'center', fontFamily: fonts.extrabold, fontSize: 17, lineHeight: 22 }}>
        Dates off
      </Text>
      <View style={{ width: minTapTarget }} />
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator color={colors.primary} style={{ paddingVertical: space.huge }} />;
  } else if (error) {
    body = (
      <View style={{ gap: space.md }}>
        <Notice>{error}</Notice>
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  } else if (groups.length === 0) {
    body = (
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xxl }}>
        <IconTile icon={CalendarOff} size={48} bg="primaryTint" fg="primary" />
        <Text variant="title3" style={{ textAlign: 'center' }}>
          {"You're not in a group yet"}
        </Text>
        <Text color="textSecondary" style={{ textAlign: 'center' }}>
          Join or start a group, then mark the days you can’t serve here.
        </Text>
        <Button label="Go to Groups" variant="secondary" onPress={() => router.replace('/groups')} />
      </Card>
    );
  } else {
    const single = preview.lines.length === 1;
    const multiGroup = groups.length > 1;
    body = (
      <>
        <InfoNote icon={Route}>
          <Text variant="subhead">
            Mark days you can’t serve. We route around them: the next person in line takes your turn, and you keep your
            place at the front.
          </Text>
        </InfoNote>
        <SegmentedControl
          accessibilityLabel="How to pick days"
          options={MODES}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setRangeStart(null);
          }}
        />
        <TimeOffCalendar
          month={month}
          today={today}
          selected={selected}
          rangeStart={rangeStart}
          off={off}
          serving={serving}
          onPick={pick}
          onPrev={month > firstMonth ? () => setMonth(shiftMonth(month, -1)) : null}
          onNext={month < lastMonth ? () => setMonth(shiftMonth(month, 1)) : null}
          hint={
            mode === 'range'
              ? rangeStart
                ? 'Now tap the last day of the range.'
                : 'Tap the first day, then the last day.'
              : undefined
          }
        />
        {otherZones.length ? (
          <Text variant="caption" color="textSecondary">
            {`Days count in each group's own time zone (${otherZones.map(zoneCity).join(', ')}).`}
          </Text>
        ) : null}

        <View style={{ gap: space.sm }}>
          <FieldLabel>Repeat</FieldLabel>
          <ChipGroup>
            {REPEAT_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} selected={repeat === o.value} onPress={() => setRepeat(o.value)} />
            ))}
          </ChipGroup>
          {repeat === 'monthly' ? (
            <Text variant="caption" color="textSecondary">
              Saved for the next 12 months, each as its own entry.
            </Text>
          ) : repeat !== 'none' ? (
            <Text variant="caption" color="textSecondary">
              Repeats until you remove it.
            </Text>
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <FieldLabel>Applies to</FieldLabel>
          <ChipGroup>
            <Chip label="All jobs" selected={scope === 'all'} onPress={() => setScope('all')} />
            {names.map((n) => (
              <Chip
                key={n}
                label={n}
                selected={scope !== 'all' && scope.includes(n)}
                onPress={() => setScope((s) => toggleScope(s, n))}
              />
            ))}
          </ChipGroup>
        </View>

        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Family trip"
          maxLength={200}
          returnKeyType="done"
        />

        {dates.length > 0 && preview.lines.length > 0 ? (
          <InfoNote icon={Route} tone="warn">
            <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
              {`You’re scheduled on ${single ? 'this day' : 'these days'}. Saving will:`}
            </Text>
            {preview.lines.map((line) => (
              <Text key={line.key} variant="subhead">
                <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
                  {`• ${line.title}${multiGroup ? ` (${line.groupName})` : ''}: `}
                </Text>
                {line.text}
              </Text>
            ))}
            <Text variant="caption">Everyone affected is notified and asked to confirm again.</Text>
          </InfoNote>
        ) : dates.length > 0 && plan.length > 0 && preview.refused.length === 0 ? (
          <InfoNote icon={Route} tone="ok">
            <Text variant="subhead">You’re not scheduled on these days. Saving keeps future turns off them.</Text>
          </InfoNote>
        ) : null}
        {dates.length > 0 && plan.length === 0 ? (
          <Notice tone="info">None of your groups has those jobs. Pick All jobs or another job.</Notice>
        ) : null}
        {preview.refused.length > 0 ? (
          <Notice>{`These dates off can't be added in ${preview.refused.map((r) => r.groupName).join(', ')}. Pull down to refresh, then try again.`}</Notice>
        ) : null}
        {saveError ? <Notice>{saveError}</Notice> : null}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Clear" variant="secondary" disabled={dates.length === 0 || saving} onPress={clear} style={{ flex: 1 }} />
          <Button
            label={saveLabel(draft)}
            disabled={plan.length === 0 || preview.refused.length > 0}
            loading={saving}
            onPress={save}
            style={{ flex: 2 }}
          />
        </View>

        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <FieldLabel>Your dates off</FieldLabel>
          {items.length === 0 ? (
            <Card>
              <Text color="textSecondary" style={{ textAlign: 'center' }}>
                No dates off yet
              </Text>
            </Card>
          ) : (
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
                      setRemoveError(null);
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
          )}
        </View>
        <ConfirmSheet
          visible={removing !== null}
          title="Remove these dates off?"
          message={`${removing?.label ?? ''}. You can be scheduled on these days again. `}
          confirmLabel="Remove"
          tone="destructive"
          loading={removeBusy}
          error={removeError}
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      </>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {topBar}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.huge, gap: space.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
