# Remaining Plan Gaps

This tracks the work still needed to fully satisfy `PLAN.md`. Treat each item as incomplete until it has implementation, tests where practical, and a live or local verification note.

## P0: Secrets, Deployability, And Remote Smoke Tests

- [x] Set the deployed `OPENAI_API_KEY` Worker secret from the local `OPENAI_API_KEY` value.
- [x] Remove or replace any remaining stale `OPENAPI_API_KEY` references if they reappear in generated files or docs.
- [ ] Align local `.dev.vars` names with the Worker contract without committing secrets: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` or `PUBLIC_ORIGIN`, `OPENAI_API_KEY`, `INTERNAL_AUTH_SECRET`, `IMPERFECT_EMAIL`, `IMPERFECT_PASSWORD`, and `AGENT_FROM_EMAIL`.
- [x] Add `GITHUB_MCP_PAT` locally and as a deployed Worker secret when GitHub MCP tools should be enabled for the research agent.
- [x] Add `EXA_API_KEY` locally and as a deployed Worker secret when Exa MCP tools should be enabled for the research agent.
- [x] Run `pnpm cf:types` after env names are corrected and confirm generated Worker bindings match `src/types.ts`.
- [ ] Confirm generated artifacts such as `dist/**/.dev.vars` and `worker-configuration.d.ts` are ignored or intentionally excluded from commits.
- [x] Run `wrangler deploy --dry-run` against the generated Flue config and confirm root `wrangler.jsonc` does not mislead future deploys.
- [x] Verify deployed Worker bindings: Browser Run, Send Email, Durable Object migrations, Flue Durable Objects, and all required secrets.
- [x] Verify Email Routing rule for `charles@questionable.services` targets the `charles` Worker.
- [ ] Run deployed smoke tests for `/`, `/login`, `/health`, `/kumo.css`, protected dashboard sign-in, scheduler bootstrap, and one allowlisted inbound email.

## P0: Email Flow Correctness

- [x] Add tests around the Cloudflare email handler in `src/cloudflare.ts` using mocked `ForwardableEmailMessage` objects.
- [x] Catch and safely handle MIME parse failures, workflow admission failures, JSON parse failures, and `app.fetch` exceptions.
- [x] Ensure every email path sends at most one reply or rejects cleanly.
- [x] Preserve `References` headers in fallback `EMAIL.send` replies, not only in `message.reply()`.
- [ ] Verify non-allowlisted inbound senders are rejected and do not trigger workflows.
- [x] Verify allowlisted inbound emails enter `/workflows/email-prompt?wait=result` through the internal authenticated HTTP path.

## P0: Scheduler And Friday Reminder Reliability

- [x] Make reminder idempotency atomic before side effects so overlapping scheduler invocations cannot send duplicate emails.
- [x] Add an internal protected scheduler test route that forces a Friday grocery reminder run without waiting for the real schedule.
- [ ] Extend scheduler bootstrap/repair to expose schedule state, repair status, and recent reminder state.
- [ ] Verify scheduler `onStart` installs the recurring hourly schedule and can repair missing schedule state.
- [ ] Share email sending behavior where practical between scheduler reminders and email replies.
- [ ] Add tests for scheduler schedule repair, idempotency, reminder send, recent reminder history, and internal routes.

## P0: Grocery Cart Live Behavior

- [x] Make Friday reminders read the authenticated Imperfect Produce cart, not just public homepage markdown.
- [x] Make dry-run/current-cart inspection log in when credentials are available.
- [ ] Verify live Playwright selectors against the real Imperfect Produce login, product, cart, add, remove, and quantity update flows.
- [x] Add selector-level deny checks before every automated click to block checkout, place-order, payment, and authorization controls.
- [x] Keep checkout/payment impossible even if the model asks for it or a selector changes.
- [ ] Add remote Browser Run/Playwright smoke tests for inspect-only, add, remove, update, and blocked checkout behavior.

## P1: Flue Workflow Routing And History

- [ ] Decide whether `email-prompt` should invoke child workflows through protected Flue HTTP routes for separate run history.
- [ ] If separate run history is required, route grocery, research, and parts requests through `/workflows/*?wait=result` using internal auth instead of direct service calls.
- [ ] Ensure the Charles agent can actually trigger workflows or expose explicit tool surfaces for grocery, research, and parts work.
- [ ] Verify `/agents/charles` prompts create workflow runs where expected, not only prose responses.
- [ ] Store enough request/response metadata for dashboard history: email metadata, workflow status, result summaries, grocery snapshots, research citations, and parts results.
- [ ] Add tests for Flue route auth on `/agents/*`, `/workflows/*`, `/runs/*`, internal header bypass, and unauthorized access.

## P1: Research And Parts Quality

- [x] Update the research workflow to retrieve browser context with Browser Run Quick Actions when URLs or web research are needed.
- [ ] Require citations or fetched-source summaries for research answers instead of model-only synthesis.
- [ ] Verify `email-prompt` research classification uses the research workflow path.
- [ ] Add Browser Run backed tests for research prompts with supplied URLs and prompts without URLs.
- [ ] Expand parts-search verification with realistic Pelican/eBay/repair-source requests and result summaries.

## P1: Dashboard And Auth Product Surface

- [x] Add padding to the `Back to dashboard` link on email thread pages.
- [x] Make the thread sender email in `Thread with ...` click-to-copy.
- [x] Use Kumo Tabs for `Dashboard`, `Emails`, `Groceries`, `Workflows`, and `Settings`, with comfortable top spacing and mobile-friendly layout.
- [x] Investigate why the last inbound email returned `Charles received your message, but something went wrong while processing it.`
- [ ] Replace dashboard placeholders with real Flue session history, email-prompt runs, workflow status, and result summaries.
- [ ] Include recent grocery reminders, research requests, and parts-search requests on the dashboard.
- [ ] Add passkey enrollment after magic-link sign-in.
- [ ] Add passkey sign-in UI and verify a fresh session can authenticate with passkey.
- [ ] Add integration tests for the Better Auth Durable Object adapter: magic-link token create/consume, session create/read/delete, allowlist enforcement, and passkey credential persistence.
- [ ] Keep Kumo usage token-based per https://kumo-ui.com/colors/: use `bg-kumo-*`, `text-kumo-*`, `ring-kumo-*`, and `data-mode`, with only intentional semantic token overrides.

## P2: Code Quality And Observability

- [x] Add structured application logging for email admission, workflow dispatch, scheduler runs, Browser Run actions, and grocery mutation outcomes.
- [x] Enable Workers Observability with 5% tracing sample rate and 100% logs head sampling rate.
- [ ] Normalize application error results with `better-result` where it clarifies user-visible failures.
- [ ] Add operator-friendly JSON responses to internal repair/test endpoints.
- [ ] Document operational runbooks for setting secrets, verifying Email Routing, bootstrapping scheduler state, and testing inbound email.

## Verification Checklist

- [x] `pnpm cf:types`
- [x] `pnpm format:check`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `wrangler deploy --dry-run`
- [x] `pnpm run deploy`
- [x] Live HTTP smoke tests for public and protected routes
- [ ] Live inbound email smoke test from an allowlisted sender
- [ ] Live Browser Run grocery and research smoke tests
