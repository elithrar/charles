import { describe, expect, it } from 'vitest';
import {
  classifyEmailIntent,
  defaultFromIdentity,
  formatEmailAddress,
  normalizeEmailAddress,
  requireAllowlistedSender,
} from '../src/email.ts';

function unwrap<T>(result: { value?: T; error?: unknown }) {
  if ('error' in result) {
    throw result.error;
  }

  return result.value;
}

describe('email helpers', () => {
  it('normalizes display-name email addresses', () => {
    expect(unwrap(normalizeEmailAddress('Matt <MATT@EATSLEEPREPEAT.NET>'))).toBe(
      'matt@eatsleeprepeat.net',
    );
  });

  it('rejects non-allowlisted senders', () => {
    const result = requireAllowlistedSender('stranger@example.com');
    expect('error' in result ? result.error._tag : undefined).toBe('Unauthorized');
  });

  it('classifies grocery, research, parts, and general prompts', () => {
    expect(classifyEmailIntent('Cart', 'add apples to imperfect')).toBe('grocery');
    expect(classifyEmailIntent('Research', 'find sources on browser rendering')).toBe('research');
    expect(classifyEmailIntent('911 parts', 'look at Pelican and FCP Euro')).toBe('parts-search');
    expect(classifyEmailIntent('hello', 'what is on my calendar?')).toBe('general');
  });

  it('formats Charles from identity with display name', () => {
    const identity = defaultFromIdentity({ AGENT_FROM_EMAIL: 'charles@questionable.services' });
    expect(identity).toEqual({
      email: 'charles@questionable.services',
      name: 'Charles, your Agent',
    });
    expect(formatEmailAddress(identity)).toBe(
      '"Charles, your Agent" <charles@questionable.services>',
    );
  });
});
