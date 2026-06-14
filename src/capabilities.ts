export type ConfiguredMcpServer = {
  name: 'GitHub' | 'Exa' | 'Resy';
  url: string;
  secretName?: keyof Env;
};

export const MCP_SERVER_URLS = {
  github: 'https://api.githubcopilot.com/mcp/',
  exa: 'https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa,web_search_advanced_exa',
  resy: 'https://apigw.americanexpress.com/dining/v1/mcp',
} as const;

export const CONFIGURED_MCP_SERVERS: ConfiguredMcpServer[] = [
  {
    name: 'GitHub',
    url: MCP_SERVER_URLS.github,
    secretName: 'GITHUB_MCP_PAT',
  },
  {
    name: 'Exa',
    url: MCP_SERVER_URLS.exa,
    secretName: 'EXA_API_KEY',
  },
  {
    name: 'Resy',
    url: MCP_SERVER_URLS.resy,
  },
];

export const BUNDLED_SKILLS = ['browser-run', 'grocery', 'parts-search', 'research'] as const;
