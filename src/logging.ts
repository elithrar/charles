type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}) {
  console[level](JSON.stringify({ event, ...fields }));
}
