import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Banned-words check (simplify ticket 08). The UI speaks Group, Member, Stand-in, Job, Turn,
 * Headcount, Cover and Dates off (GLOSSARY.md). Engine words such as Event Series,
 * Responsibility or Make-up Turn may stay in code names, comments and types, but never in a
 * string a person could read.
 *
 * It parses every source file and checks its string literals, template text and JSX text.
 * Identifier-like strings (`'responsibilities'`, `'skipDate'`, colour tokens like `'primary'`)
 * are keys, not copy, so they are skipped.
 */

const ROOT = join(__dirname, '..', '..', '..');

const BANNED: { word: string; pattern: RegExp }[] = [
  { word: 'Event Series', pattern: /\bevent series\b/i },
  { word: 'Responsibility', pattern: /\bresponsibilit(y|ies)\b/i },
  { word: 'Qualified', pattern: /\b(un)?qualified\b/i },
  { word: 'Rebalance', pattern: /\brebalanc(e|ed|es|ing)\b/i },
  { word: 'Primary', pattern: /\bPrimary\b/ },
  { word: 'Replacement Duty', pattern: /\breplacement duty\b/i },
  { word: 'Guest Cover', pattern: /\bguest cover\b/i },
  { word: 'Coverage Policy', pattern: /\bcoverage policy\b/i },
  { word: 'Make-up Turn', pattern: /\bmake-?up turns?\b/i },
  { word: 'Skip Date', pattern: /\bskip dates?\b/i },
  // No Admins in the app for now (docs/adr/0006-members-only.md).
  { word: 'Admin', pattern: /\badmins?\b/i },
];

/** Source roots that hold user-facing text: screens, notifications, edge functions, web metadata. */
const SCAN = ['src', 'supabase/functions/group-command', 'supabase/functions/notify', 'app.config.ts', 'public/sw.js'];

/**
 * Not user-facing: tests (which quote the old words on purpose), generated database types, and
 * the engine and server request code. Their rejection strings are developer diagnostics: the app
 * only ever shows `groupCommandMessage(reason)` from `src/lib/groupErrors.ts`, which is scanned.
 */
const SKIP_DIRS = [['src', 'engine'], ['src', 'db']].map((parts) => parts.join(sep) + sep);

function skipFile(rel: string): boolean {
  return (
    rel.includes(`${sep}tests${sep}`) ||
    rel.endsWith('.test.ts') ||
    rel.endsWith('database.types.ts') ||
    SKIP_DIRS.some((dir) => rel.startsWith(dir))
  );
}

function listFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => listFiles(join(path, name)));
}

/** A key, id, token or path rather than copy: no spaces and starts lower-case. */
function isIdentifierLike(text: string): boolean {
  return /^[a-z_$][\w$.:/@-]*$/.test(text);
}

type Hit = { file: string; line: number; word: string; text: string };

/** Every string literal, template chunk and JSX text in a file, with its line. */
function strings(file: string, code: string): { text: string; line: number }[] {
  const kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      out.push({ text: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function hitsIn(file: string, code = readFileSync(file, 'utf8')): Hit[] {
  const name = relative(ROOT, file).split(sep).join('/');
  const hits: Hit[] = [];
  for (const { text, line } of strings(file, code)) {
    const trimmed = text.trim();
    if (!trimmed || isIdentifierLike(trimmed)) continue;
    for (const { word, pattern } of BANNED) {
      if (pattern.test(trimmed)) hits.push({ file: name, line, word, text: trimmed.slice(0, 80) });
    }
  }
  return hits;
}

function sourceFiles(): string[] {
  return SCAN.flatMap((p) => listFiles(join(ROOT, p)))
    .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
    .filter((f) => !skipFile(relative(ROOT, f)));
}

describe('user-facing vocabulary', () => {
  it('scans the screens, notifications and edge functions', () => {
    const files = sourceFiles().map((f) => relative(ROOT, f).split(sep).join('/'));
    expect(files).toEqual(expect.arrayContaining(['src/app/(tabs)/index.tsx', 'src/lib/groupErrors.ts', 'src/notify/plan.ts', 'supabase/functions/notify/index.ts']));
    expect(files.some((f) => f.startsWith('src/engine/'))).toBe(false);
  });

  it('catches copy but not code names, comments or colour tokens', () => {
    const code = [
      '// A Responsibility in a comment is fine',
      "const responsibilityName = 'primary';",
      'const a = <Text>Add a Responsibility</Text>;',
      'const b = `${n} Qualified Members`;',
      "const c = { label: 'Skip Date', tone: 'primary', key: 'makeUpTurns' };",
    ].join('\n');
    expect(hitsIn(join(ROOT, 'sample.tsx'), code).map((h) => h.word)).toEqual(['Responsibility', 'Qualified', 'Skip Date']);
  });

  it('uses no banned engine words in any string a person could read', () => {
    const hits = sourceFiles()
      .flatMap((f) => hitsIn(f))
      .map((h) => `${h.file}:${h.line} [${h.word}] ${h.text}`);
    expect(hits).toEqual([]);
  });
});
