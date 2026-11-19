# 02 Joining a rotation that's already going: "Whose turn is next?"

Status: needs-triage (design agreed, prototype first)
Blocked by: none

From the product owner (2026-11-19): when a group's rotation is already running before they start using the app, they need a way to say "I'm next and Thain has the week after". It must be optional.

## Design (product owner, 2026-11-19)
A simple, optional part of group creation, for each Take turns Job:
- "Whose turn is next?" with a single "+" button.
- Tap "+" -> pick anyone in the group. The picked person shows as the first row (e.g. "Nov 22 · You").
- The "+" moves underneath, so they can add who has the following date, and so on, building the starting order one date at a time.
- Skipping it entirely keeps today's behaviour (join order). Anyone not picked follows, in join order, after the picked people.

## Notes for the build
- Must come after people are known: the creator plus the names typed in "Who's in?" (stand-ins). So it sits after "Who's in?" in setup, or on the group page right after "Done". Also reachable later from the Job's settings.
- Rows should show the actual dates the people get, so it reads as "who has which week".
- Can't add the same person twice in a row? Open question: allow repeats at all? Default guess: each person once.
- Engine: maps to the initial Rotation queue order (ADR 0001).
