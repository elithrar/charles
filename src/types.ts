import type { CharlesAuthStore } from './cloudflare.ts';
import type { CharlesWorkflowStore } from './workflow-store.ts';
import type { BrowserWorker } from '@cloudflare/playwright';

export type EmailSendBinding = {
  send(message: {
    to:
      | string
      | { email: string; name?: string }
      | Array<string | { email: string; name?: string }>;
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | { email: string; name?: string };
    headers?: Record<string, string>;
  }): Promise<unknown>;
};

export type BrowserRunBinding = BrowserWorker & {
  quickAction?: (
    action: string,
    options: Record<string, unknown>,
  ) => Promise<Response | Record<string, unknown> | string>;
};

export type CharlesEnv = {
  AUTH_STORE: DurableObjectNamespace<CharlesAuthStore>;
  WORKFLOW_STORE: DurableObjectNamespace<CharlesWorkflowStore>;
  BROWSER: BrowserRunBinding;
  EMAIL: EmailSendBinding;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  PUBLIC_ORIGIN?: string;
  OPENAI_API_KEY?: string;
  GITHUB_MCP_PAT?: string;
  EXA_API_KEY?: string;
  INTERNAL_AUTH_SECRET?: string;
  IMPERFECT_EMAIL?: string;
  IMPERFECT_PASSWORD?: string;
  IMPERFECT_FOODS_USERNAME?: string;
  IMPERFECT_FOODS_PASSWORD?: string;
  AGENT_FROM_EMAIL?: string;
  FLUE_SCHEDULER_AGENT?: DurableObjectNamespace;
};

declare global {
  interface Env extends CharlesEnv {}
}
