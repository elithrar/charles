export const DEFAULT_MODEL = 'opencode-zen/gpt-5.5';
export const DEFAULT_THINKING_LEVEL = 'high';
export const DEFAULT_TIMEZONE = 'America/New_York';
export const AGENT_EMAIL = 'charles@questionable.services';
export const ALLOWLISTED_USERS = ['matt@eatsleeprepeat.net', 'ritakozlov@gmail.com'] as const;

export function isAllowlistedEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return ALLOWLISTED_USERS.includes(normalized as (typeof ALLOWLISTED_USERS)[number]);
}
