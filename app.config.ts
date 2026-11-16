// Lets this config import other TypeScript files (the app name lives in src/config/app.ts).
import 'tsx/cjs';

import type { ExpoConfig } from 'expo/config';

import { APP_NAME, APP_SCHEME, APP_SLUG, EAS_OWNER, EAS_PROJECT_ID } from './src/config/app';

const config: ExpoConfig = {
  name: APP_NAME,
  slug: APP_SLUG,
  owner: EAS_OWNER,
  scheme: APP_SCHEME,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    icon: './assets/expo.icon',
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#FAF7F2',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    // Single-page app: EAS Hosting serves index.html for any path, so deep links such as
    // /join/<token> load directly, and no page is rendered on a server (the app is behind
    // sign-in). scripts/web-postexport.ts adds the manifest and home-screen meta to index.html.
    // Deploy with npm run deploy:web (see README).
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-camera',
      {
        cameraPermission: `Allow ${APP_NAME} to use the camera to scan invite QR codes.`,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#3A6894',
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FAF7F2',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
        dark: { backgroundColor: '#11161F' },
      },
    ],
  ],
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
