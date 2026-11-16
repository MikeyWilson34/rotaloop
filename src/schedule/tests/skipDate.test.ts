import { describe, expect, it } from 'vitest';

import { affectedLabel, skipCandidates, skipDateText, skipPreview, skipReasonText } from '../skipDate';
import { eventView } from '../views';
import { asGroup, buildGroup, eventId, NOW, run, ZONE } from './fixture';

describe('Skip Date reason', () => {
  it('combines the chip and the details', () => {
    expect(skipReasonText('Holiday', '')).toBe('Holiday');
    expect(skipReasonText('Holiday', '  Building   closed ')).toBe('Holiday: Building closed');
    expect(skipReasonText('Other', 'Power cut')).toBe('Power cut');
    expect(skipReasonText('Other', '')).toBe('Other');
    expect(skipReasonText(null, '')).toBeNull();
  });

  it('writes the Skip Date card sentence', () => {
    expect(skipDateText({ markedBy: 'Ben', reason: 'Holiday: Building closed.' })).toBe(
      'No one needed. Holiday: Building closed. Marked by Ben. Turns move forward one Event.',
    );
    expect(skipDateText({ markedBy: null, reason: null })).toBe('No one needed. Turns move forward one Event.');
  });

  it('carries the reason into the Event view', () => {
    const b = buildGroup();
    run(b, { type: 'addSkipDate', eventId: eventId('2026-12-06'), reason: 'Closure' }, 'ben');
    const event = b.state.events.find((e) => e.id === eventId('2026-12-06'))!;
    expect(eventView(asGroup(b.state), event, NOW, ZONE).skipDate).toEqual({ markedBy: 'Ben', reason: 'Closure' });
  });

  it('labels how many people are affected', () => {
    expect(affectedLabel(1)).toBe('1 person affected');
    expect(affectedLabel(3)).toBe('3 people affected');
  });
});

describe('step 1: upcoming Events', () => {
  it('lists upcoming Events that are not Skip Dates, with who serves', () => {
    const b = buildGroup();
    run(b, { type: 'addSkipDate', eventId: eventId('2026-11-29') }, 'ben');
    const list = skipCandidates(asGroup(b.state), NOW, ZONE, 3);
    expect(list.map((c) => c.date)).toEqual(['2026-11-22', '2026-12-06', '2026-12-13']);
    expect(list[0].who).toBe('You, Pat');
  });
});

describe('step 3: preview', () => {
  it('shows before -> after for the next Events: the Skip Date empties, everyone moves forward one Event', () => {
    const b = buildGroup();
    const group = asGroup(b.state);
    const preview = skipPreview(group, eventId('2026-12-06'), 'Holiday', NOW, ZONE);
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.events.map((e) => e.date)).toEqual(['2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27', '2027-01-03']);
    const [skipped, next] = preview.events;
    expect(skipped.skipped).toBe(true);
    expect(skipped.rows.every((r) => r.after === null && r.before !== null)).toBe(true);
    // Dec 6's Sound person now serves Dec 13.
    const sound = (e: (typeof preview.events)[number]) => e.rows.find((r) => r.responsibilityId === 'sound')!;
    expect(sound(next).after).toBe(sound(skipped).before);
    expect(sound(next).changed).toBe(true);
    expect(preview.affected).toBeGreaterThan(1);
    // Nothing was saved.
    expect(b.state.events.find((e) => e.id === eventId('2026-12-06'))?.skipDate).toBeNull();
  });

  it('passes on the engine refusal (e.g. already a Skip Date)', () => {
    const b = buildGroup();
    run(b, { type: 'addSkipDate', eventId: eventId('2026-12-06') }, 'ben');
    expect(skipPreview(asGroup(b.state), eventId('2026-12-06'), null, NOW, ZONE)).toEqual({ ok: false, reason: 'invalid' });
  });
});
