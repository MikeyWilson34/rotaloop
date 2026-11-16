/** Form helpers for sign-in, onboarding and Profile. Pure: unit-tested under Node. */

/** The profile's `display_name` limit (see the profiles table). */
export const DISPLAY_NAME_MAX = 80;

/** Joins first and last name into a display name, collapsing extra spaces. */
export function joinName(first: string, last: string): string {
  return [first, last]
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ')
    .slice(0, DISPLAY_NAME_MAX);
}

/** Splits a display name into first name (the first word) and last name (the rest). */
export function splitName(displayName: string): { first: string; last: string } {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? '', last: words.slice(1).join(' ') };
}

/** Initials for an avatar: first letters of the first and last words. */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** The profiles table allows up to 32 characters. */
export const PHONE_MAX = 32;

export function normalizePhone(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, PHONE_MAX);
}

/** Accepts common formats ("(555) 123-4567", "+44 7700 900123"): 7 to 15 digits and phone punctuation. */
export function isValidPhone(input: string): boolean {
  const phone = normalizePhone(input);
  if (!/^\+?[\d\s().-]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}
