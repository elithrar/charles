# Agent Notes

## Commands

- Use `pnpm`; the package manager is pinned as `pnpm@10.25.0`.
- Main checks: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Format with `pnpm format`; formatting is `oxfmt` with 100-column width, single quotes, trailing commas.
- Generate Cloudflare types with `pnpm cf:types` after binding or secret shape changes.
- Run a focused test file with `pnpm test test/app.test.ts` or another `test/*.test.ts` path.
- For deploy verification, run `pnpm build` first; Flue generates Cloudflare output under `dist/charles/`. Dry-run that generated config with `wrangler deploy --dry-run --config dist/charles/wrangler.json`.

## Architecture

- `src/app.ts` owns the Hono HTTP app, Better Auth routes, protected dashboard routes, provider registration, and `flue()` route mount.
- `src/cloudflare.ts` owns the Worker `email()` handler and exports app-owned Durable Objects. Do not add a default `fetch` handler there.
- Flue agents live in `src/agents/*`; finite workflows live in `src/workflows/*`.
- Do not call workflow `run()` functions directly from app routes, email handlers, scheduler code, or tests. Use protected Flue HTTP admission for workflow execution and run history.
- Auth and email thread metadata belong in `AUTH_STORE`; workflow history belongs in `WORKFLOW_STORE`. Never add D1 for this project.
- The scheduler is a Flue/Agents SDK Durable Object extension in `src/agents/scheduler.ts`; do not add Worker cron triggers or a Worker `scheduled()` handler.

## Cloudflare And Secrets

- Runtime target is Cloudflare Workers with `nodejs_compat`, Browser Run binding `BROWSER`, Send Email binding `EMAIL`, and Durable Objects declared in `wrangler.jsonc`.
- Flue generates additional `FLUE_*` bindings during build. Do not hand-author generated Flue bindings in root `wrangler.jsonc`.
- Never reorder deployed Durable Object migrations; add a new migration tag for new classes.
- Required deployed/local secret names include `BETTER_AUTH_SECRET`, `INTERNAL_AUTH_SECRET`, `OPENAI_API_KEY`, `GITHUB_MCP_PAT`, `EXA_API_KEY`, Imperfect Produce credentials, and optional `PUBLIC_ORIGIN`/`BETTER_AUTH_URL`.
- `.dev.vars` contains secrets. Do not read, print, or commit it unless explicitly asked to work on local secret setup.

## Product Constraints

- Default model is `opencode-zen/gpt-5.5` with high reasoning effort; provider registration reads `OPENAI_API_KEY`.
- Email is allowlist-only; current allowlist is in `src/config.ts`.
- Grocery automation may mutate the Imperfect Produce cart only on explicit authenticated requests. Never checkout, place orders, authorize payment, or click checkout/payment controls.
- Browser-backed tools should go through the `BROWSER` binding and existing Browser Run/Playwright helpers.

## UI

- Prefer Kumo components whenever one exists; check `@cloudflare/kumo` exports before building custom UI.
- UI is server-rendered React in `src/ui.tsx`; Kumo standalone CSS is served from `/kumo.css`.
- Preserve the beige `#F5F4EC`, airy serif Charles visual language for home, login, dashboard, and error pages.
- Keep Kumo styling token-based where possible (`bg-kumo-*`, `text-kumo-*`, `ring-kumo-*`, `data-mode`); use custom CSS only for app-level layout or intentional visual overrides.

## Generated Files

- Ignored/generated paths include `dist`, `.flue-vite`, `.flue-vite.wrangler.jsonc`, `worker-configuration.d.ts`, and `node_modules`.
- Do not manually edit generated Flue output or generated Worker types; change source config and regenerate.
