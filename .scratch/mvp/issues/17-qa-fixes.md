# 17 QA fixes (live site sweep)
Status: resolved

Found by the QA sweep of https://rotaloop.expo.app:
- BLOCKER: in-app navigation blanked the app (`cannot add postgres_changes callbacks for realtime:<topic> after subscribe()`): mounted screens reused the same realtime topic, and there was no ErrorBoundary.
- MAJOR (live only): EAS Hosting answered rapid cold loads with 429 for JS chunks and fonts, leaving a blank page.
- Minor: `?action=` stayed in the Assignment URL; reloading mid-onboarding went back to step 1; Chip (and other toggles) had no aria state on web.

## Answer
- **Realtime:** `src/lib/realtimeHub.ts` (pure, unit-tested) + `src/lib/realtime.ts` (`useRealtimeChanges`). One channel per distinct set of bindings, ref-counted, changes fanned out to every subscriber, removed 1 s after the last one leaves; every channel gets a fresh topic (`label#n`), so it never collides with one still being removed; `removeAll()` on sign-out; failures are logged, never thrown into React. All four `.channel(` call sites (my memberships and `useGroup` in groups.ts, `useGroupsRealtime` in schedule.ts, `useHistoryRealtime` in activity/data.ts) use it.
- **ErrorBoundary:** `src/app/_layout.tsx` exports one (`src/components/AppErrorBoundary.tsx`): "Something went wrong" with Try again / Reload, or "Couldn't load" for a failed code load (reloads once by itself first).
- **429s:** `asyncRoutes: { web: false }` (one bundle; a cold load went from 13 requests to 6), only the four Nunito Sans weights are bundled (deep imports), and an inline script in `index.html` (`src/lib/chunkRecovery.ts`, added by web-postexport) reloads once with a cache-busting URL when a script fails to load or parse, then shows "Couldn't load" with Reload (sessionStorage loop guard). EAS Hosting documents no per-second rate limit; the Free plan lists 100,000 requests/month, 10 CPU-ms per request and 10 subrequests.
- **Minor:** `?action=` is cleared once the sheet has read it; the onboarding step lives in `?step=join`; `aria-checked` / `aria-pressed` / `aria-disabled` added to Chip, the radio rows (onboarding, ChoiceSheet, TimeZoneSheet, Home filter), the settings switch and calendar days.
- **Regression test:** `npm run e2e:nav` (`scripts/e2e-nav.mjs`), 42 checks; passes on the local export and fails on the old build at the first checklist tap.
