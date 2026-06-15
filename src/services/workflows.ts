type WorkflowName = 'grocery-cart' | 'research';

export type InternalWorkflowResult = {
  workflow: WorkflowName;
  ok: boolean;
  status: number;
  data: unknown;
  runId?: string;
};

type InvokeInternalWorkflowOptions = {
  fetchWorkflow?: (request: Request) => Promise<Response>;
  origin?: string;
};

function appOrigin(env: Env) {
  return env.PUBLIC_ORIGIN || env.BETTER_AUTH_URL || 'https://charles.silverlock.workers.dev';
}

function flueRunId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || !('_meta' in data)) {
    return undefined;
  }

  const meta = (data as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object' || !('runId' in meta)) {
    return undefined;
  }

  const runId = (meta as { runId?: unknown }).runId;
  return typeof runId === 'string' ? runId : undefined;
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
  return { workflow, ok: response.ok, status: response.status, data, runId: flueRunId(data) };
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
      const citations = Array.isArray(record.citations)
        ? record.citations
            .map((citation) =>
              citation && typeof citation === 'object' && 'url' in citation
                ? String(citation.url)
                : '',
            )
            .filter(Boolean)
        : [];
      return `${record.answer}${citations.length ? `\n\nSources: ${citations.join(', ')}` : ''}`.slice(
        0,
        500,
      );
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
