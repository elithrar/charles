import { admin } from '@flue/runtime/routing';
import type { RunPointer } from '@flue/runtime/adapter';
import type { CharlesEnv } from '../types.ts';

type FlueRunListResponse = {
  items?: RunPointer[];
};

export type DashboardWorkflowRun = {
  id: string;
  runId: string;
  workflow: string;
  status: string;
  summary: string;
  createdAt: string;
  endedAt?: string;
  durationMs?: number;
  detailUrl: string;
  eventsUrl: string;
};

export const flueAdmin = admin();

function summarizeRun(run: RunPointer): string {
  const duration = run.durationMs === undefined ? '' : ` Duration: ${run.durationMs}ms.`;
  return `${run.owner.workflowName} is ${run.status}.${duration}`;
}

export async function getDashboardWorkflowRuns(
  env: CharlesEnv,
  limit = 5,
): Promise<DashboardWorkflowRun[]> {
  const response = await flueAdmin.fetch(
    new Request(`https://charles.internal/runs?limit=${limit}`),
    env,
  );
  if (!response.ok) {
    throw new Error(`Flue admin runs request failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as FlueRunListResponse;
  return (body.items ?? []).map((run) => ({
    id: run.runId,
    runId: run.runId,
    workflow: run.owner.workflowName,
    status: run.status,
    summary: summarizeRun(run),
    createdAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    detailUrl: `/runs/${encodeURIComponent(run.runId)}`,
    eventsUrl: `/runs/${encodeURIComponent(run.runId)}/events`,
  }));
}
