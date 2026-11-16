import { CalendarOff, Clock, Copy, LifeBuoy, Scale } from 'lucide-react-native';
import { useState } from 'react';

import { ChoiceSheet, ConfirmSheet, FieldLabel, InfoRow, SettingsList, SwitchRow, ValueRow, type ChoiceOption } from '@/components/ui';
import type { GroupSettings } from '@/engine';
import type { GroupDetails } from '@/lib/groups';
import {
  choiceLabel,
  countRealWorkWarning,
  COVERAGE_POLICY_CHOICES,
  daysToMs,
  DEADLINE_CHOICES,
  deadlineDays,
  deadlineLabel,
  DOUBLING_COPY,
  REPLACEMENT_DUTY_CHOICES,
  TIME_OFF_CHOICES,
  type Choice,
} from '@/lib/groupSetup';

import type { RunCommand } from '../MemberActionsSheet';

type Picker = 'coveragePolicy' | 'replacementDuty' | 'deadline' | 'timeOffHandling';

/**
 * Settings → Coverage: Coverage Policy, Replacement Duty, "Find a replacement by", Time Off
 * handling and doubling. All go through `changeSettings`. Members see them read-only.
 */
export function CoverageSection({ group, isAdmin, run }: { group: GroupDetails; isAdmin: boolean; run: RunCommand }) {
  const s = group.state.settings;
  const [picker, setPicker] = useState<Picker | null>(null);
  const [confirmCountRealWork, setConfirmCountRealWork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(settings: Partial<GroupSettings>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const failed = await run({ type: 'changeSettings', settings }, 'changeSettings');
    setBusy(false);
    if (failed) {
      setError(failed);
      return false;
    }
    return true;
  }

  async function pick(settings: Partial<GroupSettings>) {
    if (await change(settings)) setPicker(null);
  }

  function open(next: Picker) {
    setError(null);
    setPicker(next);
  }

  const description = <T extends string>(choices: readonly Choice<T>[], value: T) =>
    choices.find((c) => c.value === value)?.description ?? '';

  const rows = [
    {
      key: 'coveragePolicy' as const,
      icon: Scale,
      label: 'Coverage Policy',
      value: choiceLabel(COVERAGE_POLICY_CHOICES, s.coveragePolicy),
      description: description(COVERAGE_POLICY_CHOICES, s.coveragePolicy),
    },
    {
      key: 'replacementDuty' as const,
      icon: LifeBuoy,
      label: 'Replacement Duty',
      value: choiceLabel(REPLACEMENT_DUTY_CHOICES, s.replacementDuty),
      description: description(REPLACEMENT_DUTY_CHOICES, s.replacementDuty),
    },
    {
      key: 'deadline' as const,
      icon: Clock,
      label: 'Find a replacement by',
      value: deadlineLabel(s.replacementDeadlineMs),
      description: 'When Replacement Duty starts if nobody has volunteered.',
    },
    {
      key: 'timeOffHandling' as const,
      icon: CalendarOff,
      label: 'Time Off handling',
      value: choiceLabel(TIME_OFF_CHOICES, s.timeOffHandling),
      description: description(TIME_OFF_CHOICES, s.timeOffHandling),
    },
  ];

  return (
    <>
      <FieldLabel>Coverage</FieldLabel>
      <SettingsList>
        {rows.map((r) =>
          isAdmin ? (
            <ValueRow
              key={r.key}
              icon={r.icon}
              label={r.label}
              description={r.description}
              value={r.value}
              disabled={busy}
              onPress={() => open(r.key)}
            />
          ) : (
            <InfoRow key={r.key} icon={r.icon} label={`${r.label}: ${r.value}`} description={r.description} />
          ),
        )}
        <SwitchRow
          icon={Copy}
          label={DOUBLING_COPY.label}
          description={s.allowDoubling ? DOUBLING_COPY.on : DOUBLING_COPY.off}
          value={s.allowDoubling}
          disabled={!isAdmin || busy}
          onValueChange={(allowDoubling) => change({ allowDoubling })}
        />
      </SettingsList>

      <ChoiceSheet
        visible={picker === 'coveragePolicy'}
        title="Coverage Policy"
        message="What a Decline costs."
        options={COVERAGE_POLICY_CHOICES}
        value={s.coveragePolicy}
        busy={busy}
        error={error}
        onClose={() => setPicker(null)}
        onPick={(coveragePolicy) => {
          if (coveragePolicy === s.coveragePolicy) setPicker(null);
          else if (coveragePolicy === 'countRealWork') {
            setPicker(null);
            setConfirmCountRealWork(true);
          } else pick({ coveragePolicy });
        }}
      />
      <ChoiceSheet
        visible={picker === 'replacementDuty'}
        title="Replacement Duty"
        message="Who finds someone when a Coverage Request has no volunteer by the deadline. Admins are informed either way."
        options={REPLACEMENT_DUTY_CHOICES}
        value={s.replacementDuty}
        busy={busy}
        error={error}
        onClose={() => setPicker(null)}
        onPick={(replacementDuty) => (replacementDuty === s.replacementDuty ? setPicker(null) : pick({ replacementDuty }))}
      />
      <ChoiceSheet
        visible={picker === 'deadline'}
        title="Find a replacement by"
        message="How long before the Event Replacement Duty starts, if nobody has volunteered."
        options={DEADLINE_CHOICES as readonly ChoiceOption<string>[]}
        value={String(deadlineDays(s.replacementDeadlineMs))}
        busy={busy}
        error={error}
        onClose={() => setPicker(null)}
        onPick={(days) => pick({ replacementDeadlineMs: daysToMs(Number(days)) })}
      />
      <ChoiceSheet
        visible={picker === 'timeOffHandling'}
        title="Time Off handling"
        message="What happens when someone in line for an Event is on Time Off."
        options={TIME_OFF_CHOICES}
        value={s.timeOffHandling}
        busy={busy}
        error={error}
        onClose={() => setPicker(null)}
        onPick={(timeOffHandling) => (timeOffHandling === s.timeOffHandling ? setPicker(null) : pick({ timeOffHandling }))}
      />
      <ConfirmSheet
        visible={confirmCountRealWork}
        title="Switch to Count Real Work?"
        message={countRealWorkWarning(group.state)}
        confirmLabel="Switch to Count Real Work"
        tone="destructive"
        loading={busy}
        error={error}
        onConfirm={async () => {
          if (await change({ coveragePolicy: 'countRealWork' })) setConfirmCountRealWork(false);
        }}
        onCancel={() => setConfirmCountRealWork(false)}
      />
    </>
  );
}
