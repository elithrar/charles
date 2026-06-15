import { beforeEach, describe, expect, it, vi } from 'vitest';

const closeMcp = vi.hoisted(() => vi.fn(async () => undefined));
const connectMcpServer = vi.hoisted(() => vi.fn(async () => ({ tools: [], close: closeMcp })));

vi.mock('@flue/runtime', () => ({
  connectMcpServer,
  createAgent: vi.fn((factory) => ({ factory })),
  defineTool: vi.fn((tool) => tool),
  Type: {
    Array: vi.fn((items, options) => ({ type: 'array', items, ...options })),
    Literal: vi.fn((value) => ({ const: value })),
    Object: vi.fn((properties) => ({ type: 'object', properties })),
    Optional: vi.fn((schema) => ({ ...schema, optional: true })),
    String: vi.fn((options) => ({ type: 'string', ...options })),
    Union: vi.fn((anyOf) => ({ anyOf })),
  },
}));

vi.mock('../.agents/skills/research/SKILL.md', () => ({ default: 'research skill' }));

describe('research workflow', () => {
  beforeEach(() => {
    closeMcp.mockClear();
    connectMcpServer.mockClear();
  });

  it('prefetches supplied prompt URLs with Browser Run markdown context', async () => {
    const { run } = await import('../src/workflows/research.ts');
    const quickAction = vi.fn(async () => ({ markdown: '# Example\n\nRendered page text.' }));
    const skill = vi.fn(async (_name, { args }) => ({
      text: `Used ${args.context}\nhttps://example.com/source`,
    }));

    const result = await run({
      id: 'url-test',
      env: { BROWSER: { quickAction } } as unknown as Env,
      payload: { prompt: 'Summarize https://example.com/source for me.' },
      init: vi.fn(async () => ({
        session: vi.fn(async () => ({ skill })),
      })),
    } as never);

    expect(quickAction).toHaveBeenCalledWith('markdown', { url: 'https://example.com/source' });
    expect(skill).toHaveBeenCalledWith(
      'research',
      expect.objectContaining({
        args: expect.objectContaining({
          context: expect.stringContaining('Rendered page text.'),
        }),
      }),
    );
    expect(result).toMatchObject({
      answer: expect.stringContaining('Rendered page text.'),
      citations: [{ url: 'https://example.com/source', summary: 'Referenced in research answer.' }],
    });
  });

  it('keeps Browser Run available when prompts do not supply URLs', async () => {
    const { run } = await import('../src/workflows/research.ts');
    const quickAction = vi.fn(async () => ({ markdown: '# Search result\n\nRendered evidence.' }));
    const init = vi.fn(async (agent, _options) => {
      const configured = agent.factory({ env: { BROWSER: { quickAction } } });
      const browserRun = configured.tools.find(
        (tool: { name: string }) => tool.name === 'browser_run',
      );

      return {
        session: vi.fn(async () => ({
          skill: vi.fn(async (_name, { args }) => {
            const evidence = await browserRun.execute({
              action: 'markdown',
              url: 'https://example.com/search',
            });
            return { text: `${args.context}\n${evidence}\nhttps://example.com/search` };
          }),
        })),
      };
    });

    const result = await run({
      id: 'no-url-test',
      env: { BROWSER: { quickAction } } as unknown as Env,
      payload: { prompt: 'Find current sources on Browser Run.' },
      init,
    } as never);

    expect(quickAction).toHaveBeenCalledWith('markdown', { url: 'https://example.com/search' });
    expect(result.answer).toContain('Use Browser Run if current rendered page evidence is needed.');
    expect(result.citations).toEqual([
      { url: 'https://example.com/search', summary: 'Referenced in research answer.' },
    ]);
  });
});
