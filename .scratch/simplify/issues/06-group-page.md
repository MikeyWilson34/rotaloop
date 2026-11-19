# 06 App: one scrolling group page, own turns highlighted, settings simplified

Status: resolved
Blocked by: 01, 02, 04

Reference: `design/prototype/simple.html` `PAGES.group`, `PAGES.settings`. Spec: `.scratch/simplify/spec.md` → "Navigation".

- One page that scrolls (no sub-tabs): Coming up → Members → gear icon for settings. Settings: jobs (tap to edit the same sentence row as setup), dates off, invite link / QR, more options (name, time zone), leave group. No admin UI anywhere (see ticket 04).
- "Coming up" highlights the viewer's own turns (tinted row, "You" with avatar). Swapped dates show "swapped with Sam" (small swap icon); a date where someone rests to avoid back-to-back shows "break for Tom". Group-off days shown as before.
- Members list: stand-ins have a dashed avatar, a "Stand-in" pill and "Not on the app. You keep track for them."; an "Add stand-in" row at the bottom of the list (text sheet). A cover from outside the group shows "Not in group".
- Tapping a turn opens the details sheet; "Can't make it" is danger-styled; for a stand-in's turn the button reads "<Name> can't make it".
- Add a "Sunday class" sample group to any seed/demo data if the repo has one (3 members, weekly Teach job).

Acceptance: `npm test`, `npm run typecheck`, `npm run lint`, `npm run e2e:nav` pass; screenshots light + dark. No banned words. Do not commit or push.
