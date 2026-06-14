import type { WorkflowHistorySummary } from '../workflow-store.ts';

type WorkflowName = 'grocery-cart' | 'research' | 'parts-search';

export type InternalWorkflowResult = {
  workflow: WorkflowName;
  ok: boolean;
  status: number;
  data: unknown;
};

type InvokeInternalWorkflowOptions = {
  fetchWorkflow?: (request: Request) => Promise<Response>;
  origin?: string;
};

function appOrigin(env: Env) {
  return env.PUBLIC_ORIGIN || env.BETTER_AUTH_URL || 'https://charles.silverlock.workers.dev';
}

export async function invokeInternalWorkflow(
  env: Env,
  workflow: WorkflowName,
  userEmail: string,
  payload: unknown,
  options: InvokeInternalWorkflowOptions = {},
): Promise<InternalWorkflowResult> {
  if (!env.INTERNAL_AUTH_SECRET) {
    throw new Error('INTERNAL_AUTH_SECRET is required for internal workflow invocation');
  }

  const request = new Request(
    `${options.origin ?? appOrigin(env)}/workflows/${workflow}?wait=result`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-charles-internal-auth': env.INTERNAL_AUTH_SECRET,
        'x-charles-user': userEmail,
      },
      body: JSON.stringify(payload),
    },
  );
  const response = await (options.fetchWorkflow ?? fetch)(request);

  const data = await response.json().catch(() => ({}));
  return { workflow, ok: response.ok, status: response.status, data };
}

export async function recordWorkflowHistory(env: Env, summary: Omit<WorkflowHistorySummary, 'id'>) {
  const id = `${summary.createdAt}:${summary.workflow}:${summary.subject ?? ''}:${summary.requestedBy ?? ''}`;
  await env.WORKFLOW_STORE.getByName('default').recordWorkflowHistory({ id, ...summary });
}

export function summarizeWorkflowResult(result: InternalWorkflowResult): string {
  const value =
    result.data && typeof result.data === 'object' && 'result' in result.data
      ? (result.data as { result?: unknown }).result
      : result.data;

  if (!result.ok) {
    return `${result.workflow} failed with HTTP ${result.status}.`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.answer === 'string') {
      return record.answer.slice(0, 500);
    }
    if (Array.isArray(record.actionsTaken) || Array.isArray(record.reviewRequired)) {
      const actions = Array.isArray(record.actionsTaken) ? record.actionsTaken.join(', ') : 'none';
      const review = Array.isArray(record.reviewRequired) ? record.reviewRequired.join(' ') : '';
      return `Actions: ${actions}. ${review}`.slice(0, 500);
    }
    if (Array.isArray(record.sources)) {
      return `Searched sources: ${record.sources.join(', ')}`.slice(0, 500);
    }
  }

  return JSON.stringify(value).slice(0, 500);
}
