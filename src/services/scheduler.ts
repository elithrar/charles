import { DEFAULT_TIMEZONE } from '../config.ts';
import type { GroceryCartSummary } from './grocery.ts';

export type ReminderWindow = {
  timezone?: string;
  startHour?: number;
  endHour?: number;
};

export type LocalDateTime = {
  weekday: string;
  hour: number;
  localDate: string;
};

export type GroceryReminderSummary = {
  localDate: string;
  generatedAt: string;
  recipients: string[];
  grocery: GroceryCartSummary;
  subject: string;
  text: string;
};

export function getLocalDateTime(now: Date, timezone = DEFAULT_TIMEZONE): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    weekday: value('weekday'),
    hour: Number(value('hour')),
    localDate: `${value('year')}-${value('month')}-${value('day')}`,
  };
}

export function shouldSendFridayGroceryReminder(now: Date, window: ReminderWindow = {}) {
  const local = getLocalDateTime(now, window.timezone ?? DEFAULT_TIMEZONE);
  const startHour = window.startHour ?? 8;
  const endHour = window.endHour ?? 11;

  return {
    due: local.weekday === 'Friday' && local.hour >= startHour && local.hour < endHour,
    localDate: local.localDate,
    localHour: local.hour,
  };
}

export function buildGroceryReminderSummary(input: {
  localDate: string;
  generatedAt: Date;
  recipients: readonly string[];
  grocery: GroceryCartSummary;
}): GroceryReminderSummary {
  const subject = `Charles grocery reminder for ${input.localDate}`;
  const actions = input.grocery.actionsTaken.length
    ? input.grocery.actionsTaken.join(', ')
    : 'No cart mutations were made.';
  const items = input.grocery.cartItems.length
    ? input.grocery.cartItems.map((item) => `- ${item}`).join('\n')
    : '- Current cart contents are not available yet.';
  const review = input.grocery.reviewRequired.length
    ? input.grocery.reviewRequired.map((item) => `- ${item}`).join('\n')
    : '- Review the cart before the order window closes.';

  return {
    localDate: input.localDate,
    generatedAt: input.generatedAt.toISOString(),
    recipients: [...input.recipients],
    grocery: input.grocery,
    subject,
    text: [
      `Friday grocery reminder for ${input.localDate}.`,
      '',
      `Actions: ${actions}`,
      '',
      'Current cart:',
      items,
      '',
      'Needs review:',
      review,
      '',
      'Charles will never check out or place grocery orders.',
    ].join('\n'),
  };
}
