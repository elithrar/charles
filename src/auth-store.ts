import { DurableObject } from 'cloudflare:workers';

export type AuthWhere = {
  operator:
    | 'eq'
    | 'ne'
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'in'
    | 'not_in'
    | 'contains'
    | 'starts_with'
    | 'ends_with';
  value: string | number | boolean | string[] | number[] | null;
  field: string;
  connector: 'AND' | 'OR';
  mode: 'sensitive' | 'insensitive';
};

export type AuthSort = {
  field: string;
  direction: 'asc' | 'desc';
};

type AuthRecord = Record<string, unknown> & { id: string };

type StoredAuthRow = {
  id: string;
  data: string;
};

export type EmailThreadSummary = {
  threadKey: string;
  from: string;
  subject: string;
  intent: string;
  latestAt: string;
  messageCount: number;
};

export type EmailThreadPage = {
  items: EmailThreadSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type EmailThreadMessage = {
  id: string;
  threadKey: string;
  from: string;
  fromName?: string;
  subject: string;
  intent: string;
  direction: 'inbound' | 'outbound';
  bodyMarkdown: string;
  receivedAt: string;
};

export type RecordEmailThreadInput = {
  threadKey: string;
  sender: string;
  subject: string;
  intent: string;
  receivedAt: string;
  inboundText: string;
  replyText: string;
};

function compareInsensitive(left: unknown, right: unknown): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

function includesInsensitive(left: unknown, values: unknown[]): boolean {
  if (typeof left !== 'string') {
    return values.includes(left);
  }

  return values.some(
    (value) => typeof value === 'string' && left.toLowerCase() === value.toLowerCase(),
  );
}

function compareOrdered(left: unknown, right: unknown): number | null {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right);
  }

  return null;
}

function evaluateClause(record: AuthRecord, clause: AuthWhere): boolean {
  const recordValue = record[clause.field];
  const value = clause.value;
  const insensitive =
    clause.mode === 'insensitive' &&
    (typeof value === 'string' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string')));

  switch (clause.operator) {
    case 'in':
      return (
        Array.isArray(value) &&
        (insensitive
          ? includesInsensitive(recordValue, value)
          : value.includes(recordValue as never))
      );
    case 'not_in':
      return (
        Array.isArray(value) &&
        !(insensitive
          ? includesInsensitive(recordValue, value)
          : value.includes(recordValue as never))
      );
    case 'contains':
      return (
        typeof recordValue === 'string' &&
        typeof value === 'string' &&
        (insensitive
          ? recordValue.toLowerCase().includes(value.toLowerCase())
          : recordValue.includes(value))
      );
    case 'starts_with':
      return (
        typeof recordValue === 'string' &&
        typeof value === 'string' &&
        (insensitive
          ? recordValue.toLowerCase().startsWith(value.toLowerCase())
          : recordValue.startsWith(value))
      );
    case 'ends_with':
      return (
        typeof recordValue === 'string' &&
        typeof value === 'string' &&
        (insensitive
          ? recordValue.toLowerCase().endsWith(value.toLowerCase())
          : recordValue.endsWith(value))
      );
    case 'ne':
      return insensitive ? !compareInsensitive(recordValue, value) : recordValue !== value;
    case 'gt':
      return value !== null && (compareOrdered(recordValue, value) ?? 0) > 0;
    case 'gte':
      return value !== null && (compareOrdered(recordValue, value) ?? -1) >= 0;
    case 'lt':
      return value !== null && (compareOrdered(recordValue, value) ?? 0) < 0;
    case 'lte':
      return value !== null && (compareOrdered(recordValue, value) ?? 1) <= 0;
    case 'eq':
      if (value === null) {
        return recordValue === null || recordValue === undefined;
      }

      return insensitive ? compareInsensitive(recordValue, value) : recordValue === value;
  }
}

function matchesWhere(record: AuthRecord, where: AuthWhere[] = []): boolean {
  if (where.length === 0) {
    return true;
  }

  let result = evaluateClause(record, where[0]);
  for (const clause of where) {
    const clauseResult = evaluateClause(record, clause);
    result = clause.connector === 'OR' ? result || clauseResult : result && clauseResult;
  }

  return result;
}

function sortRecords(records: AuthRecord[], sortBy?: AuthSort): AuthRecord[] {
  if (!sortBy) {
    return records;
  }

  return records.sort((left, right) => {
    const leftValue = left[sortBy.field];
    const rightValue = right[sortBy.field];
    let comparison = 0;

    if (leftValue == null && rightValue == null) {
      comparison = 0;
    } else if (leftValue == null) {
      comparison = -1;
    } else if (rightValue == null) {
      comparison = 1;
    } else if (typeof leftValue === 'string' && typeof rightValue === 'string') {
      comparison = leftValue.localeCompare(rightValue);
    } else if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      comparison = leftValue - rightValue;
    } else if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
      comparison = leftValue === rightValue ? 0 : leftValue ? 1 : -1;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue));
    }

    return sortBy.direction === 'asc' ? comparison : -comparison;
  });
}

export class CharlesAuthStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS better_auth_records (
          model TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (model, id)
        );
        CREATE INDEX IF NOT EXISTS better_auth_records_model_idx ON better_auth_records (model);
        CREATE TABLE IF NOT EXISTS email_threads (
          id TEXT PRIMARY KEY,
          received_at TEXT NOT NULL,
          from_address TEXT NOT NULL,
          subject TEXT NOT NULL,
          intent TEXT NOT NULL,
          reply_text TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS email_threads_received_at_idx ON email_threads (received_at DESC);
        CREATE TABLE IF NOT EXISTS email_thread_messages (
          id TEXT PRIMARY KEY,
          thread_key TEXT NOT NULL,
          received_at TEXT NOT NULL,
          from_address TEXT NOT NULL,
          from_name TEXT,
          subject TEXT NOT NULL,
          intent TEXT NOT NULL,
          direction TEXT NOT NULL,
          body_markdown TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS email_thread_messages_thread_idx ON email_thread_messages (thread_key, received_at DESC);
        CREATE INDEX IF NOT EXISTS email_thread_messages_received_at_idx ON email_thread_messages (received_at DESC);
      `);
    });
  }

  async recordEmailThread(input: RecordEmailThreadInput): Promise<void> {
    const replyAt = new Date().toISOString();
    const rows = [
      {
        id: `${input.threadKey}:inbound:${input.receivedAt}`,
        receivedAt: input.receivedAt,
        from: input.sender,
        fromName: null,
        direction: 'inbound',
        bodyMarkdown: input.inboundText,
      },
      {
        id: `${input.threadKey}:outbound:${replyAt}`,
        receivedAt: replyAt,
        from: 'charles@questionable.services',
        fromName: 'Charles, your Agent',
        direction: 'outbound',
        bodyMarkdown: input.replyText,
      },
    ] as const;

    for (const row of rows) {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO email_thread_messages (id, thread_key, received_at, from_address, from_name, subject, intent, direction, body_markdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        row.id,
        input.threadKey,
        row.receivedAt,
        row.from,
        row.fromName,
        input.subject,
        input.intent,
        row.direction,
        row.bodyMarkdown,
      );
    }
  }

  async getRecentEmailThreads(page = 1, pageSize = 10): Promise<EmailThreadPage> {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;
    const totalRows = [
      ...this.ctx.storage.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM (SELECT thread_key FROM email_thread_messages GROUP BY thread_key)',
      ),
    ];
    const total = totalRows[0]?.count ?? 0;
    const items = [
      ...this.ctx.storage.sql.exec<{
        thread_key: string;
        latest_at: string;
        from_address: string;
        subject: string;
        intent: string;
        message_count: number;
      }>(
        `SELECT thread_key, MAX(received_at) AS latest_at, from_address, subject, intent, COUNT(*) AS message_count
         FROM email_thread_messages
         WHERE direction = 'inbound'
         GROUP BY thread_key
         ORDER BY latest_at DESC
         LIMIT ? OFFSET ?`,
        safePageSize,
        offset,
      ),
    ].map((row) => ({
      threadKey: row.thread_key,
      from: row.from_address,
      subject: row.subject,
      intent: row.intent,
      latestAt: row.latest_at,
      messageCount: row.message_count,
    }));

    return {
      items,
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };
  }

  async getEmailThread(threadKey: string): Promise<EmailThreadMessage[]> {
    return [
      ...this.ctx.storage.sql.exec<{
        id: string;
        thread_key: string;
        received_at: string;
        from_address: string;
        from_name: string | null;
        subject: string;
        intent: string;
        direction: 'inbound' | 'outbound';
        body_markdown: string;
      }>(
        'SELECT id, thread_key, received_at, from_address, from_name, subject, intent, direction, body_markdown FROM email_thread_messages WHERE thread_key = ? ORDER BY received_at DESC',
        threadKey,
      ),
    ].map((row) => ({
      id: row.id,
      threadKey: row.thread_key,
      from: row.from_address,
      fromName: row.from_name ?? undefined,
      subject: row.subject,
      intent: row.intent,
      direction: row.direction,
      bodyMarkdown: row.body_markdown,
      receivedAt: row.received_at,
    }));
  }

  async createAuthRecord(
    model: string,
    data: AuthRecord,
    uniqueFields: string[] = [],
  ): Promise<AuthRecord> {
    this.assertUnique(model, data, uniqueFields);

    this.ctx.storage.sql.exec(
      'INSERT INTO better_auth_records (model, id, data, updated_at) VALUES (?, ?, ?, ?)',
      model,
      data.id,
      JSON.stringify(data),
      new Date().toISOString(),
    );

    return data;
  }

  async findAuthRecords(input: {
    model: string;
    where?: AuthWhere[];
    sortBy?: AuthSort;
    limit?: number;
    offset?: number;
  }): Promise<AuthRecord[]> {
    const records = this.listModel(input.model).filter((record) =>
      matchesWhere(record, input.where),
    );
    const sorted = sortRecords(records, input.sortBy);
    const offset = input.offset ?? 0;
    const limited = input.limit === undefined ? sorted : sorted.slice(offset, offset + input.limit);
    return input.limit === undefined ? sorted.slice(offset) : limited;
  }

  async countAuthRecords(model: string, where?: AuthWhere[]): Promise<number> {
    return this.listModel(model).filter((record) => matchesWhere(record, where)).length;
  }

  async updateAuthRecord(
    model: string,
    where: AuthWhere[],
    update: Record<string, unknown>,
    uniqueFields: string[] = [],
  ): Promise<AuthRecord | null> {
    const target = this.listModel(model).find((record) => matchesWhere(record, where));
    if (!target) {
      return null;
    }

    const updated = { ...target, ...update };
    this.assertUnique(model, updated, uniqueFields);
    this.writeRecord(model, updated);
    return updated;
  }

  async updateAuthRecords(
    model: string,
    where: AuthWhere[],
    update: Record<string, unknown>,
    uniqueFields: string[] = [],
  ): Promise<number> {
    const targets = this.listModel(model).filter((record) => matchesWhere(record, where));
    for (const target of targets) {
      const updated = { ...target, ...update };
      this.assertUnique(model, updated, uniqueFields);
      this.writeRecord(model, updated);
    }

    return targets.length;
  }

  async deleteAuthRecords(model: string, where: AuthWhere[], limit?: number): Promise<number> {
    const targets = this.listModel(model)
      .filter((record) => matchesWhere(record, where))
      .slice(0, limit);

    for (const target of targets) {
      this.ctx.storage.sql.exec(
        'DELETE FROM better_auth_records WHERE model = ? AND id = ?',
        model,
        target.id,
      );
    }

    return targets.length;
  }

  async consumeAuthRecord(model: string, where: AuthWhere[]): Promise<AuthRecord | null> {
    const target = this.listModel(model).find((record) => matchesWhere(record, where));
    if (!target) {
      return null;
    }

    this.ctx.storage.sql.exec(
      'DELETE FROM better_auth_records WHERE model = ? AND id = ?',
      model,
      target.id,
    );
    return target;
  }

  async incrementAuthRecord(input: {
    model: string;
    where: AuthWhere[];
    increment: Record<string, number>;
    set?: Record<string, unknown>;
  }): Promise<AuthRecord | null> {
    const target = this.listModel(input.model).find((record) => matchesWhere(record, input.where));
    if (!target) {
      return null;
    }

    const updated: AuthRecord = { ...target, ...input.set };
    for (const [field, delta] of Object.entries(input.increment)) {
      const current = typeof updated[field] === 'number' ? updated[field] : 0;
      updated[field] = current + delta;
    }

    this.writeRecord(input.model, updated);
    return updated;
  }

  private listModel(model: string): AuthRecord[] {
    return [
      ...this.ctx.storage.sql.exec<StoredAuthRow>(
        'SELECT id, data FROM better_auth_records WHERE model = ?',
        model,
      ),
    ].map((row) => JSON.parse(row.data) as AuthRecord);
  }

  private writeRecord(model: string, data: AuthRecord): void {
    this.ctx.storage.sql.exec(
      'UPDATE better_auth_records SET data = ?, updated_at = ? WHERE model = ? AND id = ?',
      JSON.stringify(data),
      new Date().toISOString(),
      model,
      data.id,
    );
  }

  private assertUnique(model: string, data: AuthRecord, uniqueFields: string[]): void {
    for (const field of uniqueFields) {
      const value = data[field];
      if (value === undefined || value === null) {
        continue;
      }

      const duplicate = this.listModel(model).find(
        (record) => record.id !== data.id && record[field] === value,
      );
      if (duplicate) {
        throw new Error(`Unique constraint violation on ${model}.${field}`);
      }
    }
  }

  fetch(): Response {
    return new Response('Not found', { status: 404 });
  }
}
