# 11 Push notifications, reminders, Admin alerts
Status: resolved
Blocked by: 09, 10

Expo push tokens, member reminders at their chosen time, Coverage Request notify + one follow-up, Admin alerts at their lead time, change notifications from history. Edge Functions + pg_cron.

## Scope decided by owner (2026-11-16)
Deliver to both the phone app (Expo push) and the website (Web Push with VAPID, service worker; iOS only as an installed PWA).

## Answer
**Typecheck in a fresh clone:** `npm run typecheck` is now `npm run typegen && tsc --noEmit`, where `typegen` is `expo customize tsconfig.json`. In SDK 58 that runs expo-router's typed-route generation without Metro or a dev server. It writes `.expo/types/router.d.ts` (and `expo-env.d.ts`) and leaves `tsconfig.json` unchanged. Proven twice in a scratchpad clone with `npm ci && npm run typecheck` (exit 0; the second run used the final tree), and the clone was deleted.

**Architecture**
- Migration `supabase/migrations/20261121000000_notifications.sql`:
  - `push_tokens` gains `kind` (`expo` | `web`) and `subscription`, the browser's PushSubscription JSON. A check makes it required only for web. For web, `token` is the endpoint.
  - RPC `register_web_push(subscription)`: checks for an https endpoint and the key shapes. If the browser was registered to another account, it moves to the caller.
  - RPC `unregister_push_token(token)`: removes only your own. `register_push_token` (Expo) is unchanged.
  - `notification_log`: `dedupe_key` (unique), account, kind, group, assignment, event, `offset_key`, title, body, url, `sent_at`, and `delivered` (devices reached). RLS lets a Member read only their own rows; clients can't write.
  - `claim_notifications(items)`, service role only: inserts with ON CONFLICT DO NOTHING and returns the new keys. Only those are sent.
  - `expo_push_tickets` (server only): Expo tickets waiting for receipts.
  - `request_notification_run()` and the pg_cron job `run-notifications`, every 15 minutes (`*/15 * * * *`), active. It follows the horizon job's pattern, with the new Vault secret `notify_url` and the shared `group_command_service_key`.
- Edge Function `notify` (`supabase/functions/notify/index.ts`). Service role only: `verify_jwt = false`, and it checks the key itself, like group-command.
  - `afterCommand`: `group-command` calls it after every successful `command` or `join`, passing `history` and `stateVersion`. The call runs in the background (`EdgeRuntime.waitUntil`): it never delays the reply, and if it fails the command still succeeds.
  - `scheduled`: the cron job.
  - Expo delivery: the Expo Push API in batches of 100. A ticket with `DeviceNotRegistered` removes its token immediately. Later runs read receipts at least 15 minutes after sending and also remove `DeviceNotRegistered` tokens.
  - Web delivery: `jsr:@negrel/webpush@0.5.0`, which uses Web Crypto and works in Supabase Edge (verified with `deno check` and live sends). A 404 or 410 removes the subscription.
  - VAPID: the key pair is the function secret `VAPID_KEYS` (base64 JWK JSON). The VAPID subject is the site URL, not a personal address.
- Pure logic, Node-tested and synced into `_shared/notify`:
  - `src/notify/plan.ts`: the planner.
  - `src/notify/run.ts`: loads, requests confirmations, plans, claims, batches and sends, through a `NotifyStore` and `Senders`.
  - `src/notify/expo.ts`: the Expo API.
- **Confirmation window.** Nothing called `requestConfirmation` before. Each job run now does it as the system for Assignments that need confirmation and are within `CONFIRMATION_WINDOW_DAYS = 14` days.
  - It is an ordinary engine command, with a history entry, the optimistic lock and retries. Those Assignments become Pending, so "We'll ask you to confirm closer to the Event" is now true.
  - Nothing else changed: moves still reset confirmation, and "Confirm early" still works.

**Planner rules** (`src/notify/plan.ts`)
- **Everywhere:**
  - Only active Members with an account and `push_enabled` get anything: never Placeholders, former Members or Guest Covers. Email and SMS are stored only.
  - The actor is never told about their own action.
  - Each item has:
    - a title;
    - a body built with `describeHistoryEntry` / `describeAssignmentChange` in the recipient's time zone, plus " · Group";
    - a URL: `/assignment/<g>/<a>`, `?action=cover` or `?action=markCovered`.
  - **Batching:** one message per person per run. Several items become "3 updates · Group", most urgent first, at most 4 lines. It opens Home unless all items share a link.
- **Immediate**, from the `changes` in the returned history:
  - **A new or reopened Coverage Request** goes to the Qualified Members, except the decliner, the actor and anyone already seated at that Event (unless the Group allows doubling). It respects the "Coverage Requests" toggle.
  - **Covers:** a Cover tells the Member who asked; a withdrawn Cover tells them again.
  - **Mark covered (by a Member):** asks the coverer to confirm, and tells the Member who asked unless they arranged it.
  - **Confirmation requested:** tells the holder.
  - **Schedule changes:** an Assignment moved, reassigned, added at an existing Event, or removed (Skip Date, Time Off swap, Make-up Turn, series edits) tells the new holder and the previous one. It respects the "Schedule changes" toggle.
  - **Not news:** Assignments on newly added Events, and a withdrawn Decline.
  - Dedupe key: `cmd:<g>:v<stateVersion>:<entry>:<assignment>:<kind>:<account>`.
- **Scheduled:** "due" means the moment passed less than `SEND_GRACE_MS` (60 minutes) ago.
  - **Reminders:**
    - One for each value in `reminder_days_before`, at `reminder_time` on that day in the Member's own time zone. `zonedTimeToInstant` makes this safe across daylight saving.
    - "Morning of" uses the reminder time if it is before noon, otherwise 07:00, and is never sent after the Event starts.
    - The coverer is reminded; nobody is reminded about a seat with an open request.
    - Key: `reminder:<g>:<a>:<event>:<n>d:<account>`. A moved Assignment gets a new key.
  - **Coverage Request follow-up:** once, at the Group's "find a replacement by" deadline, to the same people as a new request. Skipped if the request opened after the deadline.
  - **Replacement Duty:** once the deadline passes with no taker, even if the job ran late.
    - It goes to the decliner (the default; a Placeholder's request goes to the Admins), or to the Admins.
    - The Admins notice skips the decliner, unless they are the only Admin.
    - A Member who declined after the deadline isn't told, since they already know.
  - **Admin alerts:** at each Admin's `admin_alert_lead_time_ms`, for Unconfirmed or Needs coverage, once per Assignment and status.
    - Also sent when an Assignment turns Unconfirmed or Needs coverage after that time.
    - Never about the Admin's own seat, and not in a run that already sends that Admin Replacement Duty for it.
    - This alert is how "Admins are informed either way" is met; both defaults are 3 days.

**App**
- **Website:**
  - `public/sw.js` is exported to `/sw.js` with root scope. `web-postexport.ts` now checks the file is there.
  - The service worker handles only:
    - `push`: shows the title, body, icon, tag and link.
    - `notificationclick`: focuses the open app and posts `open-url` (the app routes it), or opens a window at the path. Only same-site paths; no caching.
  - `src/lib/push.web.ts`:
    - subscribes with the VAPID key and stores the subscription;
    - unsubscribes and unregisters when push is turned off;
    - re-saves the subscription for whoever is signed in.
  - An iPhone or iPad Safari tab (not standalone; iPadOS is detected by touch) shows "Add to Home Screen to enable on iPhone" and the steps instead of a prompt.
- **Native:** `src/lib/push.ts` has the same API. `notificationTaps.ts`:
  - shows notifications while the app is in the foreground;
  - opens a tapped notification's URL with `useLastNotificationResponse` once the person is in the app, also from a cold start;
  - refreshes the token.
- **Profile:** the push row shows the channel's status.
  - The statuses: "On for this browser / device", "Off for …", "Blocked in browser settings" (or "device settings"), "Add to Home Screen to enable on iPhone", "Not supported in this browser".
  - A note explains the blocked and iPhone cases, and the switch is disabled where it can't help.
- **Onboarding** uses the same logic, so iPhone tabs, old browsers and simulators get no broken prompt.
- **Home hero:** "You're all set. We'll remind you the day before at 6:00 PM." now comes from the person's real preferences. `reminderSummary` mirrors the planner's morning-of rule and says when reminders or push are off.
- **Env:** `EXPO_PUBLIC_VAPID_PUBLIC_KEY` is set in `.env`, with a placeholder in `.env.example`. The README is updated.

**Tests:** 628 pass, 73 of them new.
- `src/notify/tests/plan-command.test.ts` (21):
  - every immediate kind and its copy;
  - never the actor (an Admin declining for a Placeholder; the decliner marking it covered);
  - doubling, topic and push toggles;
  - a Guest Cover, Placeholders, and new Events not being news;
  - stable, unique dedupe keys.
- `plan-scheduled.test.ts` (33):
  - reminder times in Chicago, New York and London across spring-forward and fall-back, plus a skipped 2:30 AM;
  - the Member's own calendar day, morning-of, and an unknown time zone;
  - grace-period edges, offsets, a moved Assignment, the coverer versus a Guest Cover;
  - follow-up and Replacement Duty edges: a late job, a late Decline, Admins, a Placeholder;
  - Admin alerts: lead time, own seat, catching up to Needs coverage;
  - batching.
- `notify-db.test.ts` (12, PGlite):
  - RPC validation, takeover and unregister;
  - RLS on tokens and the log, with no client writes;
  - claim dedupe, service role only;
  - a full scheduled run: the requestConfirmation history, reminders, and a second run sending nothing;
  - 410 and `DeviceNotRegistered` removal, and receipts;
  - notifications after a Decline.
- `src/lib/tests/pushStatus.test.ts` (10), and the hero text in `home.test.ts`.
- Typecheck (including the fresh clone), lint and `functions:check` (`deno check --no-lock` on both functions) pass.

**Deployed:**
- The migration: the dry run showed only this one, then `db push`. `db:types` gave additions only.
- Functions: `group-command` redeployed and `notify` deployed.
- Secrets:
  - The function secret `VAPID_KEYS`. The private key went from a temp file straight into `secrets set`, and the file was deleted.
  - The Vault secret `notify_url`.
- A manual `request_notification_run()` returned 200: 10 Groups, 4 confirmations requested.
- The website was not deployed.

**Live:** `node --env-file=.env --import tsx scripts/smoke-notifications.mjs`: all checks ok. It uses guest accounts and the publishable key, and triggers the job through the linked CLI, so the script never handles a service key.
- Setup: three fake Web Push subscriptions with real P-256 keys, pointing at httpbin endpoints that answer 201 or 410.
- Cara's Decline:
  - Alex and Ben get a Coverage Request row with the title, the reason in the body and the `?action=cover` link; Cara gets none.
  - Alex's row shows delivered 1. Ben's endpoint answered 410: his row shows delivered 0 and his subscription was removed.
- Members can't write the log.
- The scheduled run:
  - Ben's reminder row ("Tomorrow: Sound", `1d`) is due at his chosen Chicago time on the day before, and he got a confirmation request.
  - A second run sends nothing new.

**Real browser:** headless Edge, a local `dist/` export (not deployed) and the deployed backend. All checks ok:
- The Profile switch subscribed with a real endpoint on Microsoft's push service (`wns2-*.notify.windows.com`): "On for this browser" shows, `/sw.js` controls the root scope, and the subscription is stored.
- Another guest's Decline arrived as a real push. The service worker showed it with the right title, body, icon and `?action=cover` link, and the log shows delivered 1.
- Dispatching `notificationclick` in the service worker opened the Cover sheet in the running app.
- Turning push off removed the subscription from the server and from the browser.
- Denying permission showed "Blocked in browser settings".
- An iPhone user agent showed "Add to Home Screen to enable on iPhone" and the hint.

The screenshots are in the session scratchpad (`shots11/`).

**Caveats and owner to-do:**
- On iPhone and iPad, Web Push works only from the Home Screen web app (iOS 16.4+). To test it on your phone: open rotaloop.expo.app in Safari, then Share > Add to Home Screen, open it from there, and turn on Profile > Push notifications.
- Native Expo push hasn't been tried on a device: there is no dev or store build, and Expo Go on Android has no push. Try it on a dev build. Tap handling is in place.
- Email and SMS are still not delivered (post-MVP).
- Reminders go out within the 15-minute tick after their time.
- The cron job now runs against all live Groups, including the smoke-test ones.
- The website needs a deploy (`npm run deploy:web`) with the VAPID public key from `.env` before live Web Push works.
