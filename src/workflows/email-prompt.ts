import { createAgent, type FlueContext, type WorkflowRouteHandler } from '@flue/runtime';
import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL } from '../config.ts';
import {
  classifyEmailIntent,
  requireAllowlistedSender,
  type InboundEmailPayload,
} from '../email.ts';
import {
  invokeInternalWorkflow,
  recordWorkflowHistory,
  summarizeWorkflowResult,
  type InternalWorkflowResult,
} from '../services/workflows.ts';
import { BROWSER_RUN_AGENT_INSTRUCTIONS, createBrowserRunTools } from '../tools/browser-run.ts';

export const route: WorkflowRouteHandler = async (c, next) => {
  const secret = c.env.INTERNAL_AUTH_SECRET;
  if (!secret || c.req.header('x-charles-internal-auth') !== secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
};

const responder = createAgent((_context) => ({
  model: DEFAULT_MODEL,
  thinkingLevel: DEFAULT_THINKING_LEVEL,
  tools: createBrowserRunTools(_context.env as Env),
  instructions: `You write concise email replies for allowlisted Charles users.

<rules>
- Answer the user's email directly.
- Include concrete next steps when action is still needed.
- Use Browser Run evidence for current web content, supplied URLs, or research that needs rendered browsing.
- Do not invent workflow outcomes; summarize only what the workflow returned.
</rules>

${BROWSER_RUN_AGENT_INSTRUCTIONS}`,
}));

function workflowReply(result: InternalWorkflowResult) {
  const summary = summarizeWorkflowResult(result);
  if (result.workflow === 'grocery-cart') {
    return `I reviewed the grocery request. Checkout is blocked. ${summary}`;
  }
  if (result.workflow === 'research') {
    return summary;
  }
  return `${summary}. Confirm the car, year, submodel, and VIN-sensitive fitment before ordering.`;
}

async function routeToChildWorkflow(
  env: Env,
  payload: InboundEmailPayload,
  workflow: 'grocery-cart' | 'research',
  childPayload: unknown,
) {
  const sender = requireAllowlistedSender(payload.from);
  const userEmail = 'value' in sender ? sender.value : payload.from;
  const result = await invokeInternalWorkflow(env, workflow, userEmail, childPayload, {
    origin: 'https://charles.internal',
    fetchWorkflow: async (request) => {
      const { default: app } = await import('../app.ts');
      return app.fetch(request, env);
    },
  });
  const summary = summarizeWorkflowResult(result);
  await recordWorkflowHistory(env, {
    workflow,
    status: result.ok ? 'ok' : 'error',
    subject: payload.subject,
    requestedBy: userEmail,
    summary,
    createdAt: new Date().toISOString(),
  });

  return {
    intent: classifyEmailIntent(payload.subject, payload.text),
    replyText: workflowReply(result),
    childWorkflow: result,
  };
}

export async function run({ init, payload, env }: FlueContext<InboundEmailPayload, Env>) {
  const intent = classifyEmailIntent(payload.subject, payload.text);

  if (intent === 'grocery') {
    return routeToChildWorkflow(env, payload, 'grocery-cart', { prompt: payload.text });
  }

  if (intent === 'parts-search') {
    return routeToChildWorkflow(env, payload, 'research', {
      prompt: payload.text,
      mode: 'parts-search',
    });
  }

  if (intent === 'research') {
    return routeToChildWorkflow(env, payload, 'research', { prompt: payload.text });
  }

  const harness = await init(responder);
  const session = await harness.session('email');
  const response = await session.prompt(
    `Subject: ${payload.subject}\n\nMessage:\n${payload.text}\n\nClassified intent: ${intent}. Reply by email.`,
  );

  return { intent, replyText: response.text };
}
