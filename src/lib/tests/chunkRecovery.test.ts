import { describe, expect, it } from 'vitest';

import {
  RELOAD_KEY,
  RELOAD_WINDOW_MS,
  cacheBustingUrl,
  chunkRecoveryScript,
  claimAutoReload,
  isChunkLoadError,
} from '../chunkRecovery';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe('isChunkLoadError', () => {
  it('recognises failed code loads', () => {
    expect(isChunkLoadError(new Error('Loading module /_expo/static/js/web/x.js failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Requiring unknown module "1234".'))).toBe(true);
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
    expect(isChunkLoadError(new SyntaxError("Unexpected token '<'"))).toBe(true);
    expect(isChunkLoadError('Failed to fetch dynamically imported module: https://x/a.js')).toBe(true);
  });

  it('ignores ordinary bugs and HTML-instead-of-JSON responses', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isChunkLoadError(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('claimAutoReload', () => {
  it('allows one reload a minute', () => {
    const storage = memoryStorage();
    expect(claimAutoReload(storage, 1_000_000)).toBe(true);
    expect(storage.map.get(RELOAD_KEY)).toBe('1000000');
    expect(claimAutoReload(storage, 1_000_000 + 5_000)).toBe(false);
    expect(claimAutoReload(storage, 1_000_000 + RELOAD_WINDOW_MS)).toBe(true);
  });

  it('never auto-reloads without storage (no loop guard)', () => {
    expect(claimAutoReload(null, 1)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(claimAutoReload(broken, 1)).toBe(false);
  });
});

describe('cacheBustingUrl', () => {
  it('keeps the path and query', () => {
    expect(cacheBustingUrl('https://app.example/group/g1?tab=settings', 42)).toBe(
      'https://app.example/group/g1?tab=settings&_reload=42',
    );
  });
});

describe('chunkRecoveryScript', () => {
  it('is valid JavaScript that is safe to inline', () => {
    const script = chunkRecoveryScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/<\/script/i);
  });
});
