import { describe, expect, it, vi } from 'vitest';
import { invokeInternalWorkflow } from '../src/services/workflows.ts';

describe('workflow services', () => {
  it('can invoke mounted workflow routes without public self-fetch', async () => {
    const fetchWorkflow = vi.fn(async (_request: Request) =>
      Response.json({ result: { answer: 'ok' } }),
    );

    const result = await invokeInternalWorkflow(
      { INTERNAL_AUTH_SECRET: 'internal-secret' } as Env,
      'research',
      'matt@eatsleeprepeat.net',
      { prompt: 'find sources' },
      { origin: 'https://charles.internal', fetchWorkflow },
    );

    const request = fetchWorkflow.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(request?.url).toBe('https://charles.internal/workflows/research?wait=result');
    expect(request?.headers.get('x-charles-internal-auth')).toBe('internal-secret');
    expect(request?.headers.get('x-charles-user')).toBe('matt@eatsleeprepeat.net');
    await expect(request?.clone().json()).resolves.toEqual({ prompt: 'find sources' });
    expect(result).toEqual({
      workflow: 'research',
      ok: true,
      status: 200,
      data: { result: { answer: 'ok' } },
    });
  });
});
