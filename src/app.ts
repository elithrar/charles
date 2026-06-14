import { env } from 'cloudflare:workers';
import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import { Result } from 'better-result';
import { Hono, type MiddlewareHandler } from 'hono';
import { BUNDLED_SKILLS, CONFIGURED_MCP_SERVERS } from './capabilities.ts';
import { ALLOWLISTED_USERS, DEFAULT_MODEL } from './config.ts';
import { requireAllowlistedSender } from './email.ts';
import { createCharlesAuth } from './auth.ts';
import type { EmailThreadMessage, EmailThreadPage, UserLoginSummary } from './auth-store.ts';
import type { GroceryReminderSummary } from './services/scheduler.ts';
import type { CharlesEnv } from './types.ts';
import type { WorkflowHistorySummary } from './workflow-store.ts';
import kumoStyles from '@cloudflare/kumo/styles/standalone?raw';
import {
  dashboardHtml,
  homeHtml,
  loginHtml,
  notFoundHtml,
  serverErrorHtml,
  threadHtml,
} from './ui.tsx';

registerProvider('opencode-zen', {
  api: 'openai-responses',
  baseUrl: 'https://opencode.ai/zen/v1',
  apiKey: (env as unknown as Env).OPENAI_API_KEY,
  models: {
    'gpt-5.5': {
      contextWindow: 272000,
    },
  },
});

type AppVariables = {
  userEmail?: string;
};

type SchedulerRpcStub = {
  getRecentGroceryReminders(limit?: number): Promise<GroceryReminderSummary[]>;
  sendTestGroceryReminder(localDate?: string): Promise<unknown>;
  getScheduleState(): Promise<unknown>;
  repairSchedules(): Promise<unknown>;
};

type AuthStoreRpcStub = {
  getRecentEmailThreads(page?: number, pageSize?: number): Promise<EmailThreadPage>;
  getEmailThread(threadKey: string): Promise<EmailThreadMessage[]>;
  getRecentUserLogins(limit?: number): Promise<UserLoginSummary[]>;
};

type WorkflowStoreRpcStub = {
  getRecentWorkflowHistory(limit?: number): Promise<WorkflowHistorySummary[]>;
};

function isInternalRequest(c: {
  env: CharlesEnv;
  req: { header(name: string): string | undefined };
}) {
  const secret = c.env.INTERNAL_AUTH_SECRET;
  return Boolean(secret && c.req.header('x-charles-internal-auth') === secret);
}

function schedulerStub(env: CharlesEnv): SchedulerRpcStub | null {
  const namespace = env.FLUE_SCHEDULER_AGENT;
  if (!namespace) {
    return null;
  }

  return namespace.get(namespace.idFromName('default')) as unknown as SchedulerRpcStub;
}

function authStoreStub(env: CharlesEnv): AuthStoreRpcStub {
  return env.AUTH_STORE.getByName('default') as unknown as AuthStoreRpcStub;
}

function workflowStoreStub(env: CharlesEnv): WorkflowStoreRpcStub {
  return env.WORKFLOW_STORE.getByName('default') as unknown as WorkflowStoreRpcStub;
}

const requireUser: MiddlewareHandler<{ Bindings: CharlesEnv; Variables: AppVariables }> = async (
  c,
  next,
) => {
  if (isInternalRequest(c)) {
    const headerUser = c.req.header('x-charles-user');
    if (headerUser) {
      const allowed = requireAllowlistedSender(headerUser);
      if (Result.isOk(allowed)) {
        c.set('userEmail', allowed.value);
      }
    }

    await next();
    return;
  }

  const auth = createCharlesAuth(c.env, c.req.url);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    if (
      !ALLOWLISTED_USERS.includes(
        session.user.email.toLowerCase() as (typeof ALLOWLISTED_USERS)[number],
      )
    ) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    c.set('userEmail', session.user.email);
    await next();
    return;
  }

  return c.json({ error: 'Unauthorized' }, 401);
};

const app = new Hono<{ Bindings: CharlesEnv; Variables: AppVariables }>();

app.get('/', (c) => c.html(homeHtml()));

app.get('/kumo.css', (c) => c.text(kumoStyles, 200, { 'content-type': 'text/css; charset=utf-8' }));

app.get('/health', (c) => c.json({ ok: true, model: DEFAULT_MODEL }));

app.get('/login', (c) => c.html(loginHtml()));

app.get('/api/auth/allowlist', requireUser, (c) => c.json({ allowlistedUsers: ALLOWLISTED_USERS }));

app.on(['GET', 'POST'], '/api/auth/*', (c) =>
  createCharlesAuth(c.env, c.req.url).handler(c.req.raw),
);

app.use('/agents/*', requireUser);
app.use('/workflows/*', requireUser);
app.use('/runs/*', requireUser);
app.use('/dashboard', requireUser);
app.use('/dashboard/*', requireUser);
app.use('/internal/*', requireUser);

app.get('/dashboard', async (c) => {
  const scheduler = schedulerStub(c.env);
  const reminders = scheduler ? await scheduler.getRecentGroceryReminders(5) : [];
  const page = Number(c.req.query('page') ?? '1');
  const authStore = authStoreStub(c.env);
  const emailThreads = await authStore.getRecentEmailThreads(page, 10);
  const recentLogins = await authStore.getRecentUserLogins(10);
  const workflows = await workflowStoreStub(c.env).getRecentWorkflowHistory(5);
  return c.html(
    dashboardHtml(
      c.get('userEmail'),
      reminders,
      emailThreads,
      workflows,
      recentLogins,
      CONFIGURED_MCP_SERVERS.map((server) => ({
        ...server,
        configured: server.secretName ? Boolean(c.env[server.secretName]) : true,
      })),
      [...BUNDLED_SKILLS],
      c.req.query('tab'),
    ),
  );
});

app.get('/dashboard/threads/:threadKey', async (c) => {
  const threadKey = decodeURIComponent(c.req.param('threadKey'));
  const messages = await authStoreStub(c.env).getEmailThread(threadKey);
  if (messages.length === 0) {
    return c.html(notFoundHtml(), 404);
  }

  return c.html(threadHtml(c.get('userEmail'), messages));
});

app.get('/internal/scheduler/reminders', async (c) => {
  const scheduler = schedulerStub(c.env);
  if (!scheduler) {
    return c.json(
      { ok: false, error: 'Scheduler binding is not available until after Flue build generation' },
      503,
    );
  }

  return c.json({ ok: true, reminders: await scheduler.getRecentGroceryReminders(10) });
});

app.get('/internal/scheduler/state', async (c) => {
  const scheduler = schedulerStub(c.env);
  if (!scheduler) {
    return c.json(
      { ok: false, error: 'Scheduler binding is not available until after Flue build generation' },
      503,
    );
  }

  return c.json({ ok: true, state: await scheduler.getScheduleState() });
});

app.post('/internal/scheduler/bootstrap', async (c) => {
  const scheduler = schedulerStub(c.env);
  if (!scheduler) {
    return c.json(
      { ok: false, error: 'Scheduler binding is not available until after Flue build generation' },
      503,
    );
  }

  const reminders = await scheduler.getRecentGroceryReminders(5);
  const state = await scheduler.repairSchedules();
  return c.json({ ok: true, state, reminders });
});

app.post('/internal/scheduler/test-grocery-reminder', async (c) => {
  const scheduler = schedulerStub(c.env);
  if (!scheduler) {
    return c.json(
      { ok: false, error: 'Scheduler binding is not available until after Flue build generation' },
      503,
    );
  }

  const body = (await c.req.json<{ localDate?: string }>().catch(() => ({}))) as {
    localDate?: string;
  };
  return c.json({ ok: true, result: await scheduler.sendTestGroceryReminder(body.localDate) });
});

app.route('/', flue());

app.notFound((c) => c.html(notFoundHtml(), 404));

app.onError((error, c) => {
  console.error('Unhandled app error', { error: String(error) });
  return c.html(serverErrorHtml(), 500);
});

export default app;
