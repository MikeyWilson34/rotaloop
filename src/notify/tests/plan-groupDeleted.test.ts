import { describe, expect, it } from 'vitest';

import { composeMessages, planGroupDeletedNotifications, type DeletedGroup, type NotifyProfile } from '../plan';

const profile = (accountId: string, pushEnabled = true): NotifyProfile => ({
  accountId,
  pushEnabled,
  notifyCoverageRequests: true,
  notifyChanges: false,
  reminderDaysBefore: [1],
  reminderTime: '18:00',
  timeZone: 'UTC',
  adminAlertLeadTimeMs: 0,
});

const group: DeletedGroup = {
  id: 'g1',
  name: 'Sunday Team',
  deletedAt: '2026-11-22T10:00:00.000Z',
  deletedBy: 'acc-sam',
  members: [
    { name: 'Sam Rivers', accountId: 'acc-sam', leftAt: null },
    { name: 'Jessica', accountId: 'acc-jess', leftAt: null },
    { name: 'Pat', accountId: 'acc-pat', leftAt: null },
    { name: 'Old', accountId: 'acc-old', leftAt: '2026-10-01T00:00:00.000Z' },
    { name: 'Dee (Stand-in)', accountId: null, leftAt: null },
  ],
};

const profiles = new Map([
  ['acc-sam', profile('acc-sam')],
  ['acc-jess', profile('acc-jess')],
  ['acc-pat', profile('acc-pat', false)],
  ['acc-old', profile('acc-old')],
]);

describe('planGroupDeletedNotifications', () => {
  it('tells everyone still in it with push on, never the person who deleted it', () => {
    const items = planGroupDeletedNotifications(group, profiles);
    expect(items.map((i) => i.accountId)).toEqual(['acc-jess']);
    expect(items[0]).toMatchObject({
      kind: 'groupDeleted',
      title: 'Sam deleted Sunday Team',
      body: 'The group and its schedule are gone for everyone.',
      url: '/groups',
      groupId: 'g1',
      dedupeKey: 'groupDeleted:g1:2026-11-22T10:00:00.000Z:acc-jess',
    });
  });

  it('ignores the "Schedule changes" switch (it is the whole group)', () => {
    expect(planGroupDeletedNotifications(group, profiles)).toHaveLength(1);
  });

  it('says "was deleted" when it is unknown who deleted it', () => {
    const items = planGroupDeletedNotifications({ ...group, deletedBy: null }, profiles);
    expect(items.map((i) => i.title)).toEqual(['Sunday Team was deleted', 'Sunday Team was deleted']);
  });

  it('is sent as is (one item per person)', () => {
    const [message] = composeMessages(planGroupDeletedNotifications(group, profiles));
    expect(message).toMatchObject({ accountId: 'acc-jess', title: 'Sam deleted Sunday Team', url: '/groups' });
  });
});
