---
name: browser-run
description: Drives rendered browser sessions with Playwright MCP and Cloudflare Browser Run binding BROWSER. Use when inspecting live pages, debugging UI flows, extracting rendered content, taking screenshots, or using project browser helpers backed by Cloudflare Browser Run.
---

# Browser Run

Use Playwright MCP for interactive browser work and project browser helpers backed by Cloudflare Browser Run. Treat the browser as live external state: inspect before acting, keep steps targeted, and cite observed URLs when reporting findings.

## How It Uses Playwright

- For agent-driven browsing, use the available Playwright MCP browser tools to navigate, snapshot the accessibility tree, click, type, select, wait, evaluate page state, and capture screenshots.
- Cloudflare Browser Run provides the remote browser through the project `BROWSER` binding. The agent does not need a local browser install or local Playwright executable.
- Use existing project Browser Run tools for quick actions when available instead of inventing new automation paths.
- Prefer Browser Run quick actions for simple rendered-page reading, link extraction, screenshots, PDFs, and narrow scraping when the project exposes helpers for them.

## MCP Workflow

- Navigate to the target URL first.
- Snapshot before referencing elements. Use refs or accessible names from the latest snapshot.
- Re-snapshot after navigation, modal/menu changes, tab changes, or any interaction that substantially changes the DOM.
- Use screenshots when visual layout, styling, or evidence matters. Use snapshots for reliable interaction.
- Use evaluation only for page state that cannot be obtained from snapshots or visible text.
- Keep interactions reversible unless the user explicitly asked for mutation.

## Guardrails

- Use existing Browser Run helpers before asking for new browser plumbing.
- Keep browser-backed work on the Cloudflare Browser Run path through `BROWSER`; do not ask the user to install local browser tooling.
- Validate that requested navigation targets are normal `http://` or `https://` URLs when accepting user input.
- Do not click checkout, payment, destructive, or irreversible controls unless the user explicitly requested that exact action and project policy allows it.
- Capture only the artifacts needed for the task.

## Reporting

- Summarize what was observed, what actions were taken, and any remaining uncertainty.
- Include URLs used as evidence.
- If a page cannot be reached, say what failed and what would be needed next.
