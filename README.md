# Rotaloop

Mobile-first app for fairly rotating shared group responsibilities. "Rotaloop" is a working name, set in one place: `src/config/app.ts`.

- Product brief: `docs/product-brief.md`. MVP spec and tickets: `.scratch/mvp/`
- Domain language: `GLOSSARY.md`. Decisions: `docs/adr/`
- Design system and prototype: `design/`

## Stack

- **Expo SDK 58** (React Native 0.88, React 19.3, TypeScript, expo-router) for iOS, Android and web
- **Supabase** (Postgres, Auth, row-level security, Realtime), hosted. There is no local Supabase, because the dev machine has no Docker.
- **Vitest** for the pure domain code in `src/engine/`

## Setup

Prerequisites: Node 22 and npm 10.

```bash
npm install
cp .env.example .env   # then fill in the values (see "Owner to-do" below)
npm run web            # or: npm start, then scan the QR code with Expo Go
```

The app runs without a `.env` for now, because no screen talks to Supabase yet. The first import of `src/lib/supabase.ts` throws a clear error if the variables are missing.

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Start the Expo dev server (press `w`, `a` or `i`, or scan the QR code with Expo Go) |
| `npm run web` | Start the dev server and open the web build |
| `npm run android` / `npm run ios` | Start and open on an emulator or simulator (iOS needs macOS) |
| `npm run build:web` | Static web export to `dist/` |
| `npm test` | Run the Vitest unit tests once (`npm run test:watch` to watch) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` (ESLint with eslint-config-expo) |

Use `npx expo install <package>` rather than `npm install` for anything native, so versions match the SDK. `npx expo-doctor` checks the project's health.

## Layout

```
app.config.ts          Expo config; reads the app name from src/config/app.ts
src/
  app/                 expo-router routes (every file is a screen)
    _layout.tsx        root: fonts, splash, navigation theme
    (tabs)/            Home, Groups, Schedule, Activity, Profile
  components/ui/       primitives: Text, Card, Button, StatusPill, Screen
  config/app.ts        APP_NAME and other identifiers (the only place the name lives)
  engine/              pure TypeScript rotation engine: no React, Expo or Supabase imports (lint-enforced)
  lib/supabase.ts      Supabase client (AsyncStorage session on native)
  theme/               design tokens from design/design-system.md, useTheme(), font loading
supabase/
  config.toml          Supabase CLI config
  migrations/          SQL migrations, applied to the hosted project
```

## Theme

`useTheme()` returns the light or dark token set, following the device setting: `colors`, `typography`, `space`, `radii` and `shadows`. Token names match `design/design-system.md`. Nunito Sans loads through `@expo-google-fonts/nunito-sans`, and the splash screen stays up until the fonts are ready. Icons come from `lucide-react-native`.

## Supabase

Migrations are plain SQL files in `supabase/migrations/`. With no Docker, `supabase start` and `supabase db reset` won't work. Work against the hosted project instead:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push        # apply migrations to the hosted database
```

## Owner to-do (not yet done)

1. **Create a hosted Supabase project** at https://supabase.com. Copy the Project URL and the **anon** public key from Project Settings > API into `.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Never put the `service_role` key in `.env`: `EXPO_PUBLIC_*` values are shipped inside the app.
2. **Create an Expo account** at https://expo.dev. You'll need it for EAS builds, push notifications and store submission (`npx eas-cli@latest login`). Expo Go on a phone works without an account for local development.
3. Restart `npm start` after editing `.env`. Expo only reads env vars at startup.
