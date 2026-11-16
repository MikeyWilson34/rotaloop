# 05 Auth + first-launch onboarding
Status: resolved
Blocked by: 02, 04

Sign up / sign in (email magic link to start). First-launch flow: name, then notification setup (push permission; email/SMS opt-ins stored but not delivered), then create or join a Group.

## Answer

> **Changed to guest accounts (2026-11-16).** Pushing the email template failed because the free Supabase tier rejects template changes without custom SMTP, so the MVP sends no email (see decisions.md). Sign-in is now Supabase **anonymous sign-in plus a display name**:
> - **Flow:** `(auth)/welcome` ("No email or password. Your account lives on this device.") → `(auth)/name` (first/last; `signInAsGuest` in `src/lib/auth.ts` calls `signInAnonymously({ options: { data: { display_name } } })`) → onboarding: notifications → join or create. The progress dots span name → notifications → join (`ONBOARDING_STEPS` in `gate.ts`). Onboarding's own welcome and name steps are gone (the welcome copy and features moved to the auth welcome screen).
> - **Removed:** the email and code screens, `sendSignInCode`/`verifySignInCode`, the email/code validators, `OTP_LENGTH`/`OTP_RESEND_COOLDOWN_SECONDS`, and the code error messages (`authErrors.ts` now maps only `signInAnonymously` errors).
> - **Config:** `enable_anonymous_sign_ins = true`; the template sections, `otp_length` and `max_frequency` were reset to the remote values, and `config push` is done (`config diff` is empty). `supabase/templates/otp-code.html` is kept, unreferenced, for when custom SMTP exists.
> - **The sign-up trigger** (`handle_new_user`) already reads `raw_user_meta_data.display_name` and works for anonymous users, so there's no new migration.
> - **Profile:** shows "Guest account · on this device" instead of the email. The name is editable: `setDisplayName` (session) saves the profile, then runs `renameMember` in each active Group. **Sign out** always asks first in a bottom sheet (`ConfirmSheet`, `SignOutButton`), and warns guests that it can't be undone. The profile-error screen's Sign out uses the same sheet.
> - **Before launch:** "Save your account" (link an email or Apple/Google to the same user), and custom SMTP if email is used.
>
> The original email-code notes below are kept for history.

**Sign-in is a 6-digit email code, not a magic link**, so there are no deep links and it works the same on iOS, Android and web. `src/lib/auth.ts` calls `signInWithOtp({ email, options: { shouldCreateUser: true, data: { display_name } } })` and then `verifyOtp({ email, token, type: 'email' })`. Errors are in plain words (`src/lib/authErrors.ts`). For example, a wrong or expired code shows "That code didn't work. Check the email or send a new code." "Send a new code" has a 30-second cooldown.

**Email template:** `supabase/templates/otp-code.html` (subject "Your Rotaloop code is {{ .Token }}") is set for both `[auth.email.template.magic_link]` and `[auth.email.template.confirmation]` in `supabase/config.toml`, with `otp_length = 6` and `max_frequency = "30s"`. The rest of config.toml was aligned with the hosted project, so `npx supabase config diff` shows only these email changes. **The owner must run `npx supabase config push`**: it asks for confirmation, which wasn't bypassed. Until then the hosted project sends its default link email with an 8-digit code setting. The template hard-codes "Rotaloop" (it's static HTML), so if `APP_NAME` changes, update it and the subjects. The built-in Supabase sender is rate-limited to a few emails an hour. That's fine for development, but production needs custom SMTP (`[auth.email.smtp]`).

**Routes:**
- `(auth)`: `/welcome`, `/email`, `/code`.
- `(onboarding)`: `/onboarding`, with 4 steps from the prototype's `onbHTML`: welcome, name, notifications, and join or start.
- `(tabs)`.
- `/create-group`: a placeholder until ticket 06.

**Auth gate:** `SessionProvider` (`src/lib/session.tsx`) follows `onAuthStateChange` and loads the account's profile. The pure `gateFor()` (`src/lib/gate.ts`) decides the state: `auth`, `onboarding` (no `onboarding_completed_at`), `app`, `loading` (the splash stays up) or `profileError` (Retry or Sign out). The root layout puts each group behind a `Stack.Protected` guard. The pure `redirectFor()` also covers the URL the app opened on, such as `/` while signed out.

**Onboarding:**
- The name step is prefilled from `display_name` and saved as "First Last".
- Push is on by default. The notifications step asks for permission, gets the Expo push token (EAS projectId `28fc862c-…` in `src/config/app.ts` and `app.config.ts`) and calls `register_push_token` (`src/lib/push.ts`). If permission is denied, push is turned off. Push isn't available on web, simulators, or Expo Go on Android.
- The email and text toggles are stored, with a phone field (validated) when text is on.
- For "Join with an invite link", the link is only checked with `invite_link_preview`, which shows the group name. "Create a group" opens the placeholder. "I'll do this later" finishes onboarding.
- Finishing sets `onboarding_completed_at` and the device `time_zone`.

**Profile tab:**
- Name, email and group count.
- Reminder timing chips (`reminder_days_before`), reminder time chips (`reminder_time`), and push/email/text toggles plus phone.
- "Coverage Requests" and "Schedule changes" toggles.
- For Admins, the alert lead time.
- Sign out.

Changes show immediately and are saved to `profiles` under RLS. If a save fails, the profile is re-fetched and a plain error is shown.

**UI added:** `TextField`/`FieldLabel`, `Chip`/`ChipGroup`, `SettingsList`/`SwitchRow`/`ValueRow`/`IconTile`, `Notice`, `FormScreen`/`StepDots`, `AppMark`, and Button `quiet`/`destructive` variants plus `loading`. Also the `chipOn`/`onChipOn` tokens. Tap targets are at least 48px, dark mode is supported, and forms avoid the keyboard.

**Tests:** `src/lib/tests/` (gate, redirect, validation, invite token parsing, auth error messages, resend cooldown, notification prefs).

**Left for later:**
- Real join and create (ticket 06). The invite link checked during onboarding isn't kept.
- Showing notifications and the notification handler (ticket 11).
- Web push.
