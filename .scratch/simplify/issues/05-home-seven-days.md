# 05 App: Home shows only the next 7 days

Status: ready-for-agent
Blocked by: 01, 02

Reference: `design/prototype/simple.html` `PAGES.home`, `heroCard`. Spec: `.scratch/simplify/spec.md` → "Navigation" (Home, Button colours).

- Home = next 7 days only. First item = big navy card (one button: red "Can't make it", or green Yes / red No for a headcount). Directly under it "Needs you" (only when non-empty, only items within the 7 days). Then "This week" (remaining items in the 7 days). If nothing is due: calm "Nothing this week" card naming your next turn (job · group · date). Then **Your groups**: one tappable card per group (icon, name, "Your next turn: Greeter · Sun, Nov 29" or "No turns coming up") that opens the group page. No "Coming up" list on Home.
- Button colours use existing tokens: "Can't make it" = danger; Yes = success; No = danger; correct in light AND dark, with enough contrast on the navy card (the prototype adds a thin inner ring).
- Headcount sheet: unselected answer outlined in its colour, selected filled (with check / X).
- When a bottom sheet is open, confirmations show inside the sheet, not as a toast over it.

Acceptance: `npm test`, `npm run typecheck`, `npm run lint`, `npm run e2e:nav` pass; component/unit tests for the 7-day window and empty state; screenshots light + dark at 375px reported. No banned words. Do not commit or push.
