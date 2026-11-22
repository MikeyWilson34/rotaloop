# 06 "Get Rotaloop on your phone" install card (website only)

Status: resolved

From the product owner (2026-11-21, "Yes, start the install card ticket"): the website is installable (manifest, icons, standalone, `public/sw.js` does Web Push) but nothing suggests installing it. On iPhone, reminders only work after "Add to Home Screen", so iPhone users silently get none. The manifest also reused the plain icon as the "maskable" icon, so Android could crop the logo.

Built:
- A tinted card on Home (like the invite card, so Home keeps one main button), web only: "Get Rotaloop on your phone", with a small close (X, label "Not now").
- Shows only in a browser tab on a phone or tablet, not when opened from the Home Screen, not on a desktop, and not after "Not now" (hidden 30 days, kept in localStorage; if storage fails it shows again next time).
- iPhone/iPad: "Add it to your Home Screen to get reminders"; tapping opens a sheet with 3 numbered steps (Share icon shown) and "Got it".
- Android with the browser's install prompt: "Install it to open in one tap"; tapping runs the saved prompt. `src/lib/installEvent.web.ts` catches `beforeinstallprompt` at startup. `appinstalled` or an accepted prompt hides the card.
- Android without the prompt (Firefox): sheet with menu steps.
- The decision is a pure function, `installCardVariant` in `src/lib/installCard.ts` (tests in `src/lib/tests/installCard.test.ts`). It reuses `isIosDevice` from `pushStatus.ts`.
- Maskable icons `public/icons/icon-maskable-192.png` and `-512.png` (logo inside the central safe zone on the light background colour); the manifest's `maskable` entries point at them, the `any` icons are unchanged.
- `npm run e2e:nav`: desktop run checks there's no card; new steps in phone browser contexts (iPhone, Android with a faked install prompt, Firefox on Android).
