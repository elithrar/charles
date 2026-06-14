import {
  connectMcpServer,
  createAgent,
  type FlueContext,
  type McpServerConnection,
  type WorkflowRouteHandler,
} from '@flue/runtime';
import researchSkill from '../../.agents/skills/research/SKILL.md' with { type: 'skill' };
import { MCP_SERVER_URLS } from '../capabilities.ts';
import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL } from '../config.ts';
import { BROWSER_RUN_AGENT_INSTRUCTIONS, createBrowserRunTools } from '../tools/browser-run.ts';

type ResearchPayload = {
  prompt: string;
  context?: Array<{ title?: string; url: string; text: string }>;
};

export const route: WorkflowRouteHandler = async (_c, next) => next();

function extractCitationUrls(text: string): Array<{ url: string; summary: string }> {
  const urls = [...text.matchAll(/https?:\/\/[^\s)\],.]+/g)].map((match) => match[0]);
  return [...new Set(urls)].map((url) => ({ url, summary: 'Referenced in research answer.' }));
}

const GITHUB_MCP_AGENT_INSTRUCTIONS = `
<github_mcp_tool>
Use the GitHub MCP tools for GitHub tasks the user asks you to do: inspect repositories and files, search code, read issues and pull requests, manage issues and pull requests, inspect Actions runs, and gather repository context.

GitHub task policy:
- Use GitHub MCP tools instead of Browser Run for GitHub API work when the tools are available.
- You may perform GitHub write actions when the authenticated user explicitly asks for that action, such as creating or updating an issue or pull request.
- Do not merge pull requests, delete branches, delete repositories, publish releases, change repository settings, alter permissions, or trigger destructive actions unless the user explicitly requests that exact operation in the current task.
- Before write actions, summarize the intended change in the tool arguments. After write actions, report the GitHub URL or identifier returned by the tool.
- Keep GitHub context compact: fetch the specific files, issues, PRs, checks, or logs needed; avoid broad repository dumps.
</github_mcp_tool>`;

const EXA_MCP_AGENT_INSTRUCTIONS = `
<exa_mcp_tool>
Use Exa MCP tools for high-quality web search, code/documentation search, and page fetching when the user asks for current research, source discovery, technical examples, or synthesized web evidence.

Exa task policy:
- Prefer Exa MCP search for broad discovery and source finding; use Browser Run when you need rendered page inspection, screenshots, visual context, or page navigation.
- Use web_fetch_exa on the most relevant URLs before making claims that depend on page content.
- Use web_search_advanced_exa when date ranges, domain filters, research-paper categories, or stricter search controls matter.
- Keep result context compact: search narrowly, fetch only the best sources, deduplicate similar results, and cite source URLs in the answer.
- If Exa results conflict with Browser Run or GitHub MCP evidence, say so and explain which source is more authoritative for the specific claim.
</exa_mcp_tool>`;

const RESY_MCP_AGENT_INSTRUCTIONS = `
<resy_mcp_tool>
Use Resy MCP tools for dining and restaurant tasks: researching restaurants, checking availability, comparing reservation options, and answering current Resy-related questions.

Resy task policy:
- Prefer Resy MCP tools over generic web search for restaurant availability, venue details, and reservation-specific facts.
- Use Exa or Browser Run only to supplement Resy with broader reviews, menus, maps, or rendered page context.
- Do not book, cancel, or modify reservations unless the authenticated user explicitly asks for that exact action.
- Summarize availability with dates, times, party size, venue names, locations, and any uncertainty from the tool response.
</resy_mcp_tool>`;

const researcher = createAgent((_context) => ({
  model: DEFAULT_MODEL,
  thinkingLevel: DEFAULT_THINKING_LEVEL,
  skills: [researchSkill],
  tools: createBrowserRunTools(_context.env as Env),
  instructions: `You synthesize concise research answers from tool evidence.

<tool_routing>
- Use Exa MCP for broad web/source discovery and page fetching.
- Use Resy MCP for restaurant, dining, and reservation availability research.
- Use GitHub MCP for repository, issue, pull request, code, and Actions tasks.
- Use Browser Run for rendered-page context, navigation, screenshots, PDFs, or URL inspection.
</tool_routing>

<rules>
- Cite URLs used as evidence.
- Return at least one citation for source-backed claims whenever tools provide source URLs.
- Prefer fetched/source evidence over model memory for current facts.
- State uncertainty when a tool is unavailable or sources conflict.
</rules>

${BROWSER_RUN_AGENT_INSTRUCTIONS}

${GITHUB_MCP_AGENT_INSTRUCTIONS}

${EXA_MCP_AGENT_INSTRUCTIONS}

${RESY_MCP_AGENT_INSTRUCTIONS}`,
}));

async function connectMcpSafely(
  name: string,
  options: Parameters<typeof connectMcpServer>[1],
): Promise<McpServerConnection | null> {
  try {
    return await connectMcpServer(name, options);
  } catch (error) {
    console.warn('MCP connection failed', { name, error: String(error) });
    return null;
  }
}

async function connectGitHubMcp(env: Env): Promise<McpServerConnection | null> {
  if (!env.GITHUB_MCP_PAT) {
    return null;
  }

  return connectMcpSafely('github', {
    url: MCP_SERVER_URLS.github,
    headers: {
      Authorization: `Bearer ${env.GITHUB_MCP_PAT}`,
    },
  });
}

async function connectExaMcp(env: Env): Promise<McpServerConnection | null> {
  if (!env.EXA_API_KEY) {
    return null;
  }

  return connectMcpSafely('exa', {
    url: MCP_SERVER_URLS.exa,
    headers: {
      'x-api-key': env.EXA_API_KEY,
    },
  });
}

async function connectResyMcp(): Promise<McpServerConnection | null> {
  return connectMcpSafely('resy', {
    url: MCP_SERVER_URLS.resy,
  });
}

export async function run({ init, payload, env }: FlueContext<ResearchPayload, Env>) {
  const [github, exa, resy] = await Promise.all([
    connectGitHubMcp(env),
    connectExaMcp(env),
    connectResyMcp(),
  ]);
  try {
    const harness = await init(researcher, {
      tools: [...(github?.tools ?? []), ...(exa?.tools ?? []), ...(resy?.tools ?? [])],
    });
    const session = await harness.session('research');
    const context =
      payload.context
        ?.map((item) => `- ${item.title ?? item.url}: ${item.url}\n${item.text}`)
        .join('\n\n') ?? 'No browser context supplied yet.';
    const response = await session.skill('research', {
      args: {
        prompt: payload.prompt,
        context,
      },
    });

    return {
      answer: response.text,
      citations: extractCitationUrls(response.text),
      githubMcpEnabled: Boolean(github),
      exaMcpEnabled: Boolean(exa),
      resyMcpEnabled: Boolean(resy),
    };
  } finally {
    await Promise.all([github?.close(), exa?.close(), resy?.close()]);
  }
}
