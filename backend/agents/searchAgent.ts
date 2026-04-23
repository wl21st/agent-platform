import {
  SEARCH_AGENT,
  type AgentSummary,
} from '@/lib/agent-chat';

export type ToolExecutionContext = {
  input: string;
  preferences: {
    recentSearchTopics: string[];
    lastUsedAgent?: string;
  };
  extractedSearchQuery?: string;
};

export interface ToolExecutionResult {
  agent: AgentSummary;
  markdown: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export function extractSearchTopic(input: string) {
  const cleaned = input
    .replace(/^(search|find|look up|research|what is|what are)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  return cleaned || 'latest AI developments';
}

export async function runSearchAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const topic = context.extractedSearchQuery || extractSearchTopic(context.input);
  const keywords = topic
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() + word.slice(1));

  const results = [
    `${keywords[0] || 'Topic'} overview and recent updates`,
    `${keywords[1] || 'Industry'} trends and notable announcements`,
    `${keywords[2] || 'Research'} analysis and practical implications`,
  ];

  return {
    agent: SEARCH_AGENT,
    summary: `Search summary prepared for ${topic}.`,
    markdown: [
      `# Search Results`,
      '',
      `**Query:** ${topic}`,
      '',
      `## Top Results`,
      `1. **${results[0]}** — concise briefing with current context`,
      `2. **${results[1]}** — highlights key market and product movement`,
      `3. **${results[2]}** — summarizes deeper takeaways and trade-offs`,
      '',
      `## Summary`,
      `The available information suggests that **${topic}** is active and evolving, with multiple practical angles worth tracking.`,
      '',
      '*Provided by Search Agent*',
    ].join('\n'),
    metadata: {
      topic,
      results,
    },
  };
}