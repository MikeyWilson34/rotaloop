/// <reference types="node" />
/**
 * Runs the Supabase migrations in PGlite (in-process Postgres) for tests, with just
 * enough of Supabase stubbed: the anon / authenticated / service_role roles, their
 * default grants, and an `auth` schema whose `auth.uid()` reads the
 * `request.jwt.claim.sub` setting (as Supabase's own did).
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GroupRows } from '../groupRows';
import { persistPayload, type GroupStore, type PersistInput } from '../handleGroupCommand';

// Vitest runs from the repo root.
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;

  -- Supabase's defaults: the API roles get everything on new objects in public.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export type Role = 'anon' | 'authenticated' | 'service_role';

export interface TestDb {
  db: PGlite;
  /** Runs `fn` as the given role, signed in as `accountId` (or signed out). */
  as<T>(role: Role, accountId: string | null, fn: () => Promise<T>): Promise<T>;
  /** Shorthand for `as('authenticated', accountId, ...)`. */
  asUser<T>(accountId: string, fn: () => Promise<T>): Promise<T>;
  /** Creates an account (auth.users row, which also creates its profile). */
  createAccount(id: string, displayName?: string): Promise<void>;
  /** A GroupStore that talks to the database as service_role, like the Edge Function. */
  store: GroupStore;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  const as = async <T>(role: Role, accountId: string | null, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [accountId ?? '']);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  };

  const store: GroupStore = {
    load: (groupId) =>
      as('service_role', null, async () => {
        const { rows } = await db.query<{ rows: GroupRows & { group: { state_version: number } | null } }>(
          'select public.group_state_rows($1) as rows',
          [groupId],
        );
        const result = rows[0].rows;
        if (!result.group) return null;
        return { rows: result as GroupRows, version: Number(result.group.state_version) };
      }),
    persist: (input: PersistInput) =>
      as('service_role', null, async () => {
        const { rows } = await db.query<{ version: number | bigint | null }>(
          'select public.apply_group_command_result($1, $2, $3::jsonb, $4::jsonb) as version',
          [input.groupId, input.expectedVersion, JSON.stringify(persistPayload(input)), JSON.stringify(input.history)],
        );
        const version = rows[0].version;
        return version === null ? null : Number(version);
      }),
    findInvite: (token) =>
      as('service_role', null, async () => {
        const { rows } = await db.query<{ group_id: string; member_id: string | null }>(
          'select group_id, member_id from public.invite_links where token = $1',
          [token],
        );
        return rows[0] ? { groupId: rows[0].group_id, memberId: rows[0].member_id } : null;
      }),
    groupsWithRepeatingSeries: () =>
      as('service_role', null, async () => {
        const { rows } = await db.query<{ group_id: string }>(
          'select distinct group_id from public.event_series where removed_at is null and repeat is not null order by group_id',
        );
        return rows.map((r) => r.group_id);
      }),
    markDeleted: (groupId, accountId) =>
      as('service_role', null, async () => {
        const { rows } = await db.query<{ ok: boolean }>('select public.mark_group_deleted($1, $2) as ok', [groupId, accountId]);
        return rows[0].ok;
      }),
  };

  return {
    db,
    as,
    asUser: (accountId, fn) => as('authenticated', accountId, fn),
    createAccount: async (id, displayName) => {
      await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2::jsonb)', [
        id,
        JSON.stringify(displayName ? { display_name: displayName } : {}),
      ]);
    },
    store,
  };
}

/** Deterministic UUIDs for tests: uuid(1) = 00000000-0000-4000-8000-000000000001. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
