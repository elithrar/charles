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

  it('plans account, delivery, and preference actions distinctly', () => {
    expect(
      parseGroceryCartActions(
        'List my cart. When does my shopping window close? Skip next week. Always add oat milk. Never send cilantro.',
      ),
    ).toEqual([
      { type: 'list-cart', raw: 'List my cart' },
      { type: 'check-window', raw: 'When does my shopping window close' },
      { type: 'skip-delivery', raw: 'Skip next week' },
      { type: 'add-recurring', item: 'oat milk', raw: 'Always add oat milk' },
      { type: 'block-item', item: 'cilantro', raw: 'Never send cilantro' },
    ]);
  });

  it('plans combined cart and shopping-window reads', () => {
    expect(parseGroceryCartActions('Show my current cart and shopping window.')).toEqual([
      { type: 'list-cart', raw: 'Show my current cart and shopping window' },
      { type: 'check-window', raw: 'Show my current cart and shopping window' },
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
