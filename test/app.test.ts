import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  env: {},
}));

vi.mock('@flue/runtime', () => ({
  listRuns: vi.fn(async () => ({
    runs: [
      {
        runId: 'research-run-1',
        workflowName: 'research',
        status: 'completed',
        startedAt: '2026-06-19T14:02:00.000Z',
        endedAt: '2026-06-19T14:02:05.000Z',
        durationMs: 5000,
        isError: false,
      },
    ],
  })),
  registerProvider: vi.fn(),
}));

vi.mock('@flue/runtime/routing', async () => {
  const { Hono } = await import('hono');

  return {
    flue: () => new Hono(),
  };
});

const env = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-local-tests',
  INTERNAL_AUTH_SECRET: 'test-internal-secret',
  BROWSER: {},
  EMAIL: { send: vi.fn() },
  AUTH_STORE: {
    getByName: () => ({
      getRecentEmailThreads: vi.fn(async () => ({
        items: [
          {
            threadKey: 'matt@eatsleeprepeat.net::research request',
            from: 'matt@eatsleeprepeat.net',
            subject: 'Research request',
            intent: 'research',
            latestAt: '2026-06-19T14:00:00.000Z',
            messageCount: 2,
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      })),
      getEmailThread: vi.fn(async () => [
        {
          id: 'message-2',
          threadKey: 'matt@eatsleeprepeat.net::research request',
          from: 'charles@questionable.services',
          fromName: 'Charles, your Agent',
          subject: 'Research request',
          intent: 'research',
          direction: 'outbound',
          bodyMarkdown: '**Here** is what I found: https://example.com',
          receivedAt: '2026-06-19T14:01:00.000Z',
        },
        {
          id: 'message-1',
          threadKey: 'matt@eatsleeprepeat.net::research request',
          from: 'matt@eatsleeprepeat.net',
          subject: 'Research request',
          intent: 'research',
          direction: 'inbound',
          bodyMarkdown: 'Please research this.',
          receivedAt: '2026-06-19T14:00:00.000Z',
        },
      ]),
      getRecentUserLogins: vi.fn(async () => [
        {
          email: 'matt@eatsleeprepeat.net',
          timestamp: '2026-06-19T15:00:00.000Z',
        },
      ]),
    }),
  },
  WORKFLOW_STORE: { getByName: () => ({}) },
  FLUE_SCHEDULER_AGENT: {
    idFromName: () => ({}),
    get: () => ({
      sendTestGroceryReminder: vi.fn(async () => ({ sent: true, localDate: 'test-2026-06-19' })),
      getScheduleState: vi.fn(async () => ({ healthy: true, scheduleCount: 1 })),
      repairSchedules: vi.fn(async () => ({ healthy: true, scheduleCount: 1 })),
      getRecentGroceryReminders: vi.fn(async () => [
        {
          localDate: '2026-06-19',
          generatedAt: '2026-06-19T13:00:00.000Z',
          recipients: ['matt@eatsleeprepeat.net'],
          grocery: {
            status: 'browser-inspected',
            actionsTaken: [],
            cartItems: [],
            reviewRequired: ['Review manually.'],
            checkoutBlocked: true,
          },
          subject: 'Charles grocery reminder for 2026-06-19',
          text: 'Friday grocery reminder for 2026-06-19.',
        },
      ]),
    }),
  },
} as unknown as Env;

describe('app routes', () => {
  it('serves the public home page', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(new Request('https://charles.test/'), env);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<span>Pleased to meet you.</span>');
    expect(html).toMatch(/<span>I(?:'|&#x27;)m Charles\.<\/span>/);
    expect(html).toContain('https://github.com/elithrar/charles');
  });

  it('serves the login page outside authentication', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(new Request('https://charles.test/login'), env);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('/kumo.css');
    expect(html).toContain('charles-login-card');
    expect(html).toContain('#F5F4EC');
    expect(html).not.toContain('passkey-sign-in');
    expect(html).toContain('/api/auth/sign-in/magic-link');
    expect(html).not.toContain('@better-auth/passkey');
  });

  it('serves Kumo styles', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(new Request('https://charles.test/kumo.css'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
  });

  it('protects allowlist route', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(new Request('https://charles.test/api/auth/allowlist'), env);
    expect(response.status).toBe(401);
  });

  it('protects direct Flue route groups', async () => {
    const { default: app } = await import('../src/app.ts');
    const responses = await Promise.all([
      app.fetch(new Request('https://charles.test/agents/charles/default'), env),
      app.fetch(new Request('https://charles.test/workflows/grocery-cart'), env),
      app.fetch(new Request('https://charles.test/runs'), env),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it('exposes scheduler reminders to internal requests', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(
      new Request('https://charles.test/internal/scheduler/reminders', {
        headers: { 'x-charles-internal-auth': 'test-internal-secret' },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      reminders: [{ localDate: '2026-06-19' }],
    });
  });

  it('exposes protected scheduler test reminder route', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(
      new Request('https://charles.test/internal/scheduler/test-grocery-reminder', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-charles-internal-auth': 'test-internal-secret',
        },
        body: JSON.stringify({ localDate: '2026-06-19' }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { sent: true, localDate: 'test-2026-06-19' },
    });
  });

  it('exposes scheduler state and repair details to internal requests', async () => {
    const { default: app } = await import('../src/app.ts');
    const stateResponse = await app.fetch(
      new Request('https://charles.test/internal/scheduler/state', {
        headers: { 'x-charles-internal-auth': 'test-internal-secret' },
      }),
      env,
    );
    const bootstrapResponse = await app.fetch(
      new Request('https://charles.test/internal/scheduler/bootstrap', {
        method: 'POST',
        headers: { 'x-charles-internal-auth': 'test-internal-secret' },
      }),
      env,
    );

    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({
      ok: true,
      state: { healthy: true, scheduleCount: 1 },
    });
    expect(bootstrapResponse.status).toBe(200);
    await expect(bootstrapResponse.json()).resolves.toMatchObject({
      ok: true,
      state: { healthy: true, scheduleCount: 1 },
      reminders: [{ localDate: '2026-06-19' }],
    });
  });

  it('serves the dashboard to internal requests', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(
      new Request('https://charles.test/dashboard', {
        headers: { 'x-charles-internal-auth': 'test-internal-secret' },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('/kumo.css');
    expect(html).toContain('charles-dashboard');
    expect(html).toContain('#F5F4EC');
    expect(html).not.toContain('Repair scheduler');
    expect(html).toContain('/dashboard?tab=dashboard');
    expect(html).toContain('/dashboard?tab=emails');
    expect(html).toContain('/dashboard?tab=groceries');
    expect(html).toContain('/dashboard?tab=workflows');
    expect(html).toContain('/dashboard?tab=settings');
    expect(html).toContain('At a glance');
    expect(html).toContain('research / completed');
    expect(html).toContain('/runs/research-run-1');
    expect(html).not.toContain('Recent email threads');
  });

  it('serves dashboard tab content to internal requests', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(
      new Request('https://charles.test/dashboard?tab=emails', {
        headers: { 'x-charles-internal-auth': 'test-internal-secret' },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Recent email threads');
    expect(html).toContain('<table');
    expect(html).toContain('Research request');
    expect(html).not.toContain('passkey-add');
  });

  it('serves settings with logins, MCP servers, and bundled skills', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(
      new Request('https://charles.test/dashboard?tab=settings', {
        headers: { 'x-charles-internal-auth': 'test-internal-secret' },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Recent logins');
    expect(html).toContain('matt@eatsleeprepeat.net');
    expect(html).toContain('MCP servers');
    expect(html).toContain('https://api.githubcopilot.com/mcp/');
    expect(html).toContain('https://apigw.americanexpress.com/dining/v1/mcp');
    expect(html).toContain('Bundled skills');
    expect(html).toContain('grocery');
    expect(html).not.toContain('passkey-add');
    expect(html).not.toContain('Register this device as a passkey');
  });

  it('serves an email thread detail page', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(
      new Request(
        'https://charles.test/dashboard/threads/matt%40eatsleeprepeat.net%3A%3Aresearch%20request',
        {
          headers: { 'x-charles-internal-auth': 'test-internal-secret' },
        },
      ),
      env,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Back to dashboard');
    expect(html).toContain('charles-dashboard-back');
    expect(html).toContain('charles-thread-sender');
    expect(html).toContain('Copy sender email');
    expect(html).toContain('navigator.clipboard.writeText');
    expect(html).toContain('Charles, your Agent');
    expect(html).toContain('<strong>Here</strong>');
    expect(html).toContain('https://example.com');
  });

  it('serves styled not found pages', async () => {
    const { default: app } = await import('../src/app.ts');
    const response = await app.fetch(new Request('https://charles.test/nope'), env);

    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('Sorry sir, there&#x27;s nothing here.');
    expect(html).toContain('#F5F4EC');
  });
});
