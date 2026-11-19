# 01 Weekly on several days

Status: needs-triage
Blocked by: none

From the product owner (2026-11-19): "We should be able to select multiple days weekly. Like an event that would happen every Tues, Thurs, and Saturday at 6am weekly."

Today a Job repeats every week / every 2 weeks / monthly (Nth weekday) / one-off, on one weekday. Add a way to pick several weekdays for one Job (same time on each), in the setup sentence row (`[Job] · [every Tue, Thu, Sat ▾] · [6:00am]`) and the Job editor.

Open questions:
- One rotation across all the days (Tue A, Thu B, Sat C...), or one per weekday? Default guess: one rotation across all days, with the no back-to-back rule applying between consecutive days.
- Does "every 2 weeks" also allow several days?
- Same time for every day, or a time per day? Default guess: same time; make another Job if times differ.
- Check how the engine's `repeat` / Event Series stores weekdays (may already support a list).
