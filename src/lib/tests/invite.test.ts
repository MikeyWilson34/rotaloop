import { describe, expect, it } from 'vitest';

import { DEFAULT_WEB_URL, WEB_URL } from '../../config/app';
import { inviteAppUrl, inviteTokenFromUrl, inviteUrl, parseInviteToken, resumeInviteRoute } from '../invite';

const token = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
const other = 'b'.repeat(64);

describe('inviteUrl', () => {
  it('is an https link to /join/<token> on the web app', () => {
    expect(inviteUrl(token, 'https://example.org')).toBe(`https://example.org/join/${token}`);
    expect(inviteUrl(token, 'https://example.org/')).toBe(`https://example.org/join/${token}`);
  });

  it('defaults to the configured web URL', () => {
    expect(WEB_URL.startsWith('https://')).toBe(true);
    expect(inviteUrl(token)).toBe(`${WEB_URL}/join/${token}`);
    expect(DEFAULT_WEB_URL).toBe('https://rotaloop.expo.app');
  });

  it('has an app-scheme form', () => {
    expect(inviteAppUrl(token, 'rotaloop')).toBe(`rotaloop://join/${token}`);
  });
});

describe('parseInviteToken (extended)', () => {
  it('reads the https link, the app-scheme link and a bare token', () => {
    expect(parseInviteToken(inviteUrl(token))).toBe(token);
    expect(parseInviteToken(inviteAppUrl(token, 'rotaloop'))).toBe(token);
    expect(parseInviteToken(token)).toBe(token);
  });

  it('reads any URL ending in /join/<token>, with a trailing slash, query or hash', () => {
    expect(parseInviteToken(`https://somewhere.example/app/join/${token}/`)).toBe(token);
    expect(parseInviteToken(`https://x.example/join/${token}?utm=chat`)).toBe(token);
    expect(parseInviteToken(`exp://192.168.1.2:8081/--/join/${token}#x`)).toBe(token);
  });

  it('accepts a link pasted with surrounding words', () => {
    expect(parseInviteToken(`Join us! https://rotaloop.expo.app/join/${token}`)).toBe(token);
  });

  it('prefers the /join/ token when another token-like string comes first', () => {
    expect(parseInviteToken(`https://x.example/${other}/join/${token}`)).toBe(token);
  });

  it('rejects text with no token', () => {
    expect(parseInviteToken('hello')).toBeNull();
    expect(parseInviteToken(`https://x.example/join/${token.slice(0, 63)}`)).toBeNull();
  });
});

describe('inviteTokenFromUrl', () => {
  it('only matches invite links', () => {
    expect(inviteTokenFromUrl(`https://rotaloop.expo.app/join/${token}`)).toBe(token);
    expect(inviteTokenFromUrl(`rotaloop://join/${token}`)).toBe(token);
    expect(inviteTokenFromUrl(`https://rotaloop.expo.app/welcome`)).toBeNull();
    expect(inviteTokenFromUrl(`https://rotaloop.expo.app/?t=${token}`)).toBeNull();
    expect(inviteTokenFromUrl(null)).toBeNull();
    expect(inviteTokenFromUrl(undefined)).toBeNull();
  });
});

describe('resumeInviteRoute', () => {
  it('waits while signed out, loading or onboarding', () => {
    expect(resumeInviteRoute('auth', token, '(auth)')).toBeNull();
    expect(resumeInviteRoute('loading', token, undefined)).toBeNull();
    expect(resumeInviteRoute('onboarding', token, '(onboarding)')).toBeNull();
    expect(resumeInviteRoute('profileError', token, undefined)).toBeNull();
  });

  it('opens the join screen once in the app', () => {
    expect(resumeInviteRoute('app', token, '(tabs)')).toBe(`/join/${token}`);
    // Right after onboarding finishes, still on the onboarding route.
    expect(resumeInviteRoute('app', token, '(onboarding)')).toBe(`/join/${token}`);
    expect(resumeInviteRoute('app', token, 'group')).toBe(`/join/${token}`);
  });

  it('does nothing on the join screen or without a pending invite', () => {
    expect(resumeInviteRoute('app', token, 'join')).toBeNull();
    expect(resumeInviteRoute('app', null, '(tabs)')).toBeNull();
  });
});
