import { describe, expect, it } from 'vitest';
import {
  buildGroceryReminderSummary,
  shouldSendFridayGroceryReminder,
} from '../src/services/scheduler.ts';

describe('scheduler service', () => {
  it('is due during Friday morning New York time', () => {
    const due = shouldSendFridayGroceryReminder(new Date('2026-06-19T13:00:00Z'));
    expect(due).toMatchObject({ due: true, localDate: '2026-06-19', localHour: 9 });
  });

  it('is not due outside the reminder window', () => {
    const due = shouldSendFridayGroceryReminder(new Date('2026-06-19T18:00:00Z'));
    expect(due.due).toBe(false);
  });

  it('builds an email-ready grocery reminder summary', () => {
    const summary = buildGroceryReminderSummary({
      localDate: '2026-06-19',
      generatedAt: new Date('2026-06-19T13:00:00Z'),
      recipients: ['matt@eatsleeprepeat.net'],
      grocery: {
        status: 'browser-inspected',
        plannedActions: [],
        actionsTaken: [],
        cartItems: [],
        reviewRequired: ['Browser automation is not implemented yet.'],
        checkoutBlocked: true,
      },
    });

    expect(summary.subject).toBe('Charles grocery reminder for 2026-06-19');
    expect(summary.text).toContain('Charles will never check out');
    expect(summary.recipients).toEqual(['matt@eatsleeprepeat.net']);
  });
});
