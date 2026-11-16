import { describe, expect, it } from 'vitest';

import { initials, isValidPhone, joinName, splitName } from '../validation';
import { parseInviteToken } from '../invite';

describe('names', () => {
  it('joins first and last name, tidying spaces', () => {
    expect(joinName('  Jordan ', ' Ellis ')).toBe('Jordan Ellis');
    expect(joinName('Mary  Ann', '')).toBe('Mary Ann');
    expect(joinName('', '')).toBe('');
  });

  it('caps the display name at 80 characters', () => {
    expect(joinName('a'.repeat(50), 'b'.repeat(50))).toHaveLength(80);
  });

  it('splits a display name into first word and the rest', () => {
    expect(splitName('Jordan Ellis')).toEqual({ first: 'Jordan', last: 'Ellis' });
    expect(splitName('Jordan van der Berg')).toEqual({ first: 'Jordan', last: 'van der Berg' });
    expect(splitName('  ')).toEqual({ first: '', last: '' });
  });

  it('makes initials', () => {
    expect(initials('Jordan Ellis')).toBe('JE');
    expect(initials('jordan')).toBe('J');
    expect(initials('Jordan van der Berg')).toBe('JB');
    expect(initials('')).toBe('?');
  });
});

describe('phone', () => {
  it.each(['(555) 123-4567', '+44 7700 900123', '555.123.4567'])('accepts %s', (phone) => {
    expect(isValidPhone(phone)).toBe(true);
  });

  it.each(['', '123', 'call me', '+1 (555) 123-4567 ext 9', '1234567890123456'])(
    'rejects "%s"',
    (phone) => {
      expect(isValidPhone(phone)).toBe(false);
    },
  );
});

describe('parseInviteToken', () => {
  const token = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';

  it('accepts a bare token', () => {
    expect(parseInviteToken(` ${token} `)).toBe(token);
  });

  it('finds the token in a link, in the path or the query', () => {
    expect(parseInviteToken(`https://rotaloop.app/join/${token}`)).toBe(token);
    expect(parseInviteToken(`rotaloop://join?token=${token}`)).toBe(token);
  });

  it('lowercases the token', () => {
    expect(parseInviteToken(token.toUpperCase())).toBe(token);
  });

  it('returns null when there is no token', () => {
    expect(parseInviteToken('')).toBeNull();
    expect(parseInviteToken('https://rotaloop.app/join/abc123')).toBeNull();
  });
});
