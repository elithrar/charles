import {
  createAdapterFactory,
  type CleanedWhere,
  type DBAdapterDebugLogOption,
} from 'better-auth/adapters';
import type { CharlesAuthStore, AuthSort, AuthWhere } from './auth-store.ts';

type AuthStoreStub = DurableObjectStub<CharlesAuthStore>;

type CharlesAuthAdapterConfig = {
  store: AuthStoreStub;
  debugLogs?: DBAdapterDebugLogOption;
};

function toAuthWhere(where: CleanedWhere[] = []): AuthWhere[] {
  return where.map((clause) => ({
    operator: clause.operator,
    value: clause.value as AuthWhere['value'],
    field: clause.field,
    connector: clause.connector,
    mode: clause.mode,
  }));
}

export function charlesAuthAdapter({ store, debugLogs = false }: CharlesAuthAdapterConfig) {
  return createAdapterFactory({
    config: {
      adapterId: 'charles-auth-store',
      adapterName: 'Charles Auth Store',
      debugLogs,
      supportsArrays: true,
      supportsBooleans: true,
      supportsDates: false,
      supportsJSON: true,
      supportsNumericIds: false,
      transaction: false,
    },
    adapter: ({ schema, getDefaultModelName, getFieldName }) => {
      const uniqueFieldsFor = (model: string): string[] => {
        const defaultModel = getDefaultModelName(model);
        const fields = schema[defaultModel]?.fields ?? {};

        return Object.entries(fields)
          .filter(([, field]) => field.unique)
          .map(([field]) => getFieldName({ model: defaultModel, field }));
      };

      return {
        create: async ({ model, data }) =>
          store.createAuthRecord(
            model,
            data as { id: string } & Record<string, unknown>,
            uniqueFieldsFor(model),
          ),
        findOne: async ({ model, where }) => {
          const records = await store.findAuthRecords({
            model,
            where: toAuthWhere(where),
            limit: 1,
          });
          return records[0] ?? null;
        },
        findMany: async ({ model, where, limit, sortBy, offset }) =>
          store.findAuthRecords({
            model,
            where: toAuthWhere(where),
            limit,
            sortBy: sortBy as AuthSort | undefined,
            offset,
          }),
        count: async ({ model, where }) => store.countAuthRecords(model, toAuthWhere(where)),
        update: async ({ model, where, update }) =>
          store.updateAuthRecord(
            model,
            toAuthWhere(where),
            update as Record<string, unknown>,
            uniqueFieldsFor(model),
          ),
        updateMany: async ({ model, where, update }) =>
          store.updateAuthRecords(model, toAuthWhere(where), update, uniqueFieldsFor(model)),
        delete: async ({ model, where }) => {
          await store.deleteAuthRecords(model, toAuthWhere(where));
        },
        deleteMany: async ({ model, where }) => store.deleteAuthRecords(model, toAuthWhere(where)),
        consumeOne: async ({ model, where }) => store.consumeAuthRecord(model, toAuthWhere(where)),
        incrementOne: async ({ model, where, increment, set }) =>
          store.incrementAuthRecord({
            model,
            where: toAuthWhere(where),
            increment,
            set,
          }),
        options: {
          supportsNativeJoins: false satisfies boolean,
        },
      };
    },
  });
}
