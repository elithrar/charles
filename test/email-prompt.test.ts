import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflowMocks = vi.hoisted(() => ({
  invokeInternalWorkflow: vi.fn(),
  recordWorkflowHistory: vi.fn(async () => undefined),
  summarizeWorkflowResult: vi.fn(() => 'workflow summary'),
}));

vi.mock('../src/services/workflows.ts', () => workflowMocks);

function inboundPayload(subject: string, text: string) {
  return {
    from: 'matt@eatsleeprepeat.net',
    to: 'charles@questionable.services',
    subject,
    text,
    receivedAt: '2026-06-19T14:00:00.000Z',
  };
}

describe('email-prompt workflow routing', () => {
  beforeEach(() => {
    workflowMocks.invokeInternalWorkflow.mockReset();
    workflowMocks.recordWorkflowHistory.mockClear();
    workflowMocks.summarizeWorkflowResult.mockClear();
    workflowMocks.invokeInternalWorkflow.mockImplementation(async (_env, workflow) => ({
      workflow,
      ok: true,
      status: 200,
      data: { result: { answer: 'ok' } },
    }));
  });

  it.each([
    [
      'grocery-cart',
      inboundPayload('Cart', 'Add bananas to my Imperfect cart.'),
      { prompt: 'Add bananas to my Imperfect cart.' },
      'I reviewed the grocery request. Checkout is blocked. workflow summary',
    ],
    [
      'research',
      inboundPayload('Research', 'Find sources on Cloudflare Browser Run.'),
      { prompt: 'Find sources on Cloudflare Browser Run.' },
      'workflow summary',
    ],
    [
      'research',
      inboundPayload(
        '911 parts',
        'Confirm a 1988 Carrera 3.2 injector harness part number and check Pelican, FCP Euro, and RockAuto.',
      ),
      {
        prompt:
          'Confirm a 1988 Carrera 3.2 injector harness part number and check Pelican, FCP Euro, and RockAuto.',
        mode: 'parts-search',
      },
      'workflow summary. Confirm the car, year, submodel, and VIN-sensitive fitment before ordering.',
    ],
  ] as const)(
    'routes %s prompts through child workflow admission',
    async (workflow, payload, childPayload, replyText) => {
      const { run } = await import('../src/workflows/email-prompt.ts');

      const result = await run({
        init: vi.fn(),
        payload,
        env: { INTERNAL_AUTH_SECRET: 'internal-secret' } as Env,
      } as never);

      expect(workflowMocks.invokeInternalWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ INTERNAL_AUTH_SECRET: 'internal-secret' }),
        workflow,
        'matt@eatsleeprepeat.net',
        childPayload,
        expect.objectContaining({ origin: 'https://charles.internal' }),
      );
      expect(workflowMocks.recordWorkflowHistory).toHaveBeenCalledWith(
        expect.objectContaining({ INTERNAL_AUTH_SECRET: 'internal-secret' }),
        expect.objectContaining({ workflow, status: 'ok', requestedBy: 'matt@eatsleeprepeat.net' }),
      );
      expect(result).toMatchObject({ childWorkflow: { workflow, ok: true } });
      expect(result.replyText).toBe(replyText);
    },
  );

  it('returns a friendly fallback when the general reply agent fails', async () => {
    const init = vi.fn(async () => ({
      session: vi.fn(async () => ({
        prompt: vi.fn(async () => {
          throw new Error('provider unavailable');
        }),
      })),
    }));
    const { run } = await import('../src/workflows/email-prompt.ts');

    const result = await run({
      init,
      payload: inboundPayload('Hello', 'Can you help me think through this?'),
      env: { INTERNAL_AUTH_SECRET: 'internal-secret' } as Env,
    } as never);

    expect(result).toMatchObject({
      intent: 'general',
      replyText:
        'Charles received your message, but the AI reply service is unavailable right now. Please try again later.',
    });
  });

  it('returns a friendly fallback when research child workflow fails', async () => {
    workflowMocks.invokeInternalWorkflow.mockImplementation(async (_env, workflow) => ({
      workflow,
      ok: false,
      status: 500,
      data: {},
    }));

    const { run } = await import('../src/workflows/email-prompt.ts');

    const result = await run({
      init: vi.fn(),
      payload: inboundPayload('Research', 'Find sources on Cloudflare Browser Run.'),
      env: { INTERNAL_AUTH_SECRET: 'internal-secret' } as Env,
    } as never);

    expect(result).toMatchObject({
      intent: 'research',
      replyText:
        'Charles could not complete that research right now because the AI research service is unavailable. Please try again later.',
    });
  });

  it('returns a friendly fallback when child workflow admission throws', async () => {
    workflowMocks.invokeInternalWorkflow.mockRejectedValue(new Error('workflow admission failed'));

    const { run } = await import('../src/workflows/email-prompt.ts');

    const result = await run({
      init: vi.fn(),
      payload: inboundPayload('Research', 'Find sources on Cloudflare Browser Run.'),
      env: { INTERNAL_AUTH_SECRET: 'internal-secret' } as Env,
    } as never);

    expect(result).toMatchObject({
      intent: 'research',
      replyText:
        'Charles could not complete that research right now because the AI research service is unavailable. Please try again later.',
    });
  });

  it('keeps the workflow reply when history recording fails after success', async () => {
    workflowMocks.recordWorkflowHistory.mockRejectedValueOnce(new Error('history unavailable'));

    const { run } = await import('../src/workflows/email-prompt.ts');

    const result = await run({
      init: vi.fn(),
      payload: inboundPayload('Research', 'Find sources on Cloudflare Browser Run.'),
      env: { INTERNAL_AUTH_SECRET: 'internal-secret' } as Env,
    } as never);

    expect(result).toMatchObject({
      intent: 'research',
      replyText: 'workflow summary',
      childWorkflow: { workflow: 'research', ok: true },
    });
  });
});
