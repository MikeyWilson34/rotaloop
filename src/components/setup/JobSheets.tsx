import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { TimeOffCalendar } from '@/components/timeOff/TimeOffCalendar';
import { Button, Chip, ChipGroup, FieldLabel, SegmentedControl, Sheet, Text } from '@/components/ui';
import {
  NTH_OPTIONS,
  REPEAT_KIND_OPTIONS,
  repeatText,
  TIME_MINUTES,
  timeFromParts,
  timeParts,
  type JobRepeat,
  type TimeParts,
} from '@/lib/groupCreate';
import { WEEKDAY_LONG } from '@/lib/groupSetup';
import { monthOf, shiftMonth } from '@/schedule/views';
import { useTheme } from '@/theme';

const NO_DAYS = new Set<string>();
const MONTHS_AHEAD = 12;

/** "How often?" (prototype `SHEETS.repeat`): every week / every 2 weeks / monthly (Nth weekday) / one-off date. */
export function RepeatSheet({
  visible,
  value,
  today,
  onClose,
  onDone,
}: {
  visible: boolean;
  value: JobRepeat;
  today: string;
  onClose: () => void;
  onDone: (repeat: JobRepeat) => void;
}) {
  // Mounted only while open, so each opening starts from the row's current value.
  if (!visible) return null;
  return <RepeatSheetBody value={value} today={today} onClose={onClose} onDone={onDone} />;
}

function RepeatSheetBody({
  value,
  today,
  onClose,
  onDone,
}: {
  value: JobRepeat;
  today: string;
  onClose: () => void;
  onDone: (repeat: JobRepeat) => void;
}) {
  const { space } = useTheme();
  const [r, setR] = useState<JobRepeat>(value);
  const [month, setMonth] = useState(monthOf(value.date >= today ? value.date : today));
  const firstMonth = monthOf(today);
  const lastMonth = shiftMonth(firstMonth, MONTHS_AHEAD);

  return (
    <Sheet
      visible
      onClose={onClose}
      title="How often?"
      footer={<Button label={`Done · ${repeatText(r)}`} size="lg" onPress={() => onDone(r)} />}>
      <View accessibilityRole="radiogroup" style={{ gap: space.xs }}>
        {REPEAT_KIND_OPTIONS.map((o) => (
          <RadioRow key={o.value} label={o.label} selected={r.kind === o.value} onPress={() => setR({ ...r, kind: o.value })} />
        ))}
      </View>
      {r.kind === 'month' ? (
        <View style={{ gap: space.sm }}>
          <FieldLabel>Which week</FieldLabel>
          <ChipGroup>
            {NTH_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} selected={r.nth === o.value} onPress={() => setR({ ...r, nth: o.value })} />
            ))}
          </ChipGroup>
        </View>
      ) : null}
      {r.kind !== 'once' ? (
        <View style={{ gap: space.sm }}>
          <FieldLabel>Day</FieldLabel>
          <ChipGroup>
            {WEEKDAY_LONG.map((day, i) => (
              <Chip key={day} label={day.slice(0, 3)} selected={r.weekday === i} onPress={() => setR({ ...r, weekday: i })} />
            ))}
          </ChipGroup>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <FieldLabel>Date</FieldLabel>
          <TimeOffCalendar
            month={month}
            today={today}
            selected={new Set([r.date])}
            rangeStart={null}
            off={NO_DAYS}
            serving={NO_DAYS}
            onPick={(date) => setR({ ...r, date })}
            onPrev={month > firstMonth ? () => setMonth(shiftMonth(month, -1)) : null}
            onNext={month < lastMonth ? () => setMonth(shiftMonth(month, 1)) : null}
          />
        </View>
      )}
    </Sheet>
  );
}

function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors, radii, fonts, space } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 52,
        paddingHorizontal: space.md,
        borderRadius: radii.md,
        backgroundColor: selected ? colors.primaryTint : pressed ? colors.surfaceAlt : 'transparent',
      })}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? colors.primary : colors.borderStrong,
          backgroundColor: selected ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {selected ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text style={{ fontFamily: selected ? fonts.bold : fonts.regular }}>{label}</Text>
    </Pressable>
  );
}

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** "What time?" (prototype `SHEETS.time`): hour, minutes (quarter hours) and am/pm. */
export function TimeSheet({
  visible,
  value,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** "HH:MM", 24-hour. */
  value: string;
  onClose: () => void;
  onDone: (time: string) => void;
}) {
  if (!visible) return null;
  return <TimeSheetBody value={value} onClose={onClose} onDone={onDone} />;
}

function TimeSheetBody({ value, onClose, onDone }: { value: string; onClose: () => void; onDone: (time: string) => void }) {
  const { space } = useTheme();
  const initial = timeParts(value);
  // Times off the quarter hour (set elsewhere) show their own minute too.
  const minutes = (TIME_MINUTES as readonly string[]).includes(initial.minute)
    ? [...TIME_MINUTES]
    : [...TIME_MINUTES, initial.minute].sort();
  const [t, setT] = useState<TimeParts>(initial);
  return (
    <Sheet
      visible
      onClose={onClose}
      title="What time?"
      footer={<Button label="Done" size="lg" onPress={() => onDone(timeFromParts(t))} />}>
      <SegmentedControl
        accessibilityLabel="Morning or afternoon"
        options={[
          { value: 'am', label: 'am' },
          { value: 'pm', label: 'pm' },
        ]}
        value={t.ampm}
        onChange={(ampm) => setT({ ...t, ampm })}
      />
      <View style={{ gap: space.sm }}>
        <FieldLabel>Hour</FieldLabel>
        <ChipGroup>
          {HOURS.map((h) => (
            <Chip key={h} label={String(h)} selected={t.hour === h} onPress={() => setT({ ...t, hour: h })} />
          ))}
        </ChipGroup>
      </View>
      <View style={{ gap: space.sm }}>
        <FieldLabel>Minutes</FieldLabel>
        <ChipGroup>
          {minutes.map((m) => (
            <Chip key={m} label={`:${m}`} selected={t.minute === m} onPress={() => setT({ ...t, minute: m })} />
          ))}
        </ChipGroup>
      </View>
    </Sheet>
  );
}
