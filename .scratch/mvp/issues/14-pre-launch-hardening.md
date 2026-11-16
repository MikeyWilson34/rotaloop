# 14 Pre-launch hardening
Status: needs-triage
Blocked by: MVP features

Collected items that must happen before real users arrive:
- "Save your account": link email or Apple/Google to the guest (anonymous) account, keeping its id, groups and history.
- Custom SMTP (e.g. Resend with an owned domain) if email is used for sign-in or notifications; then restore the OTP template (supabase/templates/otp-code.html).
- Captcha on anonymous sign-in (Supabase supports hCaptcha/Turnstile).
- Hide the "Email" notification toggle until an account has an email address.
- Review the anonymous sign-up rate limit (30/hour/IP) for groups signing up together on one Wi-Fi.
- npm audit (10 moderate findings at scaffold time).
- Daylight-saving handling for repeating Time Off and Event times (see ticket 10 note).
- Remove the smoke-test data from the hosted project ("Smoke Test" user, "Smoke Test Group").
