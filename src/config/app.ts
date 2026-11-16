/**
 * The single source of truth for the app's name and identifiers.
 * "Rotaloop" is a working name: change it here and everywhere follows
 * (app.config.ts, the UI, and the URL scheme).
 *
 * Keep this file free of React Native imports: app.config.ts loads it under plain Node.
 */
export const APP_NAME = 'Rotaloop';
export const APP_SLUG = 'rotaloop';
export const APP_SCHEME = 'rotaloop';

/**
 * The Expo (EAS) project this app belongs to. Needed for Expo push tokens.
 * Not a secret: it ships in every build.
 */
export const EAS_PROJECT_ID = '28fc862c-d400-47f3-9568-228c043f78fd';
export const EAS_OWNER = 'mikeywilson';

/**
 * Where the web app is hosted. Shareable invite links point here (`<WEB_URL>/join/<token>`),
 * so they open in any browser; the app also accepts `<APP_SCHEME>://join/<token>`.
 * Set EXPO_PUBLIC_WEB_URL in .env to override the default.
 */
export const DEFAULT_WEB_URL = 'https://rotaloop.expo.app';
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || DEFAULT_WEB_URL).replace(/\/+$/, '');
