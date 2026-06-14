import { Type, defineTool } from '@flue/runtime';
import { logEvent } from '../logging.ts';
import type { BrowserRunBinding } from '../types.ts';

const MAX_TEXT_CHARS = 12_000;

const browserRunAction = Type.Union([
  Type.Literal('markdown'),
  Type.Literal('links'),
  Type.Literal('content'),
  Type.Literal('json'),
  Type.Literal('scrape'),
  Type.Literal('crawl'),
  Type.Literal('snapshot'),
  Type.Literal('screenshot'),
  Type.Literal('pdf'),
]);

type BrowserRunToolArgs = {
  action: string;
  url?: string;
  html?: string;
  prompt?: string;
  selector?: string;
  formats?: string[];
};

function validatePublicUrl(input: string | undefined) {
  if (!input) {
    return undefined;
  }

  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Browser Run only accepts http:// or https:// URLs.');
  }

  return url.toString();
}

function truncateText(text: string) {
  if (text.length <= MAX_TEXT_CHARS) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated: request a narrower page, selector, or URL if more detail is needed]`,
    truncated: true,
  };
}

async function normalizeQuickActionResult(result: Response | Record<string, unknown> | string) {
  if (typeof result === 'string') {
    const truncated = truncateText(result);
    return { output: truncated.text, truncated: truncated.truncated, contentType: 'text/plain' };
  }

  if (result instanceof Response) {
    const contentType = result.headers.get('content-type') ?? 'application/octet-stream';
    const browserMs = result.headers.get('x-browser-ms-used');

    if (/^(text\/|application\/(json|xml|xhtml\+xml))/.test(contentType)) {
      const body = await result.text();
      const truncated = truncateText(body);
      return {
        output: truncated.text,
        truncated: truncated.truncated,
        status: result.status,
        contentType,
        browserMs,
      };
    }

    const bytes = await result.arrayBuffer();
    return {
      output: `Captured ${bytes.byteLength} bytes of ${contentType}. Binary output is available to the application, but only metadata is returned to the model context.`,
      truncated: false,
      status: result.status,
      contentType,
      browserMs,
      bytes: bytes.byteLength,
    };
  }

  const serialized = JSON.stringify(result, null, 2);
  const truncated = truncateText(serialized);
  return {
    output: truncated.text,
    truncated: truncated.truncated,
    contentType: 'application/json',
  };
}

export function createBrowserRunTools(env: { BROWSER?: BrowserRunBinding }) {
  return [
    defineTool({
      name: 'browser_run',
      description:
        'Browse and navigate the live web with Cloudflare Browser Run. Use this when a user asks for current information, asks you to inspect a URL, compare pages, extract links, summarize rendered content, or gather citations. Navigate by calling this tool on a URL, then follow relevant returned links with another call. Prefer markdown for reading, links for navigation choices, json for structured extraction, scrape with a selector for narrow extraction, crawl for small multi-page site exploration, snapshot when both rendered structure and visual context matter, and screenshot/pdf only when visual or archival evidence is needed. Keep calls targeted and cite URLs from results in the final answer.',
      parameters: Type.Object({
        action: browserRunAction,
        url: Type.Optional(Type.String({ description: 'HTTP(S) URL to open or navigate to.' })),
        html: Type.Optional(
          Type.String({ description: 'Inline HTML to render instead of opening a URL.' }),
        ),
        prompt: Type.Optional(
          Type.String({
            description:
              'Extraction instructions for json, scrape, crawl, or snapshot requests. Keep narrow and specific.',
          }),
        ),
        selector: Type.Optional(
          Type.String({
            description: 'CSS selector for scrape requests when extracting specific elements.',
          }),
        ),
        formats: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal('html'),
              Type.Literal('markdown'),
              Type.Literal('screenshot'),
              Type.Literal('accessibilityTree'),
            ]),
            { description: 'Snapshot formats. Use at least two formats for snapshot.' },
          ),
        ),
      }),
      async execute(args) {
        const params = args as BrowserRunToolArgs;
        if (!env.BROWSER?.quickAction) {
          throw new Error('Browser Run quickAction binding is not available.');
        }

        const url = validatePublicUrl(params.url);
        if (!url && !params.html) {
          throw new Error('Browser Run requires either url or html.');
        }

        const options = {
          ...(url ? { url } : {}),
          ...(params.html ? { html: params.html } : {}),
          ...(params.prompt ? { prompt: params.prompt } : {}),
          ...(params.selector ? { selector: params.selector } : {}),
          ...(params.formats ? { formats: params.formats } : {}),
        };
        const result = await env.BROWSER.quickAction(params.action, options);
        const normalized = await normalizeQuickActionResult(result);
        const details = { action: params.action, url, ...normalized };
        logEvent('info', 'browser_run.quick_action', {
          action: params.action,
          url,
          truncated: normalized.truncated,
        });

        return JSON.stringify(details, null, 2);
      },
    }),
  ];
}

export const BROWSER_RUN_AGENT_INSTRUCTIONS = `
<browser_run_tool>
Use the browser_run tool for live web browsing, URL inspection, rendered-page reading, link discovery, structured extraction, screenshots, PDFs, and small crawls.

Tool-use policy:
- Use browser_run when the answer depends on current web content or a page the user asks you to inspect.
- Navigate by first calling browser_run with action "markdown" or "links" for a URL, then call it again on relevant returned links.
- Prefer narrow calls: markdown for reading, links for navigation, scrape with a selector for specific page sections, json for structured extraction, crawl only for small bounded explorations, and screenshot/pdf only when visual or archival evidence matters.
- Keep context compact. Do not paste whole pages into replies; summarize the relevant facts and cite the URLs you used.
- Treat Browser Run output as observed evidence. If a page cannot be fetched or content is missing, say what failed and what would be needed next.
</browser_run_tool>`;
