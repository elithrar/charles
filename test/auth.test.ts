import { describe, expect, it, vi } from 'vitest';
import { createCharlesAuth } from '../src/auth.ts';
import type { AuthSort, AuthWhere } from '../src/auth-store.ts';

type AuthRecord = Record<string, unknown> & { id: string };

class MemoryAuthStore {
  private readonly records = new Map<string, AuthRecord[]>();

  async createAuthRecord(
    model: string,
    data: AuthRecord,
    uniqueFields: string[] = [],
  ): Promise<AuthRecord> {
    this.assertUnique(model, data, uniqueFields);
    this.records.set(model, [...this.list(model), data]);
    return data;
  }

  async findAuthRecords(input: {
    model: string;
    where?: AuthWhere[];
    sortBy?: AuthSort;
    limit?: number;
    offset?: number;
  }): Promise<AuthRecord[]> {
    const offset = input.offset ?? 0;
    const records = this.list(input.model).filter((record) => this.matches(record, input.where));
    const sorted = input.sortBy ? this.sort(records, input.sortBy) : records;
    return input.limit === undefined
      ? sorted.slice(offset)
      : sorted.slice(offset, offset + input.limit);
  }

  async countAuthRecords(model: string, where?: AuthWhere[]): Promise<number> {
    return this.list(model).filter((record) => this.matches(record, where)).length;
  }

  async updateAuthRecord(
    model: string,
    where: AuthWhere[],
    update: Record<string, unknown>,
    uniqueFields: string[] = [],
  ): Promise<AuthRecord | null> {
    const records = this.list(model);
    const index = records.findIndex((record) => this.matches(record, where));
    if (index === -1) {
      return null;
    }

    const updated = { ...records[index], ...update };
    this.assertUnique(model, updated, uniqueFields);
    records[index] = updated;
    this.records.set(model, records);
    return updated;
  }

  async updateAuthRecords(
    model: string,
    where: AuthWhere[],
    update: Record<string, unknown>,
    uniqueFields: string[] = [],
  ): Promise<number> {
    const records = this.list(model);
    let count = 0;
    const updated = records.map((record) => {
      if (!this.matches(record, where)) {
        return record;
      }

      count += 1;
      const next = { ...record, ...update };
      this.assertUnique(model, next, uniqueFields);
      return next;
    });
    this.records.set(model, updated);
    return count;
  }

  async deleteAuthRecords(model: string, where: AuthWhere[], limit?: number): Promise<number> {
    const records = this.list(model);
    let count = 0;
    const kept = records.filter((record) => {
      if (this.matches(record, where) && (limit === undefined || count < limit)) {
        count += 1;
        return false;
      }

      return true;
    });
    this.records.set(model, kept);
    return count;
  }

  async consumeAuthRecord(model: string, where: AuthWhere[]): Promise<AuthRecord | null> {
    const records = this.list(model);
    const index = records.findIndex((record) => this.matches(record, where));
    if (index === -1) {
      return null;
    }

    const [record] = records.splice(index, 1);
    this.records.set(model, records);
    return record;
  }

  async incrementAuthRecord(input: {
    model: string;
    where: AuthWhere[];
    increment: Record<string, number>;
    set?: Record<string, unknown>;
  }): Promise<AuthRecord | null> {
    const record = await this.updateAuthRecord(input.model, input.where, input.set ?? {});
    if (!record) {
      return null;
    }

    const incremented = { ...record };
    for (const [field, delta] of Object.entries(input.increment)) {
      incremented[field] =
        (typeof incremented[field] === 'number' ? incremented[field] : 0) + delta;
    }

    await this.updateAuthRecord(
      input.model,
      [{ field: 'id', operator: 'eq', value: record.id, connector: 'AND', mode: 'sensitive' }],
      incremented,
    );
    return incremented;
  }

  private list(model: string): AuthRecord[] {
    return [...(this.records.get(model) ?? [])];
  }

  private sort(records: AuthRecord[], sortBy: AuthSort): AuthRecord[] {
    return [...records].sort((left, right) => {
      const leftValue = String(left[sortBy.field] ?? '');
      const rightValue = String(right[sortBy.field] ?? '');
      const comparison = leftValue.localeCompare(rightValue);
      return sortBy.direction === 'asc' ? comparison : -comparison;
    });
  }

  private matches(record: AuthRecord, where: AuthWhere[] = []): boolean {
    if (!where.length) {
      return true;
    }

    return where.every((clause) => {
      const left = record[clause.field];
      const right = clause.value;
      if (clause.operator === 'eq') {
        return left === right;
      }
      if (clause.operator === 'ne') {
        return left !== right;
      }
      if (clause.operator === 'in') {
        return Array.isArray(right) && right.includes(left as never);
      }
      if (clause.operator === 'contains') {
        return typeof left === 'string' && typeof right === 'string' && left.includes(right);
      }
      return false;
    });
  }

  private assertUnique(model: string, data: AuthRecord, uniqueFields: string[]) {
    for (const field of uniqueFields) {
      const value = data[field];
      if (value === undefined || value === null) {
        continue;
      }

      if (this.list(model).some((record) => record.id !== data.id && record[field] === value)) {
        throw new Error(`Unique constraint violation on ${model}.${field}`);
      }
    }
  }
}

function testEnv(store = new MemoryAuthStore()) {
  const send = vi.fn(async () => ({ messageId: 'magic-link' }));
  return {
    store,
    send,
    env: {
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      PUBLIC_ORIGIN: 'https://charles.test',
      AGENT_FROM_EMAIL: 'charles@questionable.services',
      AUTH_STORE: { getByName: () => store },
      EMAIL: { send },
    } as unknown as Env,
  };
}

function magicLinkFromSend(send: ReturnType<typeof vi.fn>): string {
  const text = send.mock.calls[0]?.[0]?.text as string | undefined;
  const match = text?.match(/\((https:\/\/[^)]+)\)/);
  if (!match) {
    throw new Error(`Magic link missing from email text: ${text}`);
  }
  return match[1];
}

describe('Charles auth adapter', () => {
  it('creates, consumes, reads, and deletes magic-link sessions', async () => {
    const { env, send, store } = testEnv();
    const auth = createCharlesAuth(env, 'https://charles.test/api/auth/sign-in/magic-link');
    const signIn = await auth.handler(
      new Request('https://charles.test/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'MATT@EATSLEEPREPEAT.NET', callbackURL: '/dashboard' }),
      }),
    );

    expect(signIn.status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'matt@eatsleeprepeat.net',
        html: expect.stringContaining('Sign in to Charles'),
      }),
    );
    expect(await store.countAuthRecords('verification')).toBe(1);

    const verify = await auth.handler(new Request(magicLinkFromSend(send), { redirect: 'manual' }));
    const cookie = verify.headers.get('set-cookie') ?? '';

    expect(verify.status).toBeGreaterThanOrEqual(300);
    expect(verify.status).toBeLessThan(400);
    expect(await store.countAuthRecords('verification')).toBe(0);

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe('matt@eatsleeprepeat.net');
    expect(await store.countAuthRecords('session')).toBe(1);

    await store.deleteAuthRecords('session', [
      {
        field: 'token',
        operator: 'eq',
        value: session?.session.token ?? '',
        connector: 'AND',
        mode: 'sensitive',
      },
    ]);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it('blocks magic-link creation for non-allowlisted email addresses', async () => {
    const { env, send, store } = testEnv();
    const auth = createCharlesAuth(env, 'https://charles.test/api/auth/sign-in/magic-link');
    const response = await auth.handler(
      new Request('https://charles.test/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'stranger@example.com', callbackURL: '/dashboard' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    expect(await store.countAuthRecords('verification')).toBe(0);
  });
});
