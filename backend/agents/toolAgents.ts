import {
  SEARCH_AGENT,
  WEATHER_AGENT,
  WEBPAGE_SUMMARIZE_AGENT,
  type AgentSummary,
  type UserPreferences,
  type WeatherContext,
} from '@/lib/agent-chat';
import { runWebpageSummarizeAgent } from '@backend/agents/webpageSummarizeAgent';

export type ToolRoute = 'weather' | 'search' | 'webpage-summarize';

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

interface WeatherApiResponse {
  location?: {
    name?: string;
    region?: string;
    country?: string;
    localtime?: string;
  };
  current?: {
    temp_c?: number;
    temp_f?: number;
    feelslike_c?: number;
    feelslike_f?: number;
    humidity?: number;
    wind_kph?: number;
    condition?: {
      text?: string;
    };
    last_updated?: string;
  };
  forecast?: {
    forecastday?: Array<{
      date?: string;
      day?: {
        maxtemp_c?: number;
        maxtemp_f?: number;
        mintemp_c?: number;
        mintemp_f?: number;
        avgtemp_c?: number;
        avgtemp_f?: number;
        daily_chance_of_rain?: number;
        condition?: {
          text?: string;
        };
      };
    }>;
  };
}

/**
 * Time-related words that should be stripped from extracted location strings
 * so that "in new york tomorrow" → "new york" rather than "new york tomorrow".
 */
const TIME_WORDS_RE = /\b(today|tonight|tomorrow|yesterday|this\s+week|next\s+week|now|currently|right\s+now)\b/gi;

export function extractLocation(input: string, fallbackLocation?: string) {
  const normalizedInput = input.trim();
  const englishMatch = normalizedInput.match(/\b(?:in|for|at)\b\s+([a-zA-Z\s,]+?)(?:[?.!,]|$)/i);

  if (englishMatch?.[1]?.trim()) {
    const cleaned = englishMatch[1].replace(TIME_WORDS_RE, '').trim();
    if (cleaned) {
      return normalizeLocationQuery(cleaned);
    }
  }

  const chineseMatch = normalizedInput.match(/([\p{Script=Han}A-Za-z\s]+?)(?:的)?(?:天气|气温|温度|天气怎么样|天气如何)/u);

  if (chineseMatch?.[1]?.trim()) {
    const cleaned = chineseMatch[1].replace(/(?:今天|明天|后天|昨天|现在)/g, '').trim();
    if (cleaned) {
      return normalizeLocationQuery(cleaned);
    }
  }

  return normalizeLocationQuery(fallbackLocation || 'San Francisco');
}

function normalizeLocationQuery(location: string) {
  const normalized = location.trim().replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  const canonicalLocations: Record<string, string> = {
    'san francisco': 'San Francisco, California, United States',
    sf: 'San Francisco, California, United States',
    'new york': 'New York, New York, United States',
    nyc: 'New York, New York, United States',
    london: 'London, England, United Kingdom',
    paris: 'Paris, Île-de-France, France',
    shanghai: 'Shanghai, China',
    上海: 'Shanghai, China',
    beijing: 'Beijing, China',
    北京: 'Beijing, China',
  };

  return canonicalLocations[lower] ?? normalized;
}

type WeatherTimeframe = 'current' | 'tomorrow';

function detectWeatherTimeframe(input: string): WeatherTimeframe {
  if (/(tomorrow|明天)/i.test(input)) {
    return 'tomorrow';
  }

  return 'current';
}

function isWeatherFollowUp(input: string) {
  const normalized = input.trim().toLowerCase();

  return [
    /^tomorrow\??$/i,
    /^what about tomorrow\??$/i,
    /^and tomorrow\??$/i,
    /^how about tomorrow\??$/i,
    /^明天呢[？?]?$/,
    /^那明天呢[？?]?$/,
    /^明天怎么样[？?]?$/,
    /^今天呢[？?]?$/,
    /^后天呢[？?]?$/,
    /^那边呢[？?]?$/,
    /^那里呢[？?]?$/,
    /^会下雨吗[？?]?$/,
    /^会冷吗[？?]?$/,
    /^会热吗[？?]?$/,
    /^湿度呢[？?]?$/,
    /^风大吗[？?]?$/,
    /^那现在呢[？?]?$/,
    /^what about that\??$/i,
    /^what about it\??$/i,
    /^will it rain\??$/i,
    /^how humid is it\??$/i,
    /^how windy is it\??$/i,
  ].some((pattern) => pattern.test(normalized));
}

export function extractSearchTopic(input: string) {
  const cleaned = input
    .replace(/^(search|find|look up|research|what is|what are)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  return cleaned || 'latest AI developments';
}

export async function runWeatherAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input, preferences, extractedLocation, extractedTimeframe } = context;
  const location = extractedLocation || extractLocation(input, preferences.preferredWeatherLocation);
  const timeframe = extractedTimeframe || detectWeatherTimeframe(input);
  const apiKey = process.env.WEATHERAPI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing WEATHERAPI_API_KEY on the server.');
  }

  const weatherUrl = new URL(
    timeframe === 'tomorrow'
      ? 'https://api.weatherapi.com/v1/forecast.json'
      : 'https://api.weatherapi.com/v1/current.json'
  );
  weatherUrl.searchParams.set('key', apiKey);
  weatherUrl.searchParams.set('q', location);
  if (timeframe === 'tomorrow') {
    weatherUrl.searchParams.set('days', '2');
  }

  const response = await fetch(weatherUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Could not find weather data for "${location}".`);
    }

    throw new Error(`WeatherAPI request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as WeatherApiResponse;
  const condition = data.current?.condition?.text || 'Unknown';
  const temperature = data.current?.temp_f;
  const temperatureC = data.current?.temp_c;
  const feelsLike = data.current?.feelslike_f;
  const feelsLikeC = data.current?.feelslike_c;
  const humidity = data.current?.humidity;
  const windSpeed = data.current?.wind_kph;
  const resolvedLocation = [data.location?.name, data.location?.region, data.location?.country]
    .filter(Boolean)
    .join(', ') || location;
  const localTime = data.location?.localtime;
  const lastUpdated = data.current?.last_updated;
  const tomorrowForecast = data.forecast?.forecastday?.[1];

  if (timeframe === 'tomorrow') {
    const weatherContext: WeatherContext = {
      location: resolvedLocation,
      timeframe,
      condition: tomorrowForecast?.day?.condition?.text || 'Unknown',
      averageTemperatureF: tomorrowForecast?.day?.avgtemp_f,
      averageTemperatureC: tomorrowForecast?.day?.avgtemp_c,
      maxTemperatureF: tomorrowForecast?.day?.maxtemp_f,
      maxTemperatureC: tomorrowForecast?.day?.maxtemp_c,
      minTemperatureF: tomorrowForecast?.day?.mintemp_f,
      minTemperatureC: tomorrowForecast?.day?.mintemp_c,
      chanceOfRain: tomorrowForecast?.day?.daily_chance_of_rain,
      localTime,
      lastUpdated,
    };

    return {
      agent: WEATHER_AGENT,
      summary: `Tomorrow's weather for ${resolvedLocation}: ${tomorrowForecast?.day?.condition?.text || 'Unknown'}, ${tomorrowForecast?.day?.avgtemp_f ?? 'N/A'}°F average.`,
      markdown: [
        `# Weather Report`,
        '',
        `**Location:** ${resolvedLocation}`,
        `**Forecast:** Tomorrow`,
        `**Conditions:** ${tomorrowForecast?.day?.condition?.text || 'Unknown'}`,
        `**Average Temperature:** ${tomorrowForecast?.day?.avgtemp_f ?? 'N/A'}°F`,
        `**High / Low:** ${tomorrowForecast?.day?.maxtemp_f ?? 'N/A'}°F / ${tomorrowForecast?.day?.mintemp_f ?? 'N/A'}°F`,
        `**Chance of Rain:** ${tomorrowForecast?.day?.daily_chance_of_rain ?? 'N/A'}%`,
        `**Local Time:** ${localTime ?? 'N/A'}`,
        `**Last Updated:** ${lastUpdated ?? 'N/A'}`,
        '',
        '*Live data provided by WeatherAPI*',
      ].join('\n'),
      metadata: {
        ...weatherContext,
        forecastDate: tomorrowForecast?.date,
      },
    };
  }

  const weatherContext: WeatherContext = {
    location: resolvedLocation,
    timeframe,
    condition,
    temperatureF: temperature,
    temperatureC,
    feelsLikeF: feelsLike,
    feelsLikeC,
    humidity,
    windSpeedKph: windSpeed,
    localTime,
    lastUpdated,
  };

  return {
    agent: WEATHER_AGENT,
    summary: `Weather for ${resolvedLocation}: ${condition}, ${temperature ?? 'N/A'}°F.`,
    markdown: [
      `# Weather Report`,
      '',
      `**Location:** ${resolvedLocation}`,
      `**Current Conditions:** ${condition}`,
      `**Temperature:** ${temperature ?? 'N/A'}°F`,
      `**Feels Like:** ${feelsLike ?? 'N/A'}°F`,
      `**Humidity:** ${humidity ?? 'N/A'}%`,
      `**Wind Speed:** ${windSpeed ?? 'N/A'} kph`,
      `**Local Time:** ${localTime ?? 'N/A'}`,
      `**Last Updated:** ${lastUpdated ?? 'N/A'}`,
      '',
      '*Live data provided by WeatherAPI*',
    ].join('\n'),
    metadata: {
      ...weatherContext,
    },
  };
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

  if (
    context.preferences.lastUsedAgent === WEATHER_AGENT.name &&
    context.preferences.preferredWeatherLocation &&
    isWeatherFollowUp(context.input)
  ) {
    return 'weather';
  }

  return 'none';
}

export function getToolDefinition(route: ToolRoute) {
  return TOOL_REGISTRY[route];
}
