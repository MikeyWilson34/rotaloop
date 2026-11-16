// Copies the pure TypeScript the Edge Functions share with the app (src/engine, src/db and
// src/schedule, without tests) into supabase/functions/_shared/, rewriting extensionless
// relative imports ("./commands", "../engine") into the explicit ".ts" paths Deno needs.
//
// Run by `npm run functions:sync` (and by functions:check / functions:deploy). The copies
// are generated and git-ignored: edit src/, never the copies in _shared/.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shared = join(root, 'supabase', 'functions', '_shared');
const sources = ['engine', 'db', 'schedule'];

function resolveSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(`${base}.ts`)) return `${specifier}.ts`;
  if (existsSync(join(base, 'index.ts'))) return `${specifier}/index.ts`;
  throw new Error(`${relative(root, fromFile)}: cannot resolve ${specifier}`);
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (statSync(source).isDirectory()) {
      if (name === 'tests' || name === 'node_modules') continue;
      copyDir(source, join(to, name));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      const code = readFileSync(source, 'utf8').replace(
        /(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]*?)\2/g,
        (match, lead, quote, specifier) =>
          /\.(ts|js|json)$/.test(specifier) ? match : `${lead}${quote}${resolveSpecifier(source, specifier)}${quote}`,
      );
      const header = `// GENERATED from ${relative(root, source).replaceAll('\\', '/')} by scripts/sync-functions-shared.mjs. Do not edit.\n`;
      writeFileSync(join(to, name), header + code);
    }
  }
}

for (const dir of sources) {
  rmSync(join(shared, dir), { recursive: true, force: true });
  copyDir(join(root, 'src', dir), join(shared, dir));
}
console.log(`Synced src/{${sources.join(',')}} -> supabase/functions/_shared/`);
