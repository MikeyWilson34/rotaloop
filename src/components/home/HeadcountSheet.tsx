import { useState } from 'react';
import { View } from 'react-native';

import { Button, Notice, Sheet, showToast, Text } from '@/components/ui';
import type { GroupState, HeadcountReply } from '@/engine/types';
import { firstName } from '@/lib/groupPage';
import { deviceTimeZone } from '@/lib/groupViews';
import { dateIn, formatDayShort, formatTimeIn } from '@/schedule/format';
import { answeredMessage, headcountCounts, headcountPeople, headcountText } from '@/schedule/headcount';
import { useTheme } from '@/theme';

import { YesNoButtons } from './YesNo';

/** Sends one answer; resolves to a plain-language error, or null when it worked. */
export type SendAnswer = (memberId: string, answer: HeadcountReply) => Promise<string | null>;

/**
 * One date of a headcount job (prototype `SHEETS.inst` for `type:'headcount'`): "Coming?" with
 * green Yes / red No (outlined until chosen, then filled), "2 coming · 0 not · 3 no reply" and
 * who's coming. People not on the app (stand-ins) can be answered for by anyone. No cover flow.
 * Used on the group page and from Home.
 */
export function HeadcountSheet({
  groupName,
  state,
  eventId,
  responsibilityId,
  jobName,
  startsAt,
  myMemberId,
  send,
  onClose,
}: {
  groupName: string;
  state: GroupState;
  eventId: string;
  responsibilityId: string;
  jobName: string;
  startsAt: string;
  myMemberId: string | null;
  send: SendAnswer;
  onClose: () => void;
}) {
  const { fonts, space } = useTheme();
  const [busy, setBusy] = useState<{ memberId: string; answer: HeadcountReply } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zone = deviceTimeZone();
  const meta = `${groupName} · ${formatDayShort(dateIn(startsAt, zone))} · ${formatTimeIn(startsAt, zone)}`;
  const people = headcountPeople(state, eventId, responsibilityId, myMemberId);
  const me = people.find((p) => p.isMe) ?? null;
  const standIns = people.filter((p) => p.isStandIn && !p.isMe);
  const coming = people.filter((p) => p.answer === 'yes').map((p) => (p.isMe ? 'You' : p.name));
  const summary = headcountText(headcountCounts(state, eventId, responsibilityId));

  async function answer(memberId: string, reply: HeadcountReply, forName: string | null) {
    setError(null);
    setBusy({ memberId, answer: reply });
    try {
      const failed = await send(memberId, reply);
      if (failed) setError(failed);
      else showToast(answeredMessage(reply, forName));
    } finally {
      setBusy(null);
    }
  }

  const busyFor = (memberId: string) => (busy?.memberId === memberId ? busy.answer : null);

  return (
    <Sheet
      visible
      busy={busy !== null}
      onClose={onClose}
      overline={meta}
      title={jobName}
      footer={<Button label="Close" variant="quiet" disabled={busy !== null} onPress={onClose} />}>
      {me ? (
        <View style={{ gap: space.sm }}>
          <Text style={{ fontFamily: fonts.bold }}>Coming?</Text>
          <YesNoButtons
            value={me.answer}
            busy={busyFor(me.memberId)}
            disabled={busy !== null}
            onChange={(reply) => void answer(me.memberId, reply, null)}
          />
        </View>
      ) : null}
      <Text variant="subhead" color="textSecondary">
        {summary}
      </Text>
      {coming.length ? (
        <View style={{ gap: 2 }}>
          <Text style={{ fontFamily: fonts.bold }}>{"Who's coming"}</Text>
          <Text variant="subhead">{coming.join(', ')}</Text>
        </View>
      ) : null}
      {standIns.length ? (
        <View style={{ gap: space.md }}>
          <Text style={{ fontFamily: fonts.bold }}>Not on the app</Text>
          {standIns.map((p) => (
            <View key={p.memberId} style={{ gap: 6 }}>
              <Text variant="subhead">{`${p.name}: coming?`}</Text>
              <YesNoButtons
                value={p.answer}
                who={p.name}
                busy={busyFor(p.memberId)}
                disabled={busy !== null}
                onChange={(reply) => void answer(p.memberId, reply, firstName(p.name))}
              />
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
    </Sheet>
  );
}
