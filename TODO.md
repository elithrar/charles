# Current App TODO

This file tracks what is still incomplete or risky in the current Charles app. Keep items here only when they need implementation, tests, or live verification.

## Verified Current State

- [x] Project deploys as Cloudflare Worker `charles` with Flue-generated config from `dist/charles/wrangler.json`.
- [x] Main checks pass: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- [x] Generated deploy dry-run passes with `pnpm exec wrangler deploy --dry-run --config dist/charles/wrangler.json`.
- [x] Live deploy succeeds; latest verified version is `37ca21ba-a2e3-4d7d-b76a-4779137806a3`.
- [x] Public live route smoke passes for `/`, `/login`, `/health`, and `/kumo.css`.
- [x] Anonymous `/dashboard` returns `401`.
- [x] Root `.gitignore` excludes `.dev.vars`, `.dev.vars.*`, `.env*`, `dist`, `.flue-vite`, `.wrangler`, `worker-configuration.d.ts`, and test output.
- [x] Deployed Worker has Browser Run, Send Email, app-owned Durable Objects, generated Flue Durable Objects, and required deployed secrets configured.
- [x] Email Routing for `charles@questionable.services` targets the `charles` Worker.

## Email Flow

- [x] Cloudflare email handler has mocked `ForwardableEmailMessage` tests.
- [x] MIME parse failures, workflow admission failures, JSON parse failures, and `app.fetch` exceptions are caught safely.
- [x] Email replies preserve `References` and `In-Reply-To` headers where available.
- [x] Allowlisted inbound email enters `/workflows/email-prompt?wait=result` through an internal authenticated app route.
- [x] `email-prompt` routes grocery, research, and parts requests through protected Flue workflow HTTP admission instead of direct `run()` calls.
- [x] Add a Cloudflare email handler test proving non-allowlisted senders reject without workflow admission.
- [x] Investigate recent email failures. Root causes were OpenAI Responses item persistence (`store: false` with tool-call continuations) and fixed shared Flue session names across one-shot workflow runs.
- [x] Enable OpenAI Responses persistence for `opencode-zen`, use per-run email/research Flue sessions, and log failed internal workflow response previews for future diagnosis.
- [x] Confirm live inbound email smoke passed from an allowlisted sender after deploy `37ca21ba-a2e3-4d7d-b76a-4779137806a3`.
- [ ] Render outbound email HTML from Markdown with `react-email`: keep Markdown as the source format, produce minimal HTML, and support bold text, links, images, lists, and a plain-text fallback.

## Scheduler

- [x] Scheduler uses Flue/Agents SDK Durable Object scheduling, not Worker cron triggers.
- [x] Friday grocery reminder idempotency is claimed before side effects.
- [x] Internal scheduler routes exist for reminders, state, bootstrap/repair, and test grocery reminder.
- [x] App route tests cover internal scheduler state, repair/bootstrap, reminders, and forced reminder route admission.
- [x] Scheduler lifecycle emits structured `scheduler.schedule_ready`, `scheduler.schedule_installed`, and `scheduler.schedule_repaired` logs.
- [ ] Verify in production logs that `onStart()` installed or reused the recurring hourly schedule after the scheduler Durable Object next starts.
- [ ] Add direct scheduler Durable Object tests for overlapping reminder idempotency and schedule repair behavior.
- [x] Scheduler reminders and inbound email fallback share the same outbound Charles email construction helper.

## Grocery And Imperfect Foods

- [x] Grocery workflow parses add, remove, update, list-cart, delivery/window check, skip-delivery, recurring/favorite, and block-item intents distinctly.
- [x] `skip next week` is no longer parsed as a cart-item removal.
- [x] Grocery skill documents current Imperfect Foods / Misfits Market behavior: shopping window, no checkout step, skip delivery before window close, cart customization, filters/favorites, and Flex plan caveat.
- [x] Checkout/payment/order-placement text is blocked by policy before automation clicks.
- [x] Credentialed Browser Run smoke verified login and authenticated shop browsing against `https://www.imperfectfoods.com/shop` using local credentials.
- [x] Credentialed smoke confirmed account context, cart count, and cart total are visible after login.
- [ ] Improve cart drawer/product selectors: current smoke reaches authenticated shop but still reads broad shop/category text instead of a clean cart drawer item list.
- [ ] Verify live add/remove/update quantity flows against real selectors with low-risk test items; do not place an order.
- [ ] Verify skip-delivery flow against the real schedule UI with explicit user approval before clicking a live skip control.
- [ ] Verify recurring/favorite and block/exclude preference flows against real account/product UI.
- [x] Add committed grocery smoke Worker for inspect-only authenticated browsing without relying on ignored `.wrangler/tmp` harness files.

## Research And Parts

- [x] Research workflow uses Browser Run tools for rendered web context.
- [x] Research workflow connects GitHub MCP when `GITHUB_MCP_PAT` is configured.
- [x] Research workflow connects Exa MCP when `EXA_API_KEY` is configured.
- [x] Research workflow connects Resy MCP at `https://apigw.americanexpress.com/dining/v1/mcp`.
- [x] Require source-backed research answers in prompt instructions and extract citation URLs from research text results.
- [x] Add tests proving email-prompt research classification invokes the research workflow path.
- [x] Parts requests route through the research workflow with a `parts_search` tool for Porsche 911 and BMW 2002 part-number, fitment, stock, price, and symptom-driven parts research.
- [ ] Add Browser Run-backed research tests for prompts with supplied URLs and prompts without URLs.
- [ ] Live-test parts-search answers against Pelican Parts, FCP Euro, RockAuto, BluntTech, Pelican forums, BMW2002FAQ, and RealOEM pages.

## Dashboard And Auth

- [x] Dashboard uses Kumo Tabs for `Dashboard`, `Emails`, `Groceries`, `Workflows`, and `Settings`.
- [x] Dashboard tab bar is centered and shrink-wraps to the tab content on desktop.
- [x] Login, home, dashboard, and error pages share the beige Charles visual language.
- [x] Thread detail back link has padding.
- [x] Thread sender email uses Kumo `ClipboardText` for click-to-copy.
- [x] Settings shows the last 10 user login sessions with email and timestamp.
- [x] Settings lists configured MCP servers and whether required secrets are present.
- [x] Settings lists bundled skills.
- [x] Passkey support was removed; login is magic-link only.
- [ ] Live-test magic-link sign-in in a real browser.
- [ ] Replace dashboard summaries with richer Flue run/session metadata if available from generated Flue stores.
- [ ] Show separate recent grocery, research, and parts-search histories when workflow metadata is sufficient.
- [ ] Add integration tests for Better Auth Durable Object adapter: magic-link token create/consume, session create/read/delete, and allowlist enforcement.

## Operations And Docs

- [x] `AGENTS.md` captures current repo-specific commands, architecture, Cloudflare gotchas, Kumo-first UI rule, and generated-file policy.
- [x] `docs/OPERATIONS.md` documents secrets, deploy, Email Routing, scheduler, and smoke-test operations.
- [x] Add a documented, repeatable grocery Browser Run smoke command that does not expose secrets and does not require temporary ignored source files.
- [ ] Keep local `.dev.vars` aligned with supported aliases without committing secrets: `BETTER_AUTH_SECRET`, `INTERNAL_AUTH_SECRET`, `OPENAI_API_KEY`, `GITHUB_MCP_PAT`, `EXA_API_KEY`, Imperfect credentials, and optional `PUBLIC_ORIGIN`/`BETTER_AUTH_URL`.
- [ ] Normalize additional user-visible app errors with `better-result` where it clarifies failure handling.
