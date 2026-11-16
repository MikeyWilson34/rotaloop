# 15 Host the app as a website (early sharing)
Status: blocked
Blocked by: 06

Owner wants a shareable website for early testing instead of app-store builds (2026-11-16).
- Deploy the Expo web build to EAS Hosting (`eas deploy`), at a URL like https://rotaloop.expo.app. Add npm scripts for preview and production deploys.
- Make sure deep routes load directly (e.g. /join/<token>, /group/<id>): pick expo-router web output (`single` with SPA fallback, or `static`) that EAS Hosting serves correctly.
- Invite links are https URLs on this domain (EXPO_PUBLIC_WEB_URL); set it to the real deployed URL.
- Responsive layout: on wide screens, center the app at a comfortable max width (phone-like column, or a two-column layout where it helps), so it reads well on desktop.
- PWA basics: manifest, icons, theme colour, "Add to Home Screen" so it feels app-like on phones.
- Notifications on web: Expo push doesn't cover web. For now, in-app only (Home attention list and Activity). Note web push as a follow-up (iOS needs an installed PWA, 16.4+).
- Verify: the live URL loads, guest sign-in works, and an invite link opened in a fresh browser goes through join.
