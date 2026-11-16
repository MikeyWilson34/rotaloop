// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions are Deno code, checked with `npm run functions:check`.
    ignores: ['dist/*', '.expo/*', 'design/prototype/*', 'supabase/functions/*'],
  },
  {
    // The rotation engine and the db mapping (shared with Deno Edge Functions) stay pure:
    // no UI, platform or backend imports, and relative paths only.
    files: ['src/engine/**/*.ts', 'src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react-*',
            'react-native',
            'react-native-*',
            'expo',
            'expo-*',
            '@expo/*',
            '@supabase/*',
            '@/*',
          ],
        },
      ],
    },
  },
]);
