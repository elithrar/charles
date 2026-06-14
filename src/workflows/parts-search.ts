import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';
import { buildPartsSearchStub, type PartsSearchRequest } from '../services/parts.ts';

export const route: WorkflowRouteHandler = async (_c, next) => next();

export async function run({ payload }: FlueContext<PartsSearchRequest, Env>) {
  return buildPartsSearchStub(payload);
}
