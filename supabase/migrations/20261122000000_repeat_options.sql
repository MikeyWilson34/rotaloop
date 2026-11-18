-- More Event Series repeat options (feedback round 1, ticket 02). Widens the shape check on
-- event_series.repeat; no table changes. Every pattern the old check accepted still passes.
--
-- New, all optional (a missing key means the old behaviour):
-- - frequency 'daily' with intervalDays (1-365): every N days from startsOn. daysOfWeek is [].
-- - monthly on a date: dayOfMonth (1-31) instead of weekOfMonth (which is then null), and
--   daysOfWeek []. Months without that date use their last day.
-- - intervalMonths (monthly only, 1-12): every N months, phased from startsOn's month.
-- - endsOn ("YYYY-MM-DD", the last local date) or endsAfter (a number of Events counted
--   from startsOn), not both.
-- e.g. { "frequency": "monthly", "intervalWeeks": null, "daysOfWeek": [], "weekOfMonth": null,
--        "dayOfMonth": 15, "intervalMonths": 3, "endsOn": "2027-06-30",
--        "startTime": "09:00", "timeZone": "America/Chicago", "startsOn": "2026-11-15" }
--
-- `create or replace` keeps the function's grants and the event_series check constraint
-- that calls it.

create or replace function public.is_repeat_pattern(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and p ->> 'frequency' in ('weekly', 'biweekly', 'monthly', 'custom', 'daily')
    and jsonb_typeof(p -> 'daysOfWeek') = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p -> 'daysOfWeek') d
      where jsonb_typeof(d) <> 'number' or (d #>> '{}')::numeric not in (0, 1, 2, 3, 4, 5, 6)
    )
    and ((p ->> 'frequency') = 'custom') = (coalesce(jsonb_typeof(p -> 'intervalWeeks'), 'null') = 'number')
    and ((p ->> 'frequency') = 'daily') = (coalesce(jsonb_typeof(p -> 'intervalDays'), 'null') = 'number')
    -- monthly is on a weekday (weekOfMonth) or on a date (dayOfMonth): exactly one of them.
    and ((p ->> 'frequency') = 'monthly') = (
      (coalesce(jsonb_typeof(p -> 'weekOfMonth'), 'null') = 'number')
      <> (coalesce(jsonb_typeof(p -> 'dayOfMonth'), 'null') = 'number')
    )
    and (
      (p ->> 'frequency') = 'monthly'
      or (
        coalesce(jsonb_typeof(p -> 'weekOfMonth'), 'null') = 'null'
        and coalesce(jsonb_typeof(p -> 'dayOfMonth'), 'null') = 'null'
      )
    )
    and ((p ->> 'frequency') = 'monthly' or coalesce(jsonb_typeof(p -> 'intervalMonths'), 'null') = 'null')
    and coalesce(jsonb_typeof(p -> 'intervalMonths'), 'null') in ('null', 'number')
    -- daily and monthly-on-a-date have no weekdays; every other kind has 1-7.
    and (
      case
        when (p ->> 'frequency') = 'daily' or coalesce(jsonb_typeof(p -> 'dayOfMonth'), 'null') = 'number'
          then jsonb_array_length(p -> 'daysOfWeek') = 0
        else jsonb_array_length(p -> 'daysOfWeek') between 1 and 7
      end
    )
    and (p ->> 'startTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and length(btrim(p ->> 'timeZone')) > 0
    and (p ->> 'startsOn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (
      coalesce(jsonb_typeof(p -> 'endsOn'), 'null') = 'null'
      or (jsonb_typeof(p -> 'endsOn') = 'string' and (p ->> 'endsOn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    )
    and coalesce(jsonb_typeof(p -> 'endsAfter'), 'null') in ('null', 'number')
    and not (
      coalesce(jsonb_typeof(p -> 'endsOn'), 'null') <> 'null'
      and coalesce(jsonb_typeof(p -> 'endsAfter'), 'null') <> 'null'
    ),
    false
  )
$$;
