// Finishes the web build after `expo export --platform web` (single-page output, dist/):
// - writes the web app manifest (dist/manifest.json),
// - adds the manifest link, theme colour, iOS "Add to Home Screen" meta and a safe-area
//   viewport to dist/index.html,
// - checks the Web Push service worker (public/sw.js) landed at dist/sw.js: served from the
//   site root, its scope is the whole app (ticket 11).
// Name and colours come from APP_NAME and the theme tokens, so they have one source. The icons
// are made from assets/images/icon.png and live in public/icons (the export copies them).
//
// Run by `npm run web:export` (and so by deploy:web and deploy:web:preview).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_NAME } from '../src/config/app';
import { colors } from '../src/theme/tokens';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) throw new Error('dist/index.html not found: run `expo export --platform web` first.');

const manifest = {
  name: APP_NAME,
  short_name: APP_NAME,
  description: 'Fair rotation of shared group responsibilities.',
  id: '/',
  start_url: '/',
  scope: '/',
  // Launches from the home screen full-screen, without browser toolbars.
  display: 'standalone',
  orientation: 'portrait',
  theme_color: colors.light.bg,
  background_color: colors.light.bg,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const name = escape(APP_NAME);

const head = `
    <meta name="description" content="${name}: fair rotation of shared group responsibilities." />
    <meta name="application-name" content="${name}" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${colors.light.bg}" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${colors.dark.bg}" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="${name}" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <style id="app-page">
      /* The page around the app column (see AppColumn), also before the app paints; no
         sideways scrolling at phone widths. */
      html, body { background-color: ${colors.light.surfaceAlt}; overflow-x: hidden; }
      @media (prefers-color-scheme: dark) { html, body { background-color: ${colors.dark.surfaceAlt}; } }
    </style>
`;

let html = readFileSync(indexPath, 'utf8');
if (html.includes('rel="manifest"')) {
  console.log('dist/index.html already has the web app tags');
} else {
  html = html
    // viewport-fit=cover lets the safe-area insets work on notched phones.
    .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />')
    .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    .replace('</head>', `${head}</head>`);
  if (!html.includes('rel="manifest"')) throw new Error('Could not add the web app tags to dist/index.html');
  writeFileSync(indexPath, html);
}
if (!existsSync(join(dist, 'sw.js'))) throw new Error('dist/sw.js not found: public/sw.js should be copied by the export.');
console.log('Wrote dist/manifest.json and the web app tags in dist/index.html; dist/sw.js is in place');
