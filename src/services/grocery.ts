import { Result } from 'better-result';
import { invalidInput } from '../errors.ts';
import { logEvent } from '../logging.ts';
import type { BrowserRunBinding } from '../types.ts';

type BrowserWorker = { fetch: typeof fetch };
type Locator = {
  first(): Locator;
  fill(value: string, options?: Record<string, unknown>): Promise<unknown>;
  click(options?: Record<string, unknown>): Promise<unknown>;
  innerText(options?: Record<string, unknown>): Promise<string>;
  scrollIntoViewIfNeeded(options?: Record<string, unknown>): Promise<unknown>;
  getByRole(role: string, options?: Record<string, unknown>): Locator;
  locator(selector: string): Locator;
};
type Page = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  waitForLoadState(
    state?: 'load' | 'domcontentloaded' | 'networkidle',
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  keyboard: { press(key: string): Promise<unknown> };
  getByRole(role: string, options?: Record<string, unknown>): Locator;
  getByLabel(text: RegExp): Locator;
  getByPlaceholder(text: RegExp): Locator;
  getByText(text: RegExp): Locator;
  locator(selector: string): Locator;
};

export type GroceryCartRequest = {
  prompt: string;
  dryRun?: boolean;
};

export type GroceryCartAction = {
  type: 'add' | 'remove' | 'update';
  item: string;
  quantity?: string;
  raw: string;
};

export type GroceryBrowserSnapshot = {
  url: string;
  status: 'captured' | 'failed' | 'unavailable';
  markdownPreview?: string;
  error?: string;
};

export type GroceryCartSummary = {
  status: 'mutated' | 'browser-inspected' | 'needs-credentials' | 'needs-browser' | 'failed';
  plannedActions: GroceryCartAction[];
  actionsTaken: string[];
  cartItems: string[];
  reviewRequired: string[];
  browserSnapshot?: GroceryBrowserSnapshot;
  checkoutBlocked: true;
};

type GroceryEnv = Pick<
  Env,
  | 'IMPERFECT_EMAIL'
  | 'IMPERFECT_PASSWORD'
  | 'IMPERFECT_FOODS_USERNAME'
  | 'IMPERFECT_FOODS_PASSWORD'
  | 'BROWSER'
>;

const imperfectHomeUrl = 'https://www.imperfectfoods.com/';
const checkoutPattern =
  /\b(check\s*out|checkout|place\s+(the\s+)?order|buy\s+now|submit\s+order|pay\b)/i;

const actionPatterns: Array<{ type: GroceryCartAction['type']; pattern: RegExp }> = [
  {
    type: 'add',
    pattern:
      /\b(?:add|get|include|put)\s+(.+?)(?:\s+(?:to|in)\s+(?:the\s+)?(?:cart|box|order|list))?$/i,
  },
  {
    type: 'remove',
    pattern:
      /\b(?:remove|delete|skip|drop)\s+(.+?)(?:\s+from\s+(?:the\s+)?(?:cart|box|order|list))?$/i,
  },
  {
    type: 'update',
    pattern: /\b(?:update|change|set)\s+(.+?)\s+(?:to|=)\s+(.+)$/i,
  },
];

export function parseGroceryCartActions(prompt: string): GroceryCartAction[] {
  return prompt
    .split(/[\n.;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((raw): GroceryCartAction[] => {
      for (const { type, pattern } of actionPatterns) {
        const match = raw.match(pattern);
        if (!match) {
          continue;
        }

        if (type === 'update') {
          return [{ type, item: normalizeItem(match[1]), quantity: match[2].trim(), raw }];
        }

        return [{ type, item: normalizeItem(match[1]), raw }];
      }

      return [];
    });
}

export async function runGroceryCartRequest(request: GroceryCartRequest, env: GroceryEnv) {
  const prompt = request.prompt.trim();

  if (!prompt) {
    return Result.err(invalidInput('Missing grocery request'));
  }

  const plannedActions = parseGroceryCartActions(prompt);
  logEvent('info', 'grocery.request', {
    actionCount: plannedActions.length,
    dryRun: Boolean(request.dryRun),
  });
  const reviewRequired = buildInitialReviewItems(prompt, plannedActions, env);
  const credentials = getImperfectCredentials(env);

  if (!credentials) {
    const browserSnapshot = await inspectImperfectProduce(env.BROWSER);
    return Result.ok({
      status: 'needs-credentials',
      plannedActions,
      actionsTaken: [],
      cartItems: [],
      reviewRequired: [...reviewRequired, 'Imperfect Produce credentials are not configured.'],
      browserSnapshot,
      checkoutBlocked: true,
    } satisfies GroceryCartSummary);
  }

  if (!env.BROWSER?.fetch) {
    return Result.ok({
      status: 'needs-browser',
      plannedActions,
      actionsTaken: [],
      cartItems: [],
      reviewRequired: [
        ...reviewRequired,
        'Browser Run binding is unavailable in this environment.',
      ],
      browserSnapshot: { url: imperfectHomeUrl, status: 'unavailable' },
      checkoutBlocked: true,
    } satisfies GroceryCartSummary);
  }

  if (request.dryRun || plannedActions.length === 0) {
    const authenticated = await inspectAuthenticatedImperfectProduceCart(env.BROWSER, credentials);
    return Result.ok({
      status: authenticated.status,
      plannedActions,
      actionsTaken: authenticated.actionsTaken,
      cartItems: authenticated.cartItems,
      reviewRequired: [...reviewRequired, ...authenticated.reviewRequired],
      browserSnapshot: authenticated.browserSnapshot,
      checkoutBlocked: true,
    } satisfies GroceryCartSummary);
  }

  const automation = await mutateImperfectProduceCart(env.BROWSER, {
    email: credentials.email,
    password: credentials.password,
    actions: plannedActions,
  });

  logEvent('info', 'grocery.automation_complete', {
    status: automation.status,
    actionsTaken: automation.actionsTaken.length,
    cartItems: automation.cartItems.length,
  });

  return Result.ok({
    status: automation.status,
    plannedActions,
    actionsTaken: automation.actionsTaken,
    cartItems: automation.cartItems,
    reviewRequired: [...reviewRequired, ...automation.reviewRequired],
    browserSnapshot: automation.browserSnapshot,
    checkoutBlocked: true,
  } satisfies GroceryCartSummary);
}

function normalizeItem(item: string): string {
  return item
    .replace(/\bplease\b/gi, '')
    .replace(/\bthanks?\b/gi, '')
    .trim();
}

function buildInitialReviewItems(
  prompt: string,
  plannedActions: GroceryCartAction[],
  env: GroceryEnv,
): string[] {
  const items: string[] = [];

  if (checkoutPattern.test(prompt)) {
    items.push('Checkout and order placement are blocked by policy. Review the cart manually.');
  }

  if (plannedActions.length === 0) {
    items.push('No explicit add/remove/update grocery cart action was found.');
  }

  if (getImperfectCredentials(env) && plannedActions.length > 0) {
    items.push('Live Imperfect Produce cart mutation is allowed for these requested edits.');
  }

  return items;
}

function getImperfectCredentials(env: GroceryEnv): { email: string; password: string } | null {
  const email = env.IMPERFECT_EMAIL || env.IMPERFECT_FOODS_USERNAME;
  const password = env.IMPERFECT_PASSWORD || env.IMPERFECT_FOODS_PASSWORD;

  return email && password ? { email, password } : null;
}

async function inspectImperfectProduce(
  browser: BrowserRunBinding | undefined,
): Promise<GroceryBrowserSnapshot> {
  if (!browser?.quickAction) {
    return { url: imperfectHomeUrl, status: 'unavailable' };
  }

  try {
    const response = await browser.quickAction('markdown', { url: imperfectHomeUrl });
    const data = await readQuickActionResponse(response);

    return {
      url: imperfectHomeUrl,
      status: 'captured',
      markdownPreview: data.slice(0, 1000),
    };
  } catch (error) {
    return {
      url: imperfectHomeUrl,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mutateImperfectProduceCart(
  browserBinding: BrowserWorker,
  input: {
    email: string;
    password: string;
    actions: GroceryCartAction[];
  },
): Promise<
  Pick<
    GroceryCartSummary,
    'status' | 'actionsTaken' | 'cartItems' | 'reviewRequired' | 'browserSnapshot'
  >
> {
  const { launch } = await import('@cloudflare/playwright');
  const browser = await launch(browserBinding);
  const page = await browser.newPage();

  try {
    await page.goto(imperfectHomeUrl, { waitUntil: 'domcontentloaded' });
    await loginToImperfectProduce(page, input.email, input.password);
    await openCartSurface(page);

    const actionsTaken: string[] = [];
    const reviewRequired: string[] = [];

    for (const action of input.actions) {
      const result = await applyGroceryAction(page, action);
      if (result.taken) {
        actionsTaken.push(result.message);
      } else {
        reviewRequired.push(result.message);
      }
    }

    const cartItems = await readCartItems(page);
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');

    return {
      status: actionsTaken.length > 0 ? 'mutated' : 'failed',
      actionsTaken,
      cartItems,
      reviewRequired: [
        ...reviewRequired,
        'Review the Imperfect Produce cart manually before the order window closes.',
      ],
      browserSnapshot: {
        url: page.url(),
        status: 'captured',
        markdownPreview: bodyText.slice(0, 1000),
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      actionsTaken: [],
      cartItems: [],
      reviewRequired: [error instanceof Error ? error.message : String(error)],
      browserSnapshot: {
        url: page.url() || imperfectHomeUrl,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    await browser.close();
  }
}

async function inspectAuthenticatedImperfectProduceCart(
  browserBinding: BrowserWorker,
  credentials: { email: string; password: string },
): Promise<
  Pick<
    GroceryCartSummary,
    'status' | 'actionsTaken' | 'cartItems' | 'reviewRequired' | 'browserSnapshot'
  >
> {
  const { launch } = await import('@cloudflare/playwright');
  const browser = await launch(browserBinding);
  const page = await browser.newPage();

  try {
    await page.goto(imperfectHomeUrl, { waitUntil: 'domcontentloaded' });
    await loginToImperfectProduce(page, credentials.email, credentials.password);
    await openCartSurface(page);
    const cartItems = await readCartItems(page);
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');

    return {
      status: 'browser-inspected',
      actionsTaken: [],
      cartItems,
      reviewRequired: ['Review the authenticated Imperfect Produce cart manually.'],
      browserSnapshot: {
        url: page.url(),
        status: 'captured',
        markdownPreview: bodyText.slice(0, 1000),
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      actionsTaken: [],
      cartItems: [],
      reviewRequired: [error instanceof Error ? error.message : String(error)],
      browserSnapshot: {
        url: page.url() || imperfectHomeUrl,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    await browser.close();
  }
}

async function loginToImperfectProduce(page: Page, email: string, password: string): Promise<void> {
  await clickFirst(page, [
    () =>
      safeClick('sign in link', () =>
        page.getByRole('link', { name: /log\s*in|sign\s*in/i }).click({ timeout: 3000 }),
      ),
    () =>
      safeClick('sign in button', () =>
        page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click({ timeout: 3000 }),
      ),
  ]).catch(() => undefined);

  await fillFirst(page, [
    () => page.getByLabel(/email/i).fill(email, { timeout: 5000 }),
    () => page.locator('input[type="email"]').first().fill(email, { timeout: 5000 }),
    () => page.locator('input[name*="email" i]').first().fill(email, { timeout: 5000 }),
  ]);

  await fillFirst(page, [
    () => page.getByLabel(/password/i).fill(password, { timeout: 5000 }),
    () => page.locator('input[type="password"]').first().fill(password, { timeout: 5000 }),
  ]);

  await clickFirst(page, [
    () =>
      safeClick('submit sign in button', () =>
        page.getByRole('button', { name: /log\s*in|sign\s*in|continue/i }).click({ timeout: 5000 }),
      ),
    () =>
      safeClick('submit login form button', () =>
        page.locator('button[type="submit"]').first().click({ timeout: 5000 }),
      ),
  ]);

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

async function openCartSurface(page: Page): Promise<void> {
  await clickFirst(page, [
    () =>
      safeClick('open cart link', () =>
        page.getByRole('link', { name: /cart|box|basket/i }).click({ timeout: 5000 }),
      ),
    () =>
      safeClick('open cart button', () =>
        page.getByRole('button', { name: /cart|box|basket/i }).click({ timeout: 5000 }),
      ),
  ]).catch(() => undefined);
}

async function applyGroceryAction(page: Page, action: GroceryCartAction) {
  if (action.type === 'add') {
    return addGroceryItem(page, action);
  }

  if (action.type === 'remove') {
    return removeGroceryItem(page, action);
  }

  return updateGroceryItem(page, action);
}

async function addGroceryItem(page: Page, action: GroceryCartAction) {
  await fillFirst(page, [
    () => page.getByRole('searchbox').fill(action.item, { timeout: 5000 }),
    () => page.getByPlaceholder(/search/i).fill(action.item, { timeout: 5000 }),
    () => page.locator('input[type="search"]').first().fill(action.item, { timeout: 5000 }),
  ]);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  await clickFirst(page, [
    () =>
      safeClick(`add ${action.item}`, () =>
        page
          .getByRole('button', {
            name: new RegExp(
              `add.*${escapeRegex(action.item)}|${escapeRegex(action.item)}.*add`,
              'i',
            ),
          })
          .first()
          .click({ timeout: 5000 }),
      ),
    () =>
      safeClick('add visible item button', () =>
        page
          .getByRole('button', { name: /add|\+/i })
          .first()
          .click({ timeout: 5000 }),
      ),
  ]);

  return { taken: true, message: `Added ${action.item} to the live cart.` };
}

async function removeGroceryItem(page: Page, action: GroceryCartAction) {
  const item = page.getByText(new RegExp(escapeRegex(action.item), 'i')).first();
  await item.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await clickFirst(page, [
    () =>
      safeClick(`remove ${action.item}`, () =>
        item
          .locator('xpath=ancestor::*[self::li or self::div][1]')
          .getByRole('button', { name: /remove|delete|minus|−|-/i })
          .click({ timeout: 5000 }),
      ),
    () =>
      safeClick(`remove ${action.item} button`, () =>
        page
          .getByRole('button', {
            name: new RegExp(
              `remove.*${escapeRegex(action.item)}|${escapeRegex(action.item)}.*remove`,
              'i',
            ),
          })
          .click({ timeout: 5000 }),
      ),
  ]);

  return { taken: true, message: `Removed ${action.item} from the live cart.` };
}

async function updateGroceryItem(page: Page, action: GroceryCartAction) {
  const item = page.getByText(new RegExp(escapeRegex(action.item), 'i')).first();
  await item.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const container = item.locator('xpath=ancestor::*[self::li or self::div][1]');
  await fillFirst(page, [
    () => container.getByRole('spinbutton').fill(action.quantity ?? '', { timeout: 5000 }),
    () =>
      container
        .locator('input[type="number"]')
        .first()
        .fill(action.quantity ?? '', { timeout: 5000 }),
  ]);

  return { taken: true, message: `Updated ${action.item} to ${action.quantity}.` };
}

async function readCartItems(page: Page): Promise<string[]> {
  const text = await page
    .locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .slice(0, 30);
}

async function clickFirst(_page: Page, actions: Array<() => Promise<unknown>>): Promise<void> {
  const errors: string[] = [];
  for (const action of actions) {
    try {
      await action();
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[0] || 'No matching clickable control found.');
}

async function fillFirst(_page: Page, actions: Array<() => Promise<unknown>>): Promise<void> {
  const errors: string[] = [];
  for (const action of actions) {
    try {
      await action();
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[0] || 'No matching input field found.');
}

async function safeClick(description: string, action: () => Promise<unknown>) {
  if (checkoutPattern.test(description)) {
    throw new Error(`Blocked unsafe grocery automation click: ${description}`);
  }

  return action();
}

async function readQuickActionResponse(response: Response | Record<string, unknown> | string) {
  if (typeof response === 'string') {
    return response;
  }

  if (response instanceof Response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return extractMarkdown((await response.json()) as unknown);
    }

    return response.text();
  }

  return extractMarkdown(response);
}

function extractMarkdown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const markdown = record.markdown ?? record.content ?? record.text ?? record.result;
    if (typeof markdown === 'string') {
      return markdown;
    }
  }

  return JSON.stringify(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
