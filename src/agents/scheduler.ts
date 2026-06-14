import { createAgent, dispatch } from '@flue/runtime';
import { extend, getCloudflareContext } from '@flue/runtime/cloudflare';
import { ALLOWLISTED_USERS, DEFAULT_TIMEZONE } from '../config.ts';
import { sendCharlesEmail } from '../email.ts';
import { logEvent } from '../logging.ts';
import { runGroceryCartRequest } from '../services/grocery.ts';
import {
  buildGroceryReminderSummary,
  shouldSendFridayGroceryReminder,
  type GroceryReminderSummary,
} from '../services/scheduler.ts';

type SchedulerState = {
  groceryReminderScheduleId?: string;
};

export default createAgent(() => ({
  model: false,
  instructions: 'Own background schedules for Charles.',
}));

export const cloudflare = extend({
  base: (Base) =>
    class extends Base {
      initialState: SchedulerState = {};

      async onStart() {
        const schedules = await this.getSchedules();
        const existingId = this.state.groceryReminderScheduleId;

        if (
          existingId &&
          schedules.some((schedule: { id: string }) => schedule.id === existingId)
        ) {
          logEvent('info', 'scheduler.schedule_ready', {
            scheduleId: existingId,
            scheduleCount: schedules.length,
          });
          return;
        }

        const schedule = await this.scheduleEvery(60 * 60, 'sendFridayGroceryReminderIfDue');
        this.setState({ ...this.state, groceryReminderScheduleId: schedule.id });
        logEvent('info', 'scheduler.schedule_installed', {
          scheduleId: schedule.id,
          scheduleCount: schedules.length + 1,
        });
      }

      async getScheduleState() {
        const schedules = await this.getSchedules();
        return {
          groceryReminderScheduleId: this.state.groceryReminderScheduleId,
          scheduleCount: schedules.length,
          schedules: schedules.map(
            (schedule: { id: string; callback?: string; type?: string }) => ({
              id: schedule.id,
              callback: schedule.callback,
              type: schedule.type,
            }),
          ),
          healthy: Boolean(
            this.state.groceryReminderScheduleId &&
            schedules.some(
              (schedule: { id: string }) => schedule.id === this.state.groceryReminderScheduleId,
            ),
          ),
        };
      }

      async repairSchedules() {
        await this.onStart();
        const state = await this.getScheduleState();
        logEvent('info', 'scheduler.schedule_repaired', state);
        return state;
      }

      async sendFridayGroceryReminderIfDue() {
        this.ensureSchedulerTables();

        const due = shouldSendFridayGroceryReminder(new Date(), { timezone: DEFAULT_TIMEZONE });
        if (!due.due) {
          logEvent('info', 'scheduler.grocery_reminder_skipped', {
            reason: 'outside-window',
            localDate: due.localDate,
          });
          return { sent: false, reason: 'outside-window', localDate: due.localDate };
        }

        return this.sendGroceryReminderForLocalDate(due.localDate);
      }

      async sendTestGroceryReminder(localDate = new Date().toISOString().slice(0, 10)) {
        this.ensureSchedulerTables();
        return this.sendGroceryReminderForLocalDate(`test-${localDate}`);
      }

      private async sendGroceryReminderForLocalDate(localDate: string) {
        const key = `grocery-reminder:${localDate}`;
        const claimedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO scheduler_idempotency (key, created_at) VALUES (?, ?)',
          key,
          claimedAt,
        );
        const rows = [
          ...this.ctx.storage.sql.exec(
            'SELECT key, created_at FROM scheduler_idempotency WHERE key = ?',
            key,
          ),
        ];
        if ((rows[0] as { created_at?: string } | undefined)?.created_at !== claimedAt) {
          logEvent('info', 'scheduler.grocery_reminder_skipped', {
            reason: 'already-sent',
            localDate,
          });
          return { sent: false, reason: 'already-sent', localDate };
        }

        const { env } = getCloudflareContext() as unknown as { env: Env };
        const grocery = await runGroceryCartRequest(
          { prompt: 'Review the current Imperfect Produce cart for the Friday grocery reminder.' },
          env,
        );
        if ('error' in grocery) {
          this.ctx.storage.sql.exec('DELETE FROM scheduler_idempotency WHERE key = ?', key);
          logEvent('error', 'scheduler.grocery_reminder_failed', {
            localDate,
            reason: grocery.error.message,
          });
          return { sent: false, reason: grocery.error.message, localDate };
        }

        const summary = buildGroceryReminderSummary({
          localDate,
          generatedAt: new Date(),
          recipients: ALLOWLISTED_USERS,
          grocery: grocery.value,
        });

        await sendCharlesEmail(env, {
          to: [...ALLOWLISTED_USERS],
          subject: summary.subject,
          text: summary.text,
        });

        const sentAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO grocery_reminders (local_date, sent_at, recipients_json, summary_json) VALUES (?, ?, ?, ?)',
          localDate,
          sentAt,
          JSON.stringify(summary.recipients),
          JSON.stringify(summary),
        );

        await this.dispatchReminderSummary(summary);
        logEvent('info', 'scheduler.grocery_reminder_sent', {
          localDate,
          recipients: summary.recipients.length,
        });

        return { sent: true, localDate, recipients: summary.recipients };
      }

      getRecentGroceryReminders(limit = 10): GroceryReminderSummary[] {
        this.ensureSchedulerTables();

        return [
          ...this.ctx.storage.sql.exec(
            'SELECT summary_json FROM grocery_reminders ORDER BY sent_at DESC LIMIT ?',
            limit,
          ),
        ].map(
          (row: { summary_json: string }) => JSON.parse(row.summary_json) as GroceryReminderSummary,
        );
      }

      private ensureSchedulerTables() {
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS scheduler_idempotency (
            key TEXT PRIMARY KEY,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS grocery_reminders (
            local_date TEXT PRIMARY KEY,
            sent_at TEXT NOT NULL,
            recipients_json TEXT NOT NULL,
            summary_json TEXT NOT NULL
          );
        `);
      }

      private async dispatchReminderSummary(summary: GroceryReminderSummary) {
        try {
          await dispatch({
            agent: 'charles',
            id: 'default',
            session: 'scheduler',
            input: {
              type: 'grocery.reminder.sent',
              summary,
            },
          });
        } catch (error) {
          console.warn('Failed to dispatch grocery reminder summary to charles agent', {
            error: String(error),
          });
        }
      }
    },
});
