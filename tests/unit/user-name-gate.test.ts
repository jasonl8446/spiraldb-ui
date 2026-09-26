import { describe, expect, it } from 'vitest';

import {
  resolveUserNameAction,
  USER_NAME_MAX_LENGTH,
  UserNameCancelledError,
  validateUserName,
} from '../../client/src/lib/user-name';

/**
 * Task 1.7 acceptance: the identity gate asks once and never again. The gate's
 * whole decision surface is one pure function, so it is fully covered here in
 * node — no jsdom, no React, no network (decision D10).
 */

describe('validateUserName', () => {
  it('trims a real name', () => {
    expect(validateUserName('  jason  ')).toEqual({ ok: true, name: 'jason' });
  });

  it('rejects blank and whitespace-only values', () => {
    expect(validateUserName('').ok).toBe(false);
    expect(validateUserName('   ').ok).toBe(false);
    expect(validateUserName('\n\t ').ok).toBe(false);
  });

  it('accepts exactly the cap and rejects one character more', () => {
    const atCap = 'a'.repeat(USER_NAME_MAX_LENGTH);
    expect(validateUserName(atCap)).toEqual({ ok: true, name: atCap });

    const overCap = validateUserName('a'.repeat(USER_NAME_MAX_LENGTH + 1));
    expect(overCap.ok).toBe(false);
    expect(overCap.ok === false && overCap.error).toContain(String(USER_NAME_MAX_LENGTH));
  });

  it('measures the cap after trimming', () => {
    const padded = `  ${'a'.repeat(USER_NAME_MAX_LENGTH)}  `;
    expect(validateUserName(padded)).toEqual({ ok: true, name: 'a'.repeat(USER_NAME_MAX_LENGTH) });
  });
});

describe('resolveUserNameAction — an existing name short-circuits', () => {
  it('resolves immediately without prompting', () => {
    expect(resolveUserNameAction('jason')).toEqual({
      kind: 'resolved',
      name: 'jason',
      prompted: false,
    });
  });

  it('normalises the stored value even when the settings row is padded', () => {
    expect(resolveUserNameAction('  jason ')).toEqual({
      kind: 'resolved',
      name: 'jason',
      prompted: false,
    });
  });

  it('ignores anything the dialog might send once a name exists — it never re-asks', () => {
    expect(resolveUserNameAction('jason', 'someone-else')).toEqual({
      kind: 'resolved',
      name: 'jason',
      prompted: false,
    });
    expect(resolveUserNameAction('jason', null)).toEqual({
      kind: 'resolved',
      name: 'jason',
      prompted: false,
    });
  });
});

describe('resolveUserNameAction — a blank name opens the dialog', () => {
  it('prompts when the stored value is empty or whitespace and nothing was entered', () => {
    expect(resolveUserNameAction('')).toEqual({ kind: 'prompt' });
    expect(resolveUserNameAction('   ')).toEqual({ kind: 'prompt' });
    expect(resolveUserNameAction(undefined)).toEqual({ kind: 'prompt' });
    expect(resolveUserNameAction(null)).toEqual({ kind: 'prompt' });
  });

  it('rejects an empty or whitespace-only submission with an inline error, not a name', () => {
    expect(resolveUserNameAction('', '')).toEqual({
      kind: 'invalid',
      error: 'Enter your name to continue.',
    });
    expect(resolveUserNameAction('', '   ')).toEqual({
      kind: 'invalid',
      error: 'Enter your name to continue.',
    });
  });

  it('rejects an over-long submission', () => {
    const decision = resolveUserNameAction('', 'a'.repeat(USER_NAME_MAX_LENGTH + 1));
    expect(decision.kind).toBe('invalid');
  });

  it('resolves with the trimmed entered name once the user submits', () => {
    expect(resolveUserNameAction('', '  Alice  ')).toEqual({
      kind: 'resolved',
      name: 'Alice',
      prompted: true,
    });
  });

  it('cancels when the dialog is dismissed, so the caller aborts instead of saving a blank', () => {
    expect(resolveUserNameAction('', null)).toEqual({ kind: 'cancelled' });
    expect(resolveUserNameAction('   ', null)).toEqual({ kind: 'cancelled' });
  });
});

describe('UserNameCancelledError', () => {
  it('is a distinguishable Error a caller can catch', () => {
    const error = new UserNameCancelledError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UserNameCancelledError');
    expect(error.message).not.toBe('');
  });
});
