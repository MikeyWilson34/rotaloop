import { ArrowRight, Bell, CalendarX, Repeat } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Hatch } from '@/components/schedule/parts';
import {
  Button,
  Chip,
  ChipGroup,
  FieldLabel,
  InfoNote,
  Notice,
  Sheet,
  showToast,
  StatusPill,
  Text,
  TextField,
} from '@/components/ui';
import { deviceTimeZone } from '@/lib/groupViews';
import type { GroupDetails } from '@/lib/groups';
import { scheduleGroupOf } from '@/lib/schedule';
import { formatDayLong, formatDayShort } from '@/schedule/format';
import {
  affectedLabel,
  MAX_SKIP_REASON_LENGTH,
  SKIP_REASONS,
  skipCandidates,
  skipPreview,
  skipReasonText,
  type SkipPreviewEvent,
  type SkipReason,
} from '@/schedule/skipDate';
import { useTheme } from '@/theme';

import type { RunCommand } from '../group/MemberActionsSheet';

/**
 * Adding a Skip Date (prototype `skipSheet`), open to any Member: 1. pick an upcoming Event,
 * 2. a reason, 3. the before/after preview (the engine's `addSkipDate` run on the loaded state,
 * nothing saved), then confirm.
 */
export function SkipDateSheet({
  visible,
  onClose,
  group,
  accountId,
  isAdmin,
  run,
}: {
  visible: boolean;
  onClose: () => void;
  group: GroupDetails;
  accountId: string | null;
  isAdmin: boolean;
  run: RunCommand;
}) {
  const [step, setStep] = useState(1);
  const [eventId, setEventId] = useState<string | null>(null);
  const [chip, setChip] = useState<SkipReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  // Start over each time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setStep(1);
      setEventId(null);
      setChip(null);
      setDetails('');
      setError(null);
    }
  }

  const viewerTimeZone = deviceTimeZone();
  const now = useMemo(() => new Date().toISOString(), [group, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleGroup = useMemo(() => scheduleGroupOf(group, accountId), [group, accountId]);
  const candidates = useMemo(() => skipCandidates(scheduleGroup, now, viewerTimeZone), [scheduleGroup, now, viewerTimeZone]);
  const picked = candidates.find((c) => c.eventId === eventId) ?? null;
  const reason = skipReasonText(chip, details);
  const preview = useMemo(
    () => (step === 3 && eventId ? skipPreview(scheduleGroup, eventId, reason, now, viewerTimeZone) : null),
    [step, eventId, scheduleGroup, reason, now, viewerTimeZone],
  );

  async function confirm() {
    if (!eventId || !picked || busy) return;
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'addSkipDate', eventId, reason }, 'addSkipDate');
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
    const affected = preview?.ok ? ` ${affectedLabel(preview.affected)}.` : '';
    showToast(`${formatDayShort(picked.date)} is a Skip Date.${affected}`, CalendarX);
  }

  const overline =
    step === 1
      ? `Step 1 of 3 · ${group.name}`
      : step === 2
        ? `Step 2 of 3 · ${picked ? formatDayShort(picked.date) : ''}`
        : 'Step 3 of 3 · Preview';
  const title = step === 1 ? 'Which Event needs no one?' : step === 2 ? 'Why is it skipped?' : 'Here’s what changes';
  const message =
    step === 1
      ? 'Holidays, closures, special events.'
      : step === 2
        ? 'Shown to everyone affected and saved in the schedule history.'
        : undefined;

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (step === 1) {
    body = candidates.length ? (
      <View style={{ gap: 8 }}>
        {candidates.map((c) => (
          <OptionRow
            key={c.eventId}
            selected={c.eventId === eventId}
            title={formatDayLong(c.date)}
            caption={c.who}
            onPress={() => setEventId(c.eventId)}
          />
        ))}
      </View>
    ) : (
      <Notice tone="info">There are no upcoming Events to skip.</Notice>
    );
    footer = (
      <>
        <Button label="Next" size="lg" disabled={!picked} onPress={() => setStep(2)} />
        <Button label="Cancel" variant="quiet" onPress={onClose} />
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <View style={{ gap: 8 }}>
          <FieldLabel>Reason</FieldLabel>
          <ChipGroup>
            {SKIP_REASONS.map((r) => (
              <Chip key={r} label={r} selected={chip === r} onPress={() => setChip(r)} />
            ))}
          </ChipGroup>
        </View>
        <TextField
          label="Details (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="e.g. Building closed for the holiday"
          multiline
          numberOfLines={3}
          maxLength={MAX_SKIP_REASON_LENGTH - 20}
          style={{ minHeight: 88, textAlignVertical: 'top' }}
        />
        <InfoNote icon={Bell}>
          <Text variant="subhead">
            {`Everyone whose date moves will be notified and asked to confirm again.${
              isAdmin ? '' : ' Admins aren’t notified separately; it shows in the schedule history.'
            }`}
          </Text>
        </InfoNote>
      </>
    );
    footer = (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Back" size="lg" variant="secondary" onPress={() => setStep(1)} style={{ flex: 1 }} />
        <Button label="Preview changes" size="lg" disabled={!chip} onPress={() => setStep(3)} style={{ flex: 2 }} />
      </View>
    );
  } else {
    body =
      preview && preview.ok && picked ? (
        <>
          <InfoNote icon={Repeat}>
            <Text variant="subhead">
              {'Nobody serves on '}
              <Strong>{formatDayShort(picked.date)}</Strong>
              {'. Everyone from then on moves forward one Event, so '}
              <Strong>no turn is used up</Strong>
              {`. ${affectedLabel(preview.affected)}.`}
            </Text>
          </InfoNote>
          <View style={{ gap: 10 }}>
            {preview.events.map((e) => (
              <PreviewCard key={e.eventId} event={e} />
            ))}
          </View>
          <Text variant="caption" color="textSecondary">
            Later Events continue the same pattern. Anyone in the group can remove the Skip Date later to restore the
            Rotation.
          </Text>
          {error ? <Notice>{error}</Notice> : null}
        </>
      ) : (
        <Notice>{"This Event can't be skipped anymore. Pull down to refresh, then try again."}</Notice>
      );
    footer = (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Back" size="lg" variant="secondary" disabled={busy} onPress={() => setStep(2)} style={{ flex: 1 }} />
        <Button
          label="Add Skip Date"
          size="lg"
          loading={busy}
          disabled={!preview?.ok}
          onPress={confirm}
          style={{ flex: 2 }}
        />
      </View>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} busy={busy} closeLabel="Cancel" footer={footer}>
      <StepBar step={step} />
      <View style={{ gap: 4 }}>
        <Text variant="overline" color="textSecondary">
          {overline}
        </Text>
        <Text variant="title2" accessibilityRole="header">
          {title}
        </Text>
        {message ? <Text color="textSecondary">{message}</Text> : null}
      </View>
      {body}
    </Sheet>
  );
}

function Strong({ children }: { children: string }) {
  const { fonts } = useTheme();
  return <Text style={{ fontFamily: fonts.extrabold }}>{children}</Text>;
}

/** The three-step progress bar (prototype `.steps`). */
function StepBar({ step }: { step: number }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`Step ${step} of 3`} style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.primary : colors.border }} />
      ))}
    </View>
  );
}

/** A radio option row (prototype `.opt`). */
function OptionRow({ selected, title, caption, onPress }: { selected: boolean; title: string; caption: string; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={`${title}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primaryTint : 'transparent',
        opacity: pressed ? 0.85 : 1,
      })}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? colors.primary : colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
          {title}
        </Text>
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

/** "You" is highlighted (prototype `.me-hl`). */
function Who({ label, old }: { label: string | null; old?: boolean }) {
  const { colors, fonts } = useTheme();
  const text = label ?? '—';
  const me = label === 'You';
  return (
    <Text
      numberOfLines={1}
      style={{
        flexShrink: 1,
        minWidth: 0,
        fontSize: 14,
        lineHeight: 20,
        fontFamily: old ? fonts.regular : fonts.extrabold,
        color: old ? colors.textTertiary : me ? colors.warningText : colors.text,
        textDecorationLine: old ? 'line-through' : 'none',
        backgroundColor: me && !old ? colors.warningTint : 'transparent',
        borderRadius: 6,
        paddingHorizontal: me && !old ? 4 : 0,
      }}>
      {text}
    </Text>
  );
}

/** One Event of the preview: its rows before → after (prototype `.diff`). */
function PreviewCard({ event }: { event: SkipPreviewEvent }) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View
      style={{
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: radii.lg,
        borderWidth: event.skipped ? 1.5 : 1,
        borderStyle: event.skipped ? 'dashed' : 'solid',
        borderColor: event.skipped ? colors.borderStrong : colors.border,
        overflow: 'hidden',
      }}>
      {event.skipped ? <Hatch /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
        <Text variant="subhead" style={{ fontFamily: fonts.bold }}>
          {formatDayShort(event.date)}
        </Text>
        {event.skipped ? <StatusPill status="skipped" label="Skip Date" /> : null}
      </View>
      {event.rows.map((row) => (
        <View
          key={row.responsibilityId}
          accessible
          accessibilityLabel={`${row.responsibilityName}: ${
            event.skipped
              ? `${row.before ?? 'no one'}, no one needed`
              : row.changed
                ? `${row.before ?? 'no one'} becomes ${row.after ?? 'no one'}`
                : `${row.after ?? 'no one'}, no change`
          }`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
          <Text numberOfLines={1} style={{ width: 84, fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold, color: colors.textSecondary }}>
            {row.responsibilityName}
          </Text>
          {event.skipped ? (
            <Who label={row.before} old />
          ) : row.changed ? (
            <>
              <Who label={row.before} old />
              <ArrowRight size={14} color={colors.textTertiary} strokeWidth={2} />
              <Who label={row.after} />
            </>
          ) : (
            <>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.semibold, color: colors.textSecondary }}>
                {row.after ?? '—'}
              </Text>
              <Text variant="caption" color="textTertiary">
                no change
              </Text>
            </>
          )}
        </View>
      ))}
    </View>
  );
}
