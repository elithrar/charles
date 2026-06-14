---
name: browser-run
description: Drives rendered browser sessions with Playwright MCP and Cloudflare Browser Run binding BROWSER. Use when inspecting live pages, debugging UI flows, extracting rendered content, taking screenshots, or writing Worker code that automates a browser with @cloudflare/playwright through env.BROWSER.
---

# Browser Run

Use Playwright MCP for interactive browser work and Cloudflare Browser Run for Worker-owned browser automation. Treat the browser as live external state: inspect before acting, keep steps targeted, and cite observed URLs when reporting findings.

## How It Uses Playwright

- For agent-driven browsing, use the available Playwright MCP browser tools to navigate, snapshot the accessibility tree, click, type, select, wait, evaluate page state, and capture screenshots.
- For application code running in Cloudflare Workers, use `@cloudflare/playwright` with the Browser Run binding: `launch(env.BROWSER)`.
- Do not add standalone browser automation dependencies when the project already has `@cloudflare/playwright` and a `BROWSER` binding.
- Prefer Browser Run quick actions for simple rendered-page reading, link extraction, screenshots, PDFs, and narrow scraping when the project exposes helpers for them.

## MCP Workflow

- Navigate to the target URL first.
- Snapshot before referencing elements. Use refs or accessible names from the latest snapshot.
- Re-snapshot after navigation, modal/menu changes, tab changes, or any interaction that substantially changes the DOM.
- Use screenshots when visual layout, styling, or evidence matters. Use snapshots for reliable interaction.
- Use evaluation only for page state that cannot be obtained from snapshots or visible text.
- Keep interactions reversible unless the user explicitly asked for mutation.

## Cloudflare Worker Pattern

Use this pattern when writing Browser Run automation in Worker code:

```ts
import { launch } from '@cloudflare/playwright';
import type { BrowserWorker } from '@cloudflare/playwright';

export async function inspectPage(browserBinding: BrowserWorker, url: string) {
  const browser = await launch(browserBinding);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    const text = await page.locator('body').innerText();

    return { title, text };
  } finally {
    await browser.close();
  }
}
```

Pass the binding from the Worker environment:

```ts
await inspectPage(env.BROWSER, 'https://example.com');
```

## Repo Guardrails

- Use existing Browser Run helpers before adding new browser plumbing.
- Keep Browser Run code behind the `BROWSER` binding; do not create a separate browser runtime path.
- Close browsers in `finally` blocks.
- Validate URLs before navigation when accepting user input.
- Do not click checkout, payment, destructive, or irreversible controls unless the user explicitly requested that exact action and project policy allows it.
- Capture only the artifacts needed for the task.

## Reporting

- Summarize what was observed, what actions were taken, and any remaining uncertainty.
- Include URLs used as evidence.
- If a page cannot be reached, say what failed and what would be needed next.
