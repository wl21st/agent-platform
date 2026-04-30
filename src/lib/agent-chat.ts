export type AgentId =
  | 'orchestrator'
  | 'weather'
  | 'search'
  | 'webpage-summarize'
  | 'cosmetic-safe-check'
  | 'ingredients-scrape'
  | 'stock-data'
  | 'news-scrape'
  | 'news-summary'
  | 'technical-analysis'
  | 'risk-assessment'
  | 'stock-decision'
  | 'liquidity-filter'
  | 'screen-hit'
  | 'final-select';

export interface AgentSummary {
  id: AgentId;
  name: string;
  icon: string;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  agent?: AgentSummary;
  status?: 'streaming' | 'done' | 'error';
}

export type TaskStatusValue = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskStatus {
  id: string;
  description: string;
  status: TaskStatusValue;
  agent?: string;
}

export interface UserPreferences {
  preferredWeatherLocation?: string;
  recentSearchTopics: string[];
  lastUsedAgent?: string;
  lastWeatherResult?: WeatherContext;
}

export interface WeatherContext {
  location: string;
  timeframe: 'current' | 'tomorrow';
  condition?: string;
  temperatureF?: number;
  temperatureC?: number;
  feelsLikeF?: number;
  feelsLikeC?: number;
  averageTemperatureF?: number;
  averageTemperatureC?: number;
  maxTemperatureF?: number;
  maxTemperatureC?: number;
  minTemperatureF?: number;
  minTemperatureC?: number;
  humidity?: number;
  windSpeedKph?: number;
  chanceOfRain?: number;
  localTime?: string;
  lastUpdated?: string;
}

export interface ConversationTurn {
  role: ChatRole;
  content: string;
  agentName?: string;
  timestamp: string;
}

export interface SessionSnapshot {
  sessionId: string;
  history: ChatMessage[];
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRequestBody {
  sessionId?: string;
  message: string;
}

export type StreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'tasks'; tasks: TaskStatus[] }
  | { type: 'message'; delta: string; agent?: AgentSummary }
  | { type: 'agent-done'; message: ChatMessage }
  | { type: 'done'; message: ChatMessage; tasks: TaskStatus[]; preferences: UserPreferences }
  | { type: 'error'; message: string };

export const ORCHESTRATOR_AGENT: AgentSummary = {
  id: 'orchestrator',
  name: 'Orchestrator Agent',
  icon: '🧠',
};

export const WEATHER_AGENT: AgentSummary = {
  id: 'weather',
  name: 'Weather Agent',
  icon: '🌤️',
};

export const SEARCH_AGENT: AgentSummary = {
  id: 'search',
  name: 'Search Agent',
  icon: '🔍',
};

export const WEBPAGE_SUMMARIZE_AGENT: AgentSummary = {
  id: 'webpage-summarize',
  name: 'Webpage Summarize Agent',
  icon: '📄',
};

export const COSMETIC_SAFE_CHECK_AGENT: AgentSummary = {
  id: 'cosmetic-safe-check',
  name: 'Cosmetic Safe Check Agent',
  icon: '🧴',
};

export const INGREDIENTS_SCRAPE_AGENT: AgentSummary = {
  id: 'ingredients-scrape',
  name: 'Ingredients Scrape Agent',
  icon: '🔬',
};

export const STOCK_DATA_AGENT: AgentSummary = {
  id: 'stock-data',
  name: 'Stock Data Agent',
  icon: '📊',
};

export const LIQUIDITY_AGENT: AgentSummary = {
  id: 'liquidity-filter',
  name: 'Liquidity Filter Agent',
  icon: '💧',
};

export const SCREEN_HIT_AGENT: AgentSummary = {
  id: 'screen-hit',
  name: 'Screen Hit Agent',
  icon: '🎯',
};

export const FINAL_SELECT_AGENT: AgentSummary = {
  id: 'final-select',
  name: 'Final Select Agent',
  icon: '📋',
};

export const NEWS_SCRAPE_AGENT: AgentSummary = {
  id: 'news-scrape',
  name: 'News Scrape Agent',
  icon: '📰',
};

export const NEWS_SUMMARY_AGENT: AgentSummary = {
  id: 'news-summary',
  name: 'News Summary Agent',
  icon: '📝',
};

export const TECHNICAL_ANALYSIS_AGENT: AgentSummary = {
  id: 'technical-analysis',
  name: 'Technical Analysis Agent',
  icon: '📈',
};

export const RISK_ASSESSMENT_AGENT: AgentSummary = {
  id: 'risk-assessment',
  name: 'Risk Assessment Agent',
  icon: '⚠️',
};

export const STOCK_DECISION_AGENT: AgentSummary = {
  id: 'stock-decision',
  name: 'Investment Decision Agent',
  icon: '🎯',
};

export const INITIAL_ASSISTANT_GREETING =
  'Hello! I\'m the Orchestrator Agent. Ask for weather, search, webpage summary, cosmetic ingredient safety check, ingredient scraping from a product URL, stock financial analysis, news scraping, news summary, **full investment analysis** (e.g. "Should I buy AMD?"), or general help and I\'ll route the request to the best tool.';

export function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMessage(params: {
  role: ChatRole;
  content: string;
  agent?: AgentSummary;
  status?: ChatMessage['status'];
}): ChatMessage {
  return {
    id: createId(params.role),
    role: params.role,
    content: params.content,
    timestamp: new Date().toISOString(),
    agent: params.agent,
    status: params.status ?? (params.role === 'assistant' ? 'done' : undefined),
  };
}

export function chunkText(text: string, size = 32) {
  if (!text) {
    return [''];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks;
}

export function createInitialMessages() {
  return [
    createMessage({
      role: 'assistant',
      content: INITIAL_ASSISTANT_GREETING,
      agent: ORCHESTRATOR_AGENT,
    }),
  ];
}
