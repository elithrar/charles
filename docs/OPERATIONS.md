# Charles Operations

## Secrets

Configure Worker secrets with `pnpm exec wrangler secret put <NAME>`.

Required production secrets:

- `BETTER_AUTH_SECRET`
- `INTERNAL_AUTH_SECRET`
- `OPENAI_API_KEY`
- `GITHUB_MCP_PAT`
- `EXA_API_KEY`
- `IMPERFECT_FOODS_USERNAME`
- `IMPERFECT_FOODS_PASSWORD`

Optional production secrets:

- `BETTER_AUTH_URL` or `PUBLIC_ORIGIN`
- `AGENT_FROM_EMAIL`

Do not commit `.dev.vars` or generated `dist/**/.dev.vars` files.

## Deploy

Use the project script so Flue generates the Worker config before Wrangler deploys:

```bash
pnpm run deploy
```

For deploy validation without upload:

```bash
pnpm build
pnpm exec wrangler deploy --dry-run --config dist/charles/wrangler.json
```

## Email Routing

`charles@questionable.services` must route to Worker `charles`.

Verify in Cloudflare Email Routing rules for zone `questionable.services`:

- matcher: `to == charles@questionable.services`
- action: Worker `charles`
- enabled: `true`

## Scheduler

Scheduler state is owned by the Flue scheduler Durable Object.

Check state:

```bash
curl https://charles.silverlock.workers.dev/internal/scheduler/state \
  -H "x-charles-internal-auth: $INTERNAL_AUTH_SECRET"
```

Repair schedules and return recent reminders:

```bash
curl -X POST https://charles.silverlock.workers.dev/internal/scheduler/bootstrap \
  -H "x-charles-internal-auth: $INTERNAL_AUTH_SECRET"
```

Force a protected test grocery reminder path:

```bash
curl -X POST https://charles.silverlock.workers.dev/internal/scheduler/test-grocery-reminder \
  -H "content-type: application/json" \
  -H "x-charles-internal-auth: $INTERNAL_AUTH_SECRET" \
  -d '{"localDate":"2026-06-19"}'
```

## Smoke Tests

Run after deploy:

- `GET /health`
- `GET /`
- `GET /login`
- `GET /kumo.css`
- magic-link sign-in to `/dashboard`
- inbound email from an allowlisted sender to `charles@questionable.services`
- protected scheduler bootstrap
- Browser Run research workflow request with `?wait=result`
- grocery inspect-only request with checkout blocked
