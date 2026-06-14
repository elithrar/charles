import { describe, expect, it, vi } from 'vitest';
import { createBrowserRunTools } from '../src/tools/browser-run.ts';

describe('Browser Run tools', () => {
  it('exposes a browsing and navigation tool with clear capabilities', async () => {
    const quickAction = vi.fn(async () => ({ markdown: '# Example\n\nCurrent page.' }));
    const [tool] = createBrowserRunTools({ BROWSER: { quickAction } as never });

    expect(tool.name).toBe('browser_run');
    expect(tool.description).toContain('Browse and navigate the live web');
    expect(tool.description).toContain('Navigate by calling this tool on a URL');

    const result = await tool.execute({ action: 'markdown', url: 'https://example.com/' });

    expect(quickAction).toHaveBeenCalledWith('markdown', { url: 'https://example.com/' });
    expect(result).toContain('Current page');
  });

  it('rejects non-web URLs', async () => {
    const [tool] = createBrowserRunTools({ BROWSER: { quickAction: vi.fn() } as never });

    await expect(tool.execute({ action: 'markdown', url: 'file:///etc/passwd' })).rejects.toThrow(
      'http:// or https://',
    );
  });
});
