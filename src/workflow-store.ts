import { DurableObject } from 'cloudflare:workers';

export type WorkflowHistorySummary = {
  id: string;
  workflow: string;
  status: 'ok' | 'error';
  subject?: string;
  requestedBy?: string;
  summary: string;
  createdAt: string;
};

export class CharlesWorkflowStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS workflow_history (
          id TEXT PRIMARY KEY,
          workflow TEXT NOT NULL,
          status TEXT NOT NULL,
          subject TEXT,
          requested_by TEXT,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS workflow_history_created_at_idx ON workflow_history (created_at DESC);
      `);
    });
  }

  async recordWorkflowHistory(summary: WorkflowHistorySummary): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO workflow_history (id, workflow, status, subject, requested_by, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      summary.id,
      summary.workflow,
      summary.status,
      summary.subject ?? null,
      summary.requestedBy ?? null,
      summary.summary,
      summary.createdAt,
    );
  }

  async getRecentWorkflowHistory(limit = 10): Promise<WorkflowHistorySummary[]> {
    return [
      ...this.ctx.storage.sql.exec<{
        id: string;
        workflow: string;
        status: 'ok' | 'error';
        subject: string | null;
        requested_by: string | null;
        summary: string;
        created_at: string;
      }>(
        'SELECT id, workflow, status, subject, requested_by, summary, created_at FROM workflow_history ORDER BY created_at DESC LIMIT ?',
        limit,
      ),
    ].map((row) => ({
      id: row.id,
      workflow: row.workflow,
      status: row.status,
      subject: row.subject ?? undefined,
      requestedBy: row.requested_by ?? undefined,
      summary: row.summary,
      createdAt: row.created_at,
    }));
  }

  fetch(): Response {
    return new Response('Not found', { status: 404 });
  }
}
