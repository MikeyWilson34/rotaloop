import type { ScheduleItem } from '@/schedule/views';

import { EventCard, MySlotCard, SkipCard } from './cards';

/** One card of a schedule list: one of my Assignments, an Event with its rows, or a Skip Date. */
export function ScheduleItemCard({
  item,
  viewerTimeZone,
  today,
}: {
  item: ScheduleItem;
  viewerTimeZone: string;
  today: string;
}) {
  if (item.kind === 'skip') return <SkipCard event={item.event} />;
  if (item.kind === 'slot') return <MySlotCard event={item.event} slot={item.slot} viewerTimeZone={viewerTimeZone} />;
  return <EventCard event={item.event} viewerTimeZone={viewerTimeZone} today={today} showGroup />;
}
