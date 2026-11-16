# 15 Host the app as a website (early sharing)
Status: resolved
Blocked by: 06

Owner wants a shareable website for early testing instead of app-store builds (2026-11-16).
- Deploy the Expo web build to EAS Hosting (`eas deploy`), at a URL like https://rotaloop.expo.app. Add npm scripts for preview and production deploys.
- Make sure deep routes load directly (e.g. /join/<token>, /group/<id>): pick expo-router web output (`single` with SPA fallback, or `static`) that EAS Hosting serves correctly.
- Invite links are https URLs on this domain (EXPO_PUBLIC_WEB_URL); set it to the real deployed URL.
- Responsive layout: on wide screens, center the app at a comfortable max width (phone-like column, or a two-column layout where it helps), so it reads well on desktop.
- PWA basics: manifest, icons, theme colour, "Add to Home Screen" so it feels app-like on phones.
- Notifications on web: Expo push doesn't cover web. For now, in-app only (Home attention list and Activity). Note web push as a follow-up (iOS needs an installed PWA, 16.4+).
- Verify: the live URL loads, guest sign-in works, and an invite link opened in a fresh browser goes through join.

## Added from ticket 06
- Let any Member share the group invite link: a `group_invite_link(p_group_id)` security-definer RPC that checks group membership. Only Admins can reset it.
- `grant execute on function public.invite_link_preview(text) to anon`, so a browser visitor sees the group name before creating a guest account.
- Universal links (iOS associated domains / Android App Links) for native builds: a later follow-up, noted only.

## Answer
**Live at https://rotaloop.expo.app** on EAS Hosting (project `@mikeywilson/rotaloop`; subdomain `rotaloop` was set on the first deploy with `--dev-domain rotaloop` and is reserved permanently).

**Output: `web.output: 'single'`.** All three modes were tried on preview deploys. `static` serves dynamic routes (`/join/<token>`, `/group/<id>`) as 404 `+not-found` pages. `server` works but renders the app on the server for every request, which an app behind sign-in doesn't need. `single` is plain static files: EAS Hosting serves `index.html` for any unknown path, so `/join/<token>`, `/group/<id>?tab=members` and `/welcome` all load directly with a 200. `+html.tsx` only applies to static/server output, so `scripts/web-postexport.ts` (run by `web:export`) writes `dist/manifest.json` and adds the head tags to `index.html`. It takes the name from `APP_NAME` and the colours from the theme tokens.

**Scripts:** `web:export` (export plus the post-export step), `deploy:web:preview` (export, then `npx -y eas-cli deploy --non-interactive`) and `deploy:web` (export, then `... deploy --prod --non-interactive`). `build:web` was replaced by `web:export`. There is no global `eas`, so the scripts use `npx eas-cli`.

**Env:** `EXPO_PUBLIC_*` values are inlined at export from `.env`. `EXPO_PUBLIC_WEB_URL=https://rotaloop.expo.app` was added to `.env` and matches the code default. `.env.example` and the README ("Website (EAS Hosting)") are updated.

**Layout:** `AppColumn` (in the root layout) centres the app in a 600px column (`appColumnMaxWidth` token) on the `surfaceAlt` page background. The tab bar and every screen sit inside it. `Sheet` uses the same max width, so bottom sheets line up with the column (the scrim still dims the whole window). The group screen's own 720px cap was removed. Page CSS sets `overflow-x: hidden`.

**PWA:** `manifest.json` (standalone, start_url `/`, theme and background `#FAF7F2`, 192/512/maskable icons), plus `theme-color` (light and dark), `apple-mobile-web-app-capable`, the status-bar style, `apple-mobile-web-app-title`, `apple-touch-icon`, `viewport-fit=cover` and `<title>Rotaloop</title>`. The icons in `public/icons/` are resized from `assets/images/icon.png`. There's no service worker.

**Backend (migration `20261117000000_member_invite_links.sql`, pushed to the hosted project):**
- `group_invite_link(p_group_id)`: a security definer function that returns the Group's join token for any active Member, and raises `42501` "Members only" otherwise. It's granted to `authenticated` and `service_role` only. Reset stays Admin-only.
- `grant execute on function public.invite_link_preview(text) to anon`. The function returns only `group_id`, `group_name` and `placeholder_name` (claim links), reads no account data, and returns no rows for unknown, reset or spent tokens.
- PGlite tests in `src/db/tests/rls.test.ts`: Members and Admins get the link, former Members, outsiders and anon are refused, a reset updates it, anon can preview (those three columns only), and anon still can't call the other RPCs. `database.types.ts` was regenerated.

**App:**
- Every Member gets the invite sheet (header button, Members tab "Invite people", Settings "Share invite link"). Only Admins see Reset.
- `/join/<token>` is reachable signed out (`redirectFor(gate, seg0, seg1)` lets `auth` see `join/[token]` only, and `Stack.Protected` guards it for `auth || app`). It shows the Group name and "Get started", which keeps the pending invite and goes to welcome, then name, then onboarding (join step prefilled), and then the join.
- **Bug fixed:** resuming the invite right after onboarding landed on `/?token=…`. `router.replace` ran before the navigator applied the new `Stack.Protected` guards, so the root redirect is now deferred one tick.

**Notifications on web:** `PUSH_ON_THIS_PLATFORM` in `push.ts`. On web, onboarding shows "Notifications on the website are coming soon; reminders will show in the app." and doesn't ask for permission. Profile shows push as disabled: "Not available on the website yet. Coming soon."

**Verified live** (headless Edge, 17/17): welcome at `/`, title, manifest and iOS meta; a 600px centred column at 1440px; no horizontal scroll at 390px; guest "Smoke Test 15" created through the UI reaches onboarding and the app; the web push note and the disabled Profile toggle; a signed-out `/join/<token>` shows the Group name, then guest, onboarding (prefilled) and join open the Group as Member; the Member's invite sheet has no Reset and sits in the column at desktop width; a direct load of `/group/<id>?tab=members` works. The test data is in Groups named "Smoke Test 15 …".

**Follow-ups:**
- Web push: needs a service worker and VAPID keys; on iOS only for an installed PWA, 16.4+.
- Universal links / App Links for native builds.
- `assets/images/icon.png` (and so the web icons) is still the Expo template icon.
- Home still shows the scaffold demo content (ticket 12).
