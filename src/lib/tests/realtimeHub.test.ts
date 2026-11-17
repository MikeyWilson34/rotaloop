import { describe, expect, it, vi } from 'vitest';

import { bindingsKey, createRealtimeHub, type ChannelLike, type PgBinding, type RealtimeClientLike } from '../realtimeHub';

/**
 * A fake Supabase client that behaves like realtime-js 2.119: `channel()` hands back the
 * existing channel for a reused topic, `on()` throws once the channel is subscribed, and
 * `removeChannel()` only drops the channel asynchronously.
 */
function fakeClient() {
  type FakeChannel = ChannelLike & {
    topic: string;
    joined: boolean;
    removed: boolean;
    callbacks: { filter: PgBinding; callback: (payload: unknown) => void }[];
    emit(table: string, payload?: unknown): void;
  };
  const channels: FakeChannel[] = [];
  const all: FakeChannel[] = [];
  const client: RealtimeClientLike = {
    channel(topic) {
      const existing = channels.find((c) => c.topic === topic);
      if (existing) return existing;
      const ch: FakeChannel = {
        topic,
        joined: false,
        removed: false,
        callbacks: [],
        on(_type, filter, callback) {
          if (ch.joined) throw new Error(`cannot add postgres_changes callbacks for realtime:${topic} after subscribe().`);
          ch.callbacks.push({ filter, callback });
          return ch;
        },
        subscribe() {
          ch.joined = true;
          return ch;
        },
        emit(table, payload = { table }) {
          if (ch.removed) return;
          for (const c of ch.callbacks) if (c.filter.table === table) c.callback(payload);
        },
      };
      channels.push(ch);
      all.push(ch);
      return ch;
    },
    removeChannel(channel) {
      const ch = channel as FakeChannel;
      ch.removed = true;
      // Like realtime-js: the channel leaves the list only once unsubscribing finishes.
      return Promise.resolve().then(() => {
        channels.splice(channels.indexOf(ch), 1);
        return 'ok';
      });
    },
  };
  const live = () => all.filter((c) => !c.removed);
  return { client, all, live };
}

const groupBindings = (id: string): PgBinding[] => [
  { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${id}` },
  { event: '*', schema: 'public', table: 'members', filter: `group_id=eq.${id}` },
];

describe('realtime hub', () => {
  it('shares one channel between subscribers with the same bindings and fans changes out', () => {
    const { client, all } = fakeClient();
    const hub = createRealtimeHub(client, { releaseDelayMs: 0 });
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe('group', groupBindings('g1'), a);
    // The Assignment screen mounts over the Group screen: this used to throw.
    expect(() => hub.subscribe('group', groupBindings('g1'), b)).not.toThrow();
    expect(all).toHaveLength(1);
    all[0].emit('members');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('keeps the channel until the last subscriber leaves (ref counting)', () => {
    const { client, all, live } = fakeClient();
    const hub = createRealtimeHub(client, { releaseDelayMs: 0 });
    const under = vi.fn();
    const offUnder = hub.subscribe('group', groupBindings('g1'), under);
    const offOver = hub.subscribe('group', groupBindings('g1'), vi.fn());
    offOver(); // leaving the Assignment screen
    expect(live()).toHaveLength(1);
    all[0].emit('groups');
    expect(under).toHaveBeenCalledTimes(1); // the Group screen still gets live updates
    offUnder();
    expect(live()).toHaveLength(0);
    expect(hub.channelCount()).toBe(0);
    offUnder(); // idempotent
  });

  it('survives a StrictMode double mount (subscribe, unsubscribe, subscribe)', async () => {
    const { client, all, live } = fakeClient();
    const hub = createRealtimeHub(client, { releaseDelayMs: 0 });
    const listener = vi.fn();
    const off1 = hub.subscribe('my-schedule', groupBindings('g1'), listener);
    off1();
    // The old channel is still being removed when the second mount subscribes.
    expect(() => hub.subscribe('my-schedule', groupBindings('g1'), listener)).not.toThrow();
    await Promise.resolve();
    expect(live()).toHaveLength(1);
    expect(new Set(all.map((c) => c.topic)).size).toBe(all.length); // never reuses a topic
    live()[0].emit('members');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reuses the channel through the grace period after the last subscriber leaves', () => {
    vi.useFakeTimers();
    try {
      const { client, all, live } = fakeClient();
      const hub = createRealtimeHub(client, { releaseDelayMs: 1000 });
      const off = hub.subscribe('activity', groupBindings('g1'), vi.fn());
      off();
      const listener = vi.fn();
      const off2 = hub.subscribe('activity-badge', groupBindings('g1'), listener);
      vi.advanceTimersByTime(5000);
      expect(all).toHaveLength(1);
      all[0].emit('groups');
      expect(listener).toHaveBeenCalledTimes(1);
      off2();
      expect(live()).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(live()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches topics when the Group changes on a mounted screen', () => {
    const { client, all, live } = fakeClient();
    const hub = createRealtimeHub(client, { releaseDelayMs: 0 });
    const listener = vi.fn();
    const off1 = hub.subscribe('group', groupBindings('g1'), listener);
    // The effect re-runs: subscribe to the new Group, then clean up the old one.
    const off2 = hub.subscribe('group', groupBindings('g2'), listener);
    off1();
    expect(live()).toHaveLength(1);
    expect(live()[0].callbacks[0].filter.filter).toBe('id=eq.g2');
    all[0].emit('groups');
    expect(listener).not.toHaveBeenCalled();
    live()[0].emit('groups');
    expect(listener).toHaveBeenCalledTimes(1);
    off2();
    expect(hub.channelCount()).toBe(0);
  });

  it('tears everything down on sign-out, and late unsubscribes are harmless', () => {
    const { client, all, live } = fakeClient();
    const hub = createRealtimeHub(client, { releaseDelayMs: 1000 });
    const listener = vi.fn();
    const offA = hub.subscribe('group', groupBindings('g1'), listener);
    hub.subscribe('my-memberships', [{ event: '*', schema: 'public', table: 'members', filter: 'account_id=eq.u1' }], listener);
    hub.removeAll();
    expect(live()).toHaveLength(0);
    expect(hub.channelCount()).toBe(0);
    all[0].emit('groups');
    expect(listener).not.toHaveBeenCalled();
    expect(() => offA()).not.toThrow();
    // A new subscription after sign-in gets a fresh channel.
    hub.subscribe('group', groupBindings('g1'), listener);
    expect(live()).toHaveLength(1);
  });

  it('never throws into React when the client fails', () => {
    const onError = vi.fn();
    const client: RealtimeClientLike = {
      channel: () => {
        throw new Error('boom');
      },
      removeChannel: () => undefined,
    };
    const hub = createRealtimeHub(client, { releaseDelayMs: 0, onError });
    expect(() => hub.subscribe('group', groupBindings('g1'), vi.fn())()).not.toThrow();
    expect(onError).toHaveBeenCalled();
  });

  it('keys bindings regardless of their order', () => {
    const [x, y] = groupBindings('g1');
    expect(bindingsKey([x, y])).toBe(bindingsKey([y, x]));
    expect(bindingsKey([x])).not.toBe(bindingsKey([y]));
  });
});
