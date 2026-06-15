import { describe, expect, it, vi } from 'vitest';

vi.mock('@flue/runtime', () => ({
  createAgent: vi.fn(() => ({})),
  dispatch: vi.fn(),
}));

vi.mock('@flue/runtime/cloudflare', () => ({
  extend: vi.fn((config) => config),
  getCloudflareContext: vi.fn(() => ({ env: {} })),
}));

import {
  buildScheduleState,
  claimSchedulerIdempotency,
  releaseSchedulerIdempotency,
} from '../src/agents/scheduler.ts';
import {
  buildGroceryReminderSummary,
  shouldSendFridayGroceryReminder,
} from '../src/services/scheduler.ts';

class MemorySchedulerSql {
  private readonly idempotency = new Map<string, string>();

  exec<T = unknown>(query: string, ...bindings: unknown[]): T[] {
    if (query.includes('CREATE TABLE')) {
      return [];
    }

    if (query.startsWith('INSERT OR IGNORE INTO scheduler_idempotency')) {
      const [key, createdAt] = bindings as [string, string];
      if (!this.idempotency.has(key)) {
        this.idempotency.set(key, createdAt);
      }
      return [];
    }

    if (query.startsWith('SELECT key, created_at FROM scheduler_idempotency')) {
      const [key] = bindings as [string];
      const createdAt = this.idempotency.get(key);
      return createdAt ? ([{ key, created_at: createdAt }] as T[]) : [];
    }

    if (query.startsWith('DELETE FROM scheduler_idempotency')) {
      const [key] = bindings as [string];
      this.idempotency.delete(key);
      return [];
    }

    throw new Error(`Unexpected SQL: ${query}`);
  }
}

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

  it('claims grocery reminder idempotency before side effects', () => {
    const sql = new MemorySchedulerSql();
    const key = 'grocery-reminder:2026-06-19';

    expect(claimSchedulerIdempotency(sql, key, 'first-claim')).toBe(true);
    expect(claimSchedulerIdempotency(sql, key, 'overlapping-claim')).toBe(false);

    releaseSchedulerIdempotency(sql, key);
    expect(claimSchedulerIdempotency(sql, key, 'retry-after-failure')).toBe(true);
  });

  it('marks stored scheduler state unhealthy when the schedule is missing', () => {
    expect(buildScheduleState({ groceryReminderScheduleId: 'stored-id' }, [])).toMatchObject({
      groceryReminderScheduleId: 'stored-id',
      scheduleCount: 0,
      healthy: false,
    });

    expect(
      buildScheduleState({ groceryReminderScheduleId: 'stored-id' }, [
        { id: 'stored-id', callback: 'sendFridayGroceryReminderIfDue', type: 'every' },
      ]),
    ).toMatchObject({
      scheduleCount: 1,
      healthy: true,
    });
  });
});
