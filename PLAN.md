# Charles Agent Plan

## Implementation Contract

- Project directory: `/Users/matt/repos/charles`
- Source layout: `src`
- Deploy target: Cloudflare Workers
- Package manager: `pnpm`
- Formatting/linting: `oxfmt` and `oxlint`
- Primary agent module: `src/agents/charles.ts`
- Scheduler agent module: `src/agents/scheduler.ts`
- Workflow modules:
  - `src/workflows/email-prompt.ts`
  - `src/workflows/grocery-cart.ts`
  - `src/workflows/research.ts`
  - `src/workflows/parts-search.ts`
- Default model: `opencode-zen/gpt-5.5`
- Reasoning effort: `high`
- Agent email address: `charles@questionable.services`
- Worker script name: `charles`
- Allowlisted users:
  - `matt@eatsleeprepeat.net`
  - `ritakozlov@gmail.com`
- Default timezone: `America/New_York`
- Grocery behavior: mutate the Imperfect Produce cart when requested, but never check out or place orders.

## Product Goals

Build an email-first personal agent on Cloudflare that can:

- Receive emails through Cloudflare Email Routing.
- Treat allowlisted inbound emails as prompts.
- Reply by email to allowlisted senders only.
- Run browser-backed workflows through Cloudflare Browser Run/Browser Rendering.
- Send scheduled Friday morning grocery cart reminders.
- Let allowlisted users reply to edit or request grocery items.
- Support general research prompts.
- Stub a car parts search specialist for FCP Euro, Pelican Parts, and Blunttech for the 911 and 2002.
- Provide a minimal protected dashboard showing session and workflow history.
- Leave a clean path for a future mobile chat UI.

## Architecture

Use Flue as the agent/workflow harness and Cloudflare Workers as the runtime.

- `src/app.ts` owns the Hono HTTP application and the authenticated Flue route mount.
- `src/app.ts` mounts Flue with `flue()`.
- `src/app.ts` exposes Better Auth routes and protected dashboard routes.
- `src/cloudflare.ts` owns the non-HTTP Worker `email()` handler and named exports for app-owned Durable Objects.
- `src/cloudflare.ts` must not define a default `fetch` handler; HTTP composition stays in `src/app.ts`.
- `src/agents/scheduler.ts` owns Flue-native background scheduling through Cloudflare Agents SDK extensions.
- Flue's Cloudflare adapter and generated Durable Objects store agent sessions, workflow runs, runtime state, and history in Durable Object SQLite.
- Auth state is stored in an app-owned `AUTH_STORE` Durable Object using SQLite storage.
- App-owned metadata that is not Flue session/run history lives in the owning Durable Object; do not add a second database for first pass.
- Do not create a source-root `db.ts`; the Flue Cloudflare target rejects it and does not use it for Cloudflare persistence.
- Never use D1 for this project.
- Browser Run is exposed through a `BROWSER` binding.
- Cloudflare Email Service is exposed through an `EMAIL` send binding.

## Flue Shape

Create one primary continuing agent and several finite workflows.

- `charles` agent:
  - Handles general prompts and session continuity.
  - Knows that email is the first-class interface.
  - Delegates bounded operations to workflows through Flue runtime invocation surfaces, not by importing workflow `run()` functions directly.
  - Uses imported skills from `.agents/skills/*` where safe to package.
  - Supports future authenticated HTTP/WebSocket chat surfaces.

- `email-prompt` workflow:
  - Exports `route` so it can be invoked by the Flue runtime.
  - Authenticates an internal Worker-to-Flue request before admission.
  - Receives normalized inbound email payloads.
  - Classifies intent.
  - Runs the correct agent prompt or bounded operation.
  - Calls other workflow surfaces only through Flue-admitted routes when separate run history is required.
  - Produces an email-ready response.
  - Records request and response metadata.

- `grocery-cart` workflow:
  - Uses Browser Run/Playwright to log into Imperfect Produce.
  - Reads the current cart.
  - Mutates the cart for explicit add/remove/update requests.
  - Returns a summary of current cart contents and actions taken.
  - Never checks out or places orders.

- `research` workflow:
  - Uses Browser Run Quick Actions or browser automation to retrieve web context.
  - Uses the agent to synthesize concise answers with links or citations when possible.

- `parts-search` workflow:
  - Starts as a stubbed specialist.
  - Targets FCP Euro, Pelican Parts, and Blunttech.
  - Scopes searches to the Porsche 911 and BMW 2002.
  - Returns candidate parts, URLs, caveats, and next questions.

- `scheduler` agent:
  - Exists only to own background schedules on Cloudflare.
  - Does not expose a model prompt route by default.
  - Exports a Flue Cloudflare extension descriptor with `extend(...)`.
  - Uses the Agents SDK `onStart()` hook to install a recurring schedule with `scheduleEvery(...)` idempotently.
  - Runs `sendFridayGroceryReminderIfDue` from the Durable Object schedule callback.
  - Uses scheduler Durable Object storage for idempotency so at most one grocery reminder is sent per local date.
  - Calls shared grocery and email application code; it does not rely on a Worker-level cron handler.

## Model And Provider Policy

- Use Flue model configuration, not raw provider `fetch()` calls from application code.
- Use `model: 'opencode-zen/gpt-5.5'` for the default model.
- Use `thinkingLevel: 'high'` in agent profiles, created agents, and workflow-local agents that need model reasoning.
- Register the `opencode-zen` provider once in `src/app.ts` with Flue's `registerProvider(...)` API.
- Use Pi/Flue's built-in `openai-responses` wire protocol for GPT 5.5.
- Use OpenCode Zen's endpoint root `https://opencode.ai/zen/v1`; the OpenAI Responses client resolves GPT 5.5 calls to `https://opencode.ai/zen/v1/responses`.
- Read the API key from the Cloudflare Worker secret `OPENAI_API_KEY`.
- Do not commit the API key or write it into generated source, documentation, or `.dev.vars`.
- Use raw OpenCode Zen REST calls only for non-Flue application utilities that cannot be represented as Flue agent/workflow work.

Provider registration shape:

```ts
import { env } from 'cloudflare:workers';
import { registerProvider } from '@flue/runtime';

registerProvider('opencode-zen', {
  api: 'openai-responses',
  baseUrl: 'https://opencode.ai/zen/v1',
  apiKey: env.OPENAI_API_KEY,
  models: {
    'gpt-5.5': {
      contextWindow: 272000,
    },
  },
});
```

If Flue's built-in `opencode/gpt-5.5` model path proves equivalent and allows the same `OPENAI_API_KEY` secret override, prefer the explicit registration above anyway because it documents the intended endpoint and avoids relying on ambient local Pi/OpenCode credential resolution.

## Routing Policy

- `src/app.ts` should mount `flue()` explicitly.
- Apply allowlist/auth middleware before published `/agents/*`, `/workflows/*`, and `/runs/*` routes.
- Expose only the agent and workflow transports that are needed.
- Do not call workflow `run(...)` functions directly from app routes, email handlers, scheduled callbacks, or tests.
- Prefer `dispatch(...)` for asynchronous event delivery into continuing agent sessions.
- Prefer Flue workflow HTTP admission for finite operations that need run records and `?wait=result` responses.

## Cloudflare Bindings

`wrangler.jsonc` should include:

- `name`: `charles`.
- `compatibility_date` later than `2026-03-24` for Browser Run Quick Actions.
- `compatibility_flags`: `nodejs_compat`.
- `browser.binding`: `BROWSER`.
- `send_email`: `EMAIL`, with `remote: true` for local development.
- `durable_objects.bindings`: app-auth binding `AUTH_STORE`, class `CharlesAuthStore`.
- `migrations`: ordered migration entries using `new_sqlite_classes`, not legacy `new_classes`.
- Initial `new_sqlite_classes`:
  - `CharlesAuthStore`
  - `FlueRegistry`
  - `FlueCharlesAgent`
  - `FlueSchedulerAgent`
  - `FlueEmailPromptWorkflow`
  - `FlueGroceryCartWorkflow`
  - `FlueResearchWorkflow`
  - `FluePartsSearchWorkflow`

Flue generates the `FLUE_*` Durable Object bindings during the Cloudflare build. Do not hand-author generated Flue bindings in `wrangler.jsonc`; only declare app-owned bindings such as `AUTH_STORE` and the required migration classes.

Never rewrite or reorder deployed migration entries. Add a new migration tag for added agent/workflow classes, and use Cloudflare `renamed_classes` or `deleted_classes` when changing deployed Durable Object class names.

Do not configure `d1_databases` or external SQL database secrets. Flue history belongs to the Flue Cloudflare adapter, and auth belongs to `AUTH_STORE`.

Do not configure Wrangler `triggers.crons` and do not use a Worker `scheduled()` handler. Background work should run through Flue's Cloudflare extension point for generated Durable Objects.

## Flue-Native Scheduling

Use Flue's Cloudflare target extension point instead of Cron Workers.

Implementation shape:

```ts
import { createAgent } from '@flue/runtime';
import { extend } from '@flue/runtime/cloudflare';

type SchedulerState = {
  groceryReminderScheduleId?: string;
};

export default createAgent(() => ({
  model: false,
  instructions: 'Own background schedules for Charles.',
}));

export const cloudflare = extend({
  base: (Base) =>
    class extends Base {
      initialState: SchedulerState = {};

      async onStart() {
        const schedules = await this.getSchedules();
        const existingId = this.state.groceryReminderScheduleId;

        if (existingId && schedules.some((schedule) => schedule.id === existingId)) {
          return;
        }

        const schedule = await this.scheduleEvery(60 * 60, 'sendFridayGroceryReminderIfDue');
        this.setState({ ...this.state, groceryReminderScheduleId: schedule.id });
      }

      async sendFridayGroceryReminderIfDue() {
        // Check America/New_York local time, enforce scheduler DO idempotency,
        // read/mutate shared app state, and send email if due.
      }
    },
});
```

Scheduling policy:

- Run a lightweight hourly check from the scheduler agent Durable Object.
- Bootstrap the scheduler once after deploy by touching the generated `FLUE_SCHEDULER_AGENT` Durable Object for the stable `default` scheduler instance.
- Let `onStart()` repair a missing schedule when the scheduler Durable Object restarts.
- Convert current time to `America/New_York`.
- Continue only when local time is Friday morning in the configured reminder window.
- Use scheduler Durable Object SQLite storage for a local-date idempotency key so only one reminder is sent per local date.
- Reuse the same shared grocery/browser/email services as the `grocery-cart` workflow.
- Record reminder summaries in scheduler Durable Object storage and dispatch them into the `charles` agent session so the continuing conversation has context.

Important Flue/Cloudflare boundary:

- Native Agents SDK callbacks such as `onStart()`, `scheduleEvery()`, and scheduled methods run as Durable Object activity.
- They do not automatically receive a Flue workflow context.
- They do not automatically create workflow runs.
- Shared business logic should live outside the workflow module so both the workflow and scheduler callback can call it.
- If workflow-run history is required for a scheduled action later, add an application-owned internal invocation path rather than a Wrangler cron.
- Use `getCloudflareContext()` inside scheduled callbacks when application code needs `env`, Durable Object identity, or storage details not exposed directly by the base class.
- Do not override Flue-owned `fetch()`, `onRequest()`, WebSocket hooks, `onFiberRecovered()`, or `alarm()` methods in Cloudflare extensions.

Bootstrap policy:

- A schedule cannot run until the scheduler Durable Object has been created at least once.
- Deployment should call a protected app route such as `POST /internal/scheduler/bootstrap` once after deploy.
- The bootstrap route should touch the generated scheduler Durable Object binding and return current schedule state.
- The bootstrap call must not rely on model behavior; it exists to start the Durable Object so `onStart()` can register schedules.
- The dashboard can expose a protected “repair scheduler” action for manual recovery.

## Email Routing Rule

Create the inbound rule through the Cloudflare API after the Worker exists. The rule should be idempotent.

Steps:

- Find the zone ID for `questionable.services`.
- List `/zones/{zone_id}/email/routing/rules`.
- If a literal `to = charles@questionable.services` rule exists, update it.
- Otherwise create it.

Expected rule body:

```json
{
  "name": "Route charles@questionable.services to Charles Worker",
  "enabled": true,
  "matchers": [
    {
      "type": "literal",
      "field": "to",
      "value": "charles@questionable.services"
    }
  ],
  "actions": [
    {
      "type": "worker",
      "value": ["charles"]
    }
  ]
}
```

## Email Handling

- Parse inbound MIME with `postal-mime`.
- Normalize sender addresses before allowlist checks.
- Drop or reject non-allowlisted email without replying.
- Store allowlisted inbound email metadata in Flue workflow run metadata/history through the Cloudflare adapter.
- Invoke the `email-prompt` workflow through Flue's mounted HTTP workflow route with an internal authentication header and `?wait=result`.
- Send exactly one reply to the inbound sender.
- Preserve threading headers when available.
- Log failures without leaking message body or secrets.

Cloudflare `message.reply()` has constraints around DMARC, same recipient, and one reply per event. Prefer `message.reply()` when its requirements are satisfied; otherwise fall back to the `EMAIL` send binding where permitted.

Do not direct-import and call any workflow `run(...)` function from the email handler. Workflow execution should be admitted by Flue so run records, durable execution semantics, and generated workflow Durable Objects stay authoritative.

## Auth And Dashboard

Use Better Auth with magic link first and passkey support after sign-in.

- No public registration.
- Reject sign-in attempts unless the email is allowlisted.
- Store Better Auth users, auth sessions, verification tokens, and passkey data in the `AUTH_STORE` Durable Object, not D1 or an external SQL database.
- Send magic links through Cloudflare Email Service.
- Dashboard route: `/dashboard`.
- Auth route prefix: `/api/auth/*`.
- Protected Flue routes for direct agent/workflow access.
- Protected internal route for scheduler bootstrap/repair.

Dashboard should be intentionally minimal:

- Flue session and email-prompt history list.
- Flue workflow run status and result summaries.
- Recent grocery reminders.
- Recent research and parts-search requests.
- Mobile-friendly layout for future chat UI work.

Use Kumo components and import Kumo styles. Visual design:

- Black text on white background.
- Greyscale surfaces and borders.
- Marigold yellow accents for buttons and switches.
- No broad color palette.

## Skills

Use Flue Agent Skills from `.agents/skills/*` as much as is practical.

- Import safe, relevant `SKILL.md` files with `with { type: 'skill' }`.
- Do not import skill directories containing secrets or unsafe local-only assumptions.
- Keep skills as instructions only; executable capabilities belong in Flue tools or Worker code.
- Add project-owned skills if needed for grocery, research, and parts-search behavior.

## Browser Automation

Use Cloudflare Browser Run/Browser Rendering for browser-backed work.

- Prefer Browser Run Quick Actions for public page fetches, markdown, links, screenshots, and structured extraction.
- Use Playwright automation for authenticated grocery cart interactions.
- Scope grocery automation to Imperfect Produce.
- Keep credentials in Worker secrets.
- Do not expose credentials to the model or include them in prompts.
- Application code performs login and page actions; the model receives sanitized page/cart summaries.

## Secrets

Do not commit secrets. Configure these as Worker secrets or local `.dev.vars` values:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` or `PUBLIC_ORIGIN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `OPENAI_API_KEY`
- `GITHUB_MCP_PAT`
- `EXA_API_KEY`
- `INTERNAL_AUTH_SECRET`
- `IMPERFECT_EMAIL`
- `IMPERFECT_PASSWORD`
- `AGENT_FROM_EMAIL`

Local aliases currently accepted by the Worker for Imperfect Produce credentials:

- `IMPERFECT_FOODS_USERNAME` for `IMPERFECT_EMAIL`
- `IMPERFECT_FOODS_PASSWORD` for `IMPERFECT_PASSWORD`

The OpenCode Zen API key was shared in chat. Do not copy it into source or the plan. Store it only as a Worker secret, and rotate it before production if this transcript is retained anywhere.

The Imperfect Produce password was shared in chat, so rotate it before production deployment if this transcript is retained anywhere.

## Data Model

Use Durable Object storage plus Flue's Cloudflare adapter. Never use D1.

Storage owners:

- Flue Cloudflare adapter/generated Durable Objects:
  - continuing agent sessions
  - workflow runs, statuses, inputs, outputs, and result summaries
  - email-prompt history and workflow request history
- `AUTH_STORE` Durable Object (`CharlesAuthStore`):
  - Better Auth users and accounts
  - Better Auth session records
  - magic-link verification tokens
  - passkey credentials and metadata
- `scheduler` agent Durable Object:
  - installed schedule ID
  - grocery reminder local-date idempotency records
  - recent reminder summaries needed by the dashboard
- Workflow Durable Objects:
  - workflow-scoped request/result metadata
  - grocery cart snapshots attached to grocery workflow runs

Do not create app tables for `emails`, `sessions`, `workflow_requests`, `grocery_snapshots`, or `scheduled_runs`. Those concepts are represented by Flue run/session history or by the owning Durable Object's SQLite storage.

`CharlesAuthStore` implementation guidance:

- Export `CharlesAuthStore` as a named export from `src/cloudflare.ts` so Flue includes it as a top-level Worker export.
- Use SQLite-backed Durable Object storage and configure it with `new_sqlite_classes`.
- Initialize schema in the constructor with `ctx.blockConcurrencyWhile(...)`.
- Expose typed RPC methods for the Better Auth adapter.
- Use one stable `AUTH_STORE.getByName('default')` instance for the small allowlisted first pass; shard by normalized email only if the user set grows enough to justify it.
- Do not expose a public Durable Object `fetch()` surface for auth storage.

## Tooling

Add scripts:

- `pnpm dev`: `flue dev --target cloudflare`
- `pnpm build`: `flue build --target cloudflare`
- `pnpm deploy`: `flue build --target cloudflare && wrangler deploy`
- `pnpm typecheck`: TypeScript check
- `pnpm lint`: `oxlint`
- `pnpm format`: `oxfmt --write .`
- `pnpm format:check`: `oxfmt --check .`
- `pnpm cf:types`: `wrangler types`

## Validation

Run, in order:

```sh
pnpm install
pnpm cf:types
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Local Cloudflare smoke test:

```sh
pnpm dev
```

Browser Run and Email Service tests require Cloudflare bindings and the Email Routing domain to be configured. Browser Run Quick Actions may require remote mode in local development.

## Deployment Steps

- Do not create a D1 database.
- Do not create an external SQL database for auth, session storage, or history.
- Set Worker secrets.
- Build with Flue for Cloudflare.
- Deploy with Wrangler.
- Bootstrap the `scheduler/default` Durable Object so `onStart()` installs recurring schedules.
- Create or update the Email Routing rule through the Cloudflare API.
- Send a test email from each allowlisted address.
- Verify dashboard sign-in by magic link.
- Verify the Friday reminder path through the protected scheduler repair/test path, not Wrangler cron.

## Non-Goals For First Pass

- No checkout or purchase completion.
- No public registration.
- No non-allowlisted email replies.
- No full mobile chat UI yet.
- No broad autonomous web mutation outside explicitly scoped workflows.
