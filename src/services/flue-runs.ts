import { listRuns, type RunPointer } from '@flue/runtime';
import type { CharlesEnv } from '../types.ts';

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

function summarizeRun(run: RunPointer): string {
  const duration = run.durationMs === undefined ? '' : ` Duration: ${run.durationMs}ms.`;
  return `${run.workflowName} is ${run.status}.${duration}`;
}

export async function getDashboardWorkflowRuns(
  env: CharlesEnv,
  limit = 5,
): Promise<DashboardWorkflowRun[]> {
  void env;
  const body = await listRuns({ limit }).catch((error) => {
    if (error instanceof Error && error.message.includes('called before runtime was configured')) {
      return { runs: [] };
    }

    throw error;
  });
  return body.runs.map((run) => ({
    id: run.runId,
    runId: run.runId,
    workflow: run.workflowName,
    status: run.status,
    summary: summarizeRun(run),
    createdAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    detailUrl: `/runs/${encodeURIComponent(run.runId)}`,
    eventsUrl: `/runs/${encodeURIComponent(run.runId)}/events`,
  }));
}
