import { describe, expect, it } from 'vitest';
import { parseGroceryCartActions, runGroceryCartRequest } from '../src/services/grocery.ts';

describe('grocery service', () => {
  it('blocks checkout requests even when parsing a cart request', async () => {
    const result = await runGroceryCartRequest(
      { prompt: 'Add bananas and then check out.' },
      {
        IMPERFECT_EMAIL: 'user@example.com',
        IMPERFECT_PASSWORD: 'secret',
        BROWSER: undefined as never,
      },
    );

    expect('value' in result ? result.value.checkoutBlocked : false).toBe(true);
    expect('value' in result ? result.value.reviewRequired.join(' ') : '').toContain('Checkout');
  });

  it('plans explicit grocery mutations', () => {
    expect(parseGroceryCartActions('Add bananas. Remove kale. Update apples to 4.')).toEqual([
      { type: 'add', item: 'bananas', raw: 'Add bananas' },
      { type: 'remove', item: 'kale', raw: 'Remove kale' },
      { type: 'update', item: 'apples', quantity: '4', raw: 'Update apples to 4' },
    ]);
  });

  it('captures browser markdown when credentials are missing', async () => {
    const result = await runGroceryCartRequest(
      { prompt: 'Add pears.' },
      {
        IMPERFECT_EMAIL: undefined,
        IMPERFECT_PASSWORD: undefined,
        BROWSER: {
          fetch: fetch,
          quickAction: async () => ({ markdown: '# Imperfect Foods' }),
        },
      },
    );

    expect('value' in result ? result.value.status : undefined).toBe('needs-credentials');
    expect('value' in result ? result.value.browserSnapshot?.status : undefined).toBe('captured');
  });
});
