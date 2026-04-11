export type AgentId = 'orchestrator' | 'weather' | 'search';

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

export const INITIAL_ASSISTANT_GREETING =
  'Hello! I\'m the Orchestrator Agent. Ask for weather, search, or general help and I\'ll route the request to the best tool.';

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
