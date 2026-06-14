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
    ['grocery-cart', inboundPayload('Cart', 'Add bananas to my Imperfect cart.')],
    ['research', inboundPayload('Research', 'Find sources on Cloudflare Browser Run.')],
    ['parts-search', inboundPayload('911 parts', 'Look for Pelican Parts alternator options.')],
  ] as const)('routes %s prompts through child workflow admission', async (workflow, payload) => {
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
      { prompt: payload.text },
      expect.objectContaining({ origin: 'https://charles.internal' }),
    );
    expect(workflowMocks.recordWorkflowHistory).toHaveBeenCalledWith(
      expect.objectContaining({ INTERNAL_AUTH_SECRET: 'internal-secret' }),
      expect.objectContaining({ workflow, status: 'ok', requestedBy: 'matt@eatsleeprepeat.net' }),
    );
    expect(result).toMatchObject({ childWorkflow: { workflow, ok: true } });
  });
});
