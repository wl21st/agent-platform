import {
  COSMETIC_SAFE_CHECK_AGENT,
  INGREDIENTS_SCRAPE_AGENT,
  NEWS_SCRAPE_AGENT,
  NEWS_SUMMARY_AGENT,
  ORCHESTRATOR_AGENT,
  SEARCH_AGENT,
  STOCK_DATA_AGENT,
  WEATHER_AGENT,
  WEBPAGE_SUMMARIZE_AGENT,
  type AgentSummary,
  type UserPreferences,
  type WeatherContext,
} from '@/lib/agent-chat';
import { runCosmeticSafeCheckAgent } from '@backend/agents/cosmeticSafeCheckAgent';
import { runIngredientsScrapeAgent } from '@backend/agents/ingredientsScrapeAgent';
import { runNewsScrapeAgent } from '@backend/agents/newsScrapeAgent';
import { runNewsSummaryAgent } from '@backend/agents/newsSummaryAgent';
import { runStockDataAgent } from '@backend/agents/stockDataAgent';
import { runTechnicalAnalysisAgent } from '@backend/agents/technicalAnalysisAgent';
import { runWebpageSummarizeAgent } from '@backend/agents/webpageSummarizeAgent';
import { runWeatherAgent } from '@backend/agents/weatherAgent';
import { runSearchAgent, extractSearchTopic } from '@backend/agents/searchAgent';

export type ToolRoute = 'weather' | 'search' | 'webpage-summarize' | 'cosmetic-safe-check' | 'ingredients-scrape' | 'stock-data' | 'news-scrape' | 'news-summary' | 'stock-analysis';

export interface ToolExecutionContext {
  input: string;
  preferences: UserPreferences;
  /** LLM-extracted location override (skips regex extraction when provided) */
  extractedLocation?: string;
  /** LLM-extracted timeframe override */
  extractedTimeframe?: 'current' | 'tomorrow';
  /** LLM-extracted search query override */
  extractedSearchQuery?: string;
  /** LLM-extracted URL override (webpage-summarize queries) */
  extractedUrl?: string;
  /** LLM-extracted stock ticker symbol (stock-data queries) */
  extractedTicker?: string;
  /** LLM-extracted news URLs (news-summary queries) */
  extractedNewsUrls?: Array<{url: string, title: string}>;
}

export interface ToolExecutionResult {
  agent: AgentSummary;
  markdown: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface ToolDefinition {
  route: ToolRoute;
  taskId: string;
  taskDescription: string;
  keywords: RegExp;
  agentName: string;
  execute: (context: ToolExecutionContext) => Promise<ToolExecutionResult>;
  buildPreferenceUpdates?: (context: ToolExecutionContext) => Partial<UserPreferences>;
}






export const TOOL_REGISTRY: Record<ToolRoute, ToolDefinition> = {
  weather: {
    route: 'weather',
    taskId: 'weather-tool',
    taskDescription: 'Fetch weather data using Weather Agent',
    keywords: /(weather|temperature|forecast|rain|sunny|tomorrow|明天|下雨|气温|天气)/i,
    agentName: WEATHER_AGENT.name,
    execute: runWeatherAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: WEATHER_AGENT.name,
    }),
  },
  search: {
    route: 'search',
    taskId: 'search-tool',
    taskDescription: 'Collect research context using Search Agent',
    keywords: /(search|find|look up|research|latest|news)/i,
    agentName: SEARCH_AGENT.name,
    execute: runSearchAgent,
    buildPreferenceUpdates: ({ input, preferences }) => ({
      recentSearchTopics: [extractSearchTopic(input), ...preferences.recentSearchTopics],
      lastUsedAgent: SEARCH_AGENT.name,
    }),
  },
  'webpage-summarize': {
    route: 'webpage-summarize',
    taskId: 'webpage-summarize-tool',
    taskDescription: 'Fetch and summarize webpage content using Webpage Summarize Agent',
    keywords: /(summarize|summary|summarise|webpage|web\s*page|url|总结|网页|概括|摘要|https?:\/\/)/i,
    agentName: WEBPAGE_SUMMARIZE_AGENT.name,
    execute: runWebpageSummarizeAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: WEBPAGE_SUMMARIZE_AGENT.name,
    }),
  },
  'cosmetic-safe-check': {
    route: 'cosmetic-safe-check',
    taskId: 'cosmetic-safe-check-tool',
    taskDescription: 'Analyze cosmetic ingredients for safety risks using Cosmetic Safe Check Agent',
    keywords: /(cosmetic|skincare|skin\s*care|ingredient|ingredients|paraben|sulfate|化妆品|护肤|成分|配方|安全)/i,
    agentName: COSMETIC_SAFE_CHECK_AGENT.name,
    execute: runCosmeticSafeCheckAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: COSMETIC_SAFE_CHECK_AGENT.name,
    }),
  },
  'ingredients-scrape': {
    route: 'ingredients-scrape',
    taskId: 'ingredients-scrape-tool',
    taskDescription: 'Scrape product ingredients from a URL and analyze safety using Ingredients Scrape Agent',
    keywords: /(scrape\s*ingredient|ingredient.*scrape|extract\s*ingredient|ingredient.*extract|ingredient.*url|ingredient.*from.*http|product\s*ingredient.*http|scrape.*cosmetic|提取.*成分|成分.*提取|爬取.*成分)/i,
    agentName: INGREDIENTS_SCRAPE_AGENT.name,
    execute: runIngredientsScrapeAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: INGREDIENTS_SCRAPE_AGENT.name,
    }),
  },
  'stock-data': {
    route: 'stock-data',
    taskId: 'stock-data-tool',
    taskDescription: 'Fetch financial statements and analyze stock data using Stock Data Agent',
    keywords: /(stock|股票|财报|财务|balance\s*sheet|income\s*statement|cash\s*flow|financial|earnings|revenue|利润|资产负债|现金流|年报|季报|\$[A-Za-z]{1,6}\b|ticker)/i,
    agentName: STOCK_DATA_AGENT.name,
    execute: runStockDataAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: STOCK_DATA_AGENT.name,
    }),
  },
  'news-scrape': {
    route: 'news-scrape',
    taskId: 'news-scrape-tool',
    taskDescription: 'Search and scrape recent news articles for a stock using News Scrape Agent',
    keywords: /(news|新闻|article|articles|headlines|报道|\$[A-Za-z]{1,6}\s*news|ticker.*news)/i,
    agentName: NEWS_SCRAPE_AGENT.name,
    execute: runNewsScrapeAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: NEWS_SCRAPE_AGENT.name,
    }),
  },
  'news-summary': {
    route: 'news-summary',
    taskId: 'news-summary-tool',
    taskDescription: 'Summarize news articles and analyze overall sentiment using News Summary Agent',
    keywords: /(summarize.*news|news.*summary|sentiment|analysis|analyze.*news|新闻.*总结|总结.*新闻)/i,
    agentName: NEWS_SUMMARY_AGENT.name,
    execute: runNewsSummaryAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: NEWS_SUMMARY_AGENT.name,
    }),
  },
  'stock-analysis': {
    route: 'stock-analysis',
    taskId: 'stock-analysis-tool',
    taskDescription: 'Full investment analysis: fundamentals + news + technical → risk → buy/hold/sell decision',
    keywords: /(should\s+i\s+buy|can\s+i\s+buy|is\s+it\s+good\s+to\s+buy|buy.*now|investment\s+analysis|comprehensive.*analysis|buy.*stock|stock.*invest|该.*买|可以.*买|值得.*买)/i,
    agentName: ORCHESTRATOR_AGENT.name,
    // In parallel/single-intent non-streaming contexts: just run technical analysis as a proxy
    // The full pipeline (fundamentals + news + technical + risk + decision) is handled by
    // streamStockAnalysisWorkflow in the orchestrator.
    execute: runTechnicalAnalysisAgent,
    buildPreferenceUpdates: () => ({
      lastUsedAgent: ORCHESTRATOR_AGENT.name,
    }),
  },
};

export function resolveToolRoute(input: string): ToolRoute | 'none' {
  const matchedTool = Object.values(TOOL_REGISTRY).find((tool) => tool.keywords.test(input));
  return matchedTool?.route ?? 'none';
}

/**
 * Detect if the user is asking to convert or reinterpret previously-received
 * data (e.g. "convert the temperature to celsius") rather than requesting a
 * brand-new lookup.  This prevents keyword overlap — the word "temperature"
 * would normally trigger the weather tool — from causing redundant API calls.
 */
function isConversionFollowUp(input: string, preferences: UserPreferences): boolean {
  // Only relevant when we have prior weather context to convert
  if (!preferences.lastWeatherResult) {
    return false;
  }

  const lower = input.trim().toLowerCase();

  // Explicit conversion verbs (en / zh)
  if (/\b(convert|conversion)\b/i.test(lower) || /(?:换算|转换|换成|转成)/.test(input)) {
    return true;
  }

  // "temperature to/in celsius/fahrenheit" without a new-query keyword
  if (
    /\b(temperature|temp|温度)\b/i.test(lower) &&
    /\b(to|in|into)\s*(celsius|fahrenheit|centigrade|摄氏|华氏)/i.test(lower) &&
    !/\b(weather|forecast|天气)\b/i.test(lower)
  ) {
    return true;
  }

  // "show me in celsius", "what is that in fahrenheit"
  if (/\b(show|tell|give|what)\b.*\b(in|to)\s*(celsius|fahrenheit|centigrade|摄氏|华氏)/i.test(lower)) {
    return true;
  }

  return false;
}

export function resolveToolRouteWithContext(context: {
  input: string;
  preferences: UserPreferences;
}): ToolRoute | 'none' {
  // Conversion / reinterpretation requests should NOT trigger a new tool call;
  // they will be answered from stored context or by the LLM.
  if (isConversionFollowUp(context.input, context.preferences)) {
    return 'none';
  }

  const directMatch = resolveToolRoute(context.input);

  if (directMatch !== 'none') {
    return directMatch;
  }


  return 'none';
}

export function getToolDefinition(route: ToolRoute) {
  return TOOL_REGISTRY[route];
}
