import { Result, type Err, type Ok } from 'better-result';
import { AGENT_EMAIL, isAllowlistedEmail } from './config.ts';
import { invalidInput, unauthorized, type AppError } from './errors.ts';

export type InboundEmailPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  receivedAt: string;
};

export type EmailIntent = 'grocery' | 'research' | 'parts-search' | 'general';

type AppResult<T> = Ok<T, AppError> | Err<T, AppError>;

const AGENT_FROM_NAME = 'Charles, your Agent';

export function normalizeEmailAddress(input: string | undefined | null): AppResult<string> {
  if (!input) {
    return Result.err<string, AppError>(invalidInput('Missing email address'));
  }

  const bracketMatch = input.match(/<([^<>]+)>/);
  const candidate = (bracketMatch?.[1] ?? input).trim().toLowerCase();

  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)) {
    return Result.err<string, AppError>(invalidInput('Invalid email address'));
  }

  return Result.ok<string, AppError>(candidate);
}

export function requireAllowlistedSender(input: string): AppResult<string> {
  const normalized = normalizeEmailAddress(input);

  if (Result.isError(normalized)) {
    return normalized;
  }

  if (!isAllowlistedEmail(normalized.value)) {
    return Result.err<string, AppError>(unauthorized('Sender is not allowlisted'));
  }

  return Result.ok<string, AppError>(normalized.value);
}

export function classifyEmailIntent(subject: string, text: string): EmailIntent {
  const content = `${subject}\n${text}`.toLowerCase();
  const hasAutomotivePartsVendor = /\b(fcp euro|pelican|blunttech|rockauto|part number)\b/.test(
    content,
  );
  const hasAutomotiveMakeOrModel = /\b(911|porsche|2002|bmw)\b/.test(content);
  const hasFitmentLanguage = /\b(fit|fits|fitment)\b/.test(content);
  const hasGenericPartsWord = /\bparts?\b/.test(content);
  const hasPartNumberPattern = /\b(?:[a-z]{0,3}\d[\da-z-]{4,}|\d{6,})\b/.test(content);
  const hasProcurementLanguage =
    /\b(buy|order|price|cost|stock|available|availability|where can i buy)\b/.test(content);

  if (/\b(grocery|groceries|imperfect|produce|cart|order box|shopping list)\b/.test(content)) {
    return 'grocery';
  }

  if (
    hasAutomotivePartsVendor ||
    (hasAutomotiveMakeOrModel &&
      (hasGenericPartsWord || hasFitmentLanguage || hasPartNumberPattern || hasProcurementLanguage))
  ) {
    return 'parts-search';
  }

  if (/\b(research|find out|look up|sources?|cite|citation|web)\b/.test(content)) {
    return 'research';
  }

  return 'general';
}

export function buildReplySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed || 'Message to Charles'}`;
}

export function normalizeThreadSubject(subject: string): string {
  const trimmed = subject.trim() || 'Message to Charles';
  return trimmed.replace(/^((re|fw|fwd):\s*)+/i, '').trim() || trimmed;
}

export function emailThreadKey(subject: string, sender: string): string {
  return `${sender.trim().toLowerCase()}::${normalizeThreadSubject(subject).toLowerCase()}`;
}

export function emailErrorMessage(error: AppError): string {
  if (error._tag === 'Unauthorized') {
    return 'This address is not authorized to use Charles.';
  }

  return 'Charles could not process that email safely.';
}

export function defaultFromAddress(env: Pick<Env, 'AGENT_FROM_EMAIL'>): string {
  const normalized = normalizeEmailAddress(env.AGENT_FROM_EMAIL || AGENT_EMAIL);
  return Result.isOk(normalized) ? normalized.value : AGENT_EMAIL;
}

export function defaultFromIdentity(env: Pick<Env, 'AGENT_FROM_EMAIL'>) {
  return { email: defaultFromAddress(env), name: AGENT_FROM_NAME };
}

export async function sendCharlesEmail(
  env: Pick<Env, 'AGENT_FROM_EMAIL' | 'EMAIL'>,
  message: {
    to: string | string[];
    subject: string;
    text: string;
    headers?: Record<string, string>;
  },
) {
  return env.EMAIL.send({
    from: defaultFromIdentity(env),
    to: message.to,
    subject: message.subject,
    text: message.text,
    headers: message.headers,
  });
}

export function formatEmailAddress(identity: { email: string; name: string }): string {
  const name = identity.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${name}" <${identity.email}>`;
}
