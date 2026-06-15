import { beforeEach, describe, expect, it, vi } from 'vitest';

const appFetch = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
  env: {},
}));

vi.mock('cloudflare:email', () => ({
  EmailMessage: class {
    from: string;
    to: string;
    raw: string;

    constructor(from: string, to: string, raw: string) {
      this.from = from;
      this.to = to;
      this.raw = raw;
    }
  },
}));

vi.mock('../src/app.ts', () => ({
  default: { fetch: appFetch },
}));

function rawEmail(body = 'Hello Charles', from = 'Matt <matt@eatsleeprepeat.net>') {
  return [
    `From: ${from}`,
    'To: charles@questionable.services',
    'Subject: Test thread',
    'Message-ID: <message-1@example.com>',
    'References: <parent@example.com>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

function streamFromText(text: string) {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

function emailMessage(overrides: Partial<ForwardableEmailMessage> = {}) {
  const raw = overrides.raw ?? streamFromText(rawEmail());
  return {
    from: 'matt@eatsleeprepeat.net',
    to: 'charles@questionable.services',
    raw,
    rawSize: rawEmail().length,
    headers: new Headers(),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(async () => ({ messageId: 'reply-id' })),
    ...overrides,
  } as unknown as ForwardableEmailMessage & {
    setReject: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  };
}

function executionContext() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext,
    pending,
  };
}

describe('Cloudflare email handler', () => {
  beforeEach(() => {
    appFetch.mockReset();
  });

  it('rejects unparseable messages without replying', async () => {
    const { default: handler } = await import('../src/cloudflare.ts');
    const message = emailMessage({
      raw: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('broken stream'));
        },
      }),
    });
    const { ctx } = executionContext();

    await handler.email?.(message, {} as Env, ctx);

    expect(message.setReject).toHaveBeenCalledWith('Charles could not parse that email safely.');
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('falls back to EMAIL.send with display name and thread headers', async () => {
    const { default: handler } = await import('../src/cloudflare.ts');
    const send = vi.fn(async () => ({ messageId: 'fallback-id' }));
    const recordEmailThread = vi.fn(async () => undefined);
    const message = emailMessage({
      reply: vi.fn(async () => Promise.reject(new Error('reply failed'))),
    });
    const { ctx, pending } = executionContext();

    appFetch.mockResolvedValue(
      Response.json({
        result: {
          replyText: 'Reply **body**',
          childWorkflow: {
            workflow: 'research',
            ok: true,
            status: 200,
            data: { result: { answer: 'ok' } },
          },
        },
      }),
    );

    await handler.email?.(
      message,
      {
        INTERNAL_AUTH_SECRET: 'internal-secret',
        EMAIL: { send },
        AUTH_STORE: { getByName: () => ({ recordEmailThread }) },
      } as unknown as Env,
      ctx,
    );
    await Promise.all(pending);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { email: 'charles@questionable.services', name: 'Charles, your Agent' },
        to: 'matt@eatsleeprepeat.net',
        html: expect.stringContaining('<strong'),
        headers: {
          'In-Reply-To': '<message-1@example.com>',
          References: '<parent@example.com>',
        },
      }),
    );
    expect(recordEmailThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadKey: 'matt@eatsleeprepeat.net::test thread',
        inboundText: expect.stringContaining('Hello Charles'),
        replyText: 'Reply **body**',
      }),
    );
  });

  it('records the reply only after successful direct delivery', async () => {
    const { default: handler } = await import('../src/cloudflare.ts');
    const recordEmailThread = vi.fn(async () => undefined);
    const message = emailMessage();
    const { ctx, pending } = executionContext();

    appFetch.mockResolvedValue(
      Response.json({
        result: {
          replyText: 'Delivered reply',
          childWorkflow: {
            workflow: 'research',
            ok: true,
            status: 200,
            data: { result: { answer: 'ok' } },
          },
        },
      }),
    );

    await handler.email?.(
      message,
      {
        INTERNAL_AUTH_SECRET: 'internal-secret',
        EMAIL: { send: vi.fn(async () => ({ messageId: 'unused' })) },
        AUTH_STORE: { getByName: () => ({ recordEmailThread }) },
      } as unknown as Env,
      ctx,
    );
    await Promise.all(pending);

    const workflowRequest = appFetch.mock.calls[0]?.[0];
    expect(workflowRequest).toBeInstanceOf(Request);
    expect(workflowRequest?.url).toBe(
      'https://charles.internal/workflows/email-prompt?wait=result',
    );
    expect(workflowRequest?.headers.get('x-charles-internal-auth')).toBe('internal-secret');
    expect(workflowRequest?.headers.get('x-charles-user')).toBe('matt@eatsleeprepeat.net');
    await expect(workflowRequest?.clone().json()).resolves.toMatchObject({
      from: 'matt@eatsleeprepeat.net',
      subject: 'Test thread',
      text: expect.stringContaining('Hello Charles'),
    });
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.reply.mock.calls[0]?.[0].raw).toContain('text/html');
    expect(recordEmailThread).toHaveBeenCalledWith(
      expect.objectContaining({ replyText: 'Delivered reply' }),
    );
  });

  it('sends and records a configuration fallback when internal auth is missing', async () => {
    const { default: handler } = await import('../src/cloudflare.ts');
    const recordEmailThread = vi.fn(async () => undefined);
    const message = emailMessage();
    const { ctx, pending } = executionContext();

    await handler.email?.(
      message,
      {
        EMAIL: { send: vi.fn(async () => ({ messageId: 'unused' })) },
        AUTH_STORE: { getByName: () => ({ recordEmailThread }) },
      } as unknown as Env,
      ctx,
    );
    await Promise.all(pending);

    expect(appFetch).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(recordEmailThread).toHaveBeenCalledWith(
      expect.objectContaining({
        replyText: 'Charles is missing internal workflow authentication configuration.',
      }),
    );
  });

  it('does not record an outbound reply when delivery fails completely', async () => {
    const { default: handler } = await import('../src/cloudflare.ts');
    const send = vi.fn(async () => Promise.reject(new Error('send failed')));
    const recordEmailThread = vi.fn(async () => undefined);
    const message = emailMessage({
      reply: vi.fn(async () => Promise.reject(new Error('reply failed'))),
    });
    const { ctx, pending } = executionContext();

    appFetch.mockResolvedValue(
      Response.json({
        result: {
          replyText: 'Undelivered reply',
          childWorkflow: {
            workflow: 'research',
            ok: true,
            status: 200,
            data: { result: { answer: 'ok' } },
          },
        },
      }),
    );

    await handler.email?.(
      message,
      {
        INTERNAL_AUTH_SECRET: 'internal-secret',
        EMAIL: { send },
        AUTH_STORE: { getByName: () => ({ recordEmailThread }) },
      } as unknown as Env,
      ctx,
    );

    await Promise.allSettled(pending);

    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(recordEmailThread).not.toHaveBeenCalled();
  });

  it('rejects non-allowlisted senders without workflow admission', async () => {
    const { default: handler } = await import('../src/cloudflare.ts');
    const message = emailMessage({
      from: 'stranger@example.com',
      raw: streamFromText(rawEmail('Hello Charles', 'Stranger <stranger@example.com>')),
    });
    const { ctx } = executionContext();

    await handler.email?.(
      message,
      {
        INTERNAL_AUTH_SECRET: 'internal-secret',
      } as unknown as Env,
      ctx,
    );

    expect(message.setReject).toHaveBeenCalledWith(
      'This address is not authorized to use Charles.',
    );
    expect(message.reply).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});
