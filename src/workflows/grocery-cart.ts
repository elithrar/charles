import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';
import { runGroceryCartRequest, type GroceryCartRequest } from '../services/grocery.ts';

export const route: WorkflowRouteHandler = async (_c, next) => next();

export async function run({ payload, env }: FlueContext<GroceryCartRequest, Env>) {
  const result = await runGroceryCartRequest(payload, env);
  return 'error' in result ? { error: result.error } : result.value;
}
