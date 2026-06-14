import { createAgent, type AgentRouteHandler } from '@flue/runtime';
import grocery from '../../.agents/skills/grocery/SKILL.md' with { type: 'skill' };
import partsSearch from '../../.agents/skills/parts-search/SKILL.md' with { type: 'skill' };
import research from '../../.agents/skills/research/SKILL.md' with { type: 'skill' };
import charlesPrompt from './prompt.md?raw';
import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL } from '../config.ts';
import { BROWSER_RUN_AGENT_INSTRUCTIONS, createBrowserRunTools } from '../tools/browser-run.ts';

export const route: AgentRouteHandler = async (_c, next) => next();

export default createAgent((_context) => ({
  model: DEFAULT_MODEL,
  thinkingLevel: DEFAULT_THINKING_LEVEL,
  skills: [grocery, research, partsSearch],
  tools: createBrowserRunTools(_context.env as Env),
  instructions: `${charlesPrompt.trim()}

${BROWSER_RUN_AGENT_INSTRUCTIONS}`,
}));
