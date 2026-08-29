import {
  WEATHER_AGENT,
  type AgentSummary,
  type UserPreferences,
  type WeatherContext,
} from '@/lib/agent-chat';
import { withTimeoutSignal } from '@/lib/cancellation';

export type ToolExecutionContext = {
  input: string;
  preferences: UserPreferences;
  signal?: AbortSignal;
  /** LLM-extracted location override (skips regex extraction when provided) */
  extractedLocation?: string;
  /** LLM-extracted timeframe override */
  extractedTimeframe?: 'current' | 'tomorrow';
};

export interface ToolExecutionResult {
  agent: AgentSummary;
  markdown: string;
  summary: string;
  metadata: Record<string, unknown>;
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

export async function runWeatherAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { preferences, extractedLocation, extractedTimeframe } = context;
  const location = extractedLocation || preferences.preferredWeatherLocation || 'San Francisco';
  const timeframe = extractedTimeframe || 'current';
  const apiKey = process.env.WEATHER_API_KEY;

  if (!apiKey) {
    throw new Error('Missing WEATHER_API_KEY on the server.');
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

  const timeoutSignal = withTimeoutSignal(context.signal, 15_000);
  let response: Response;
  let data: WeatherApiResponse;
  try {
    response = await fetch(weatherUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: timeoutSignal.signal,
    });
    data = (await response.json()) as WeatherApiResponse;
  } finally {
    timeoutSignal.cleanup();
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Could not find weather data for "${location}".`);
    }

    throw new Error(`WeatherAPI request failed with status ${response.status}.`);
  }

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
        location: resolvedLocation,
        timeframe,
        condition: tomorrowForecast?.day?.condition?.text,
        averageTemperatureF: tomorrowForecast?.day?.avgtemp_f,
        averageTemperatureC: tomorrowForecast?.day?.avgtemp_c,
        maxTemperatureF: tomorrowForecast?.day?.maxtemp_f,
        maxTemperatureC: tomorrowForecast?.day?.maxtemp_c,
        minTemperatureF: tomorrowForecast?.day?.mintemp_f,
        minTemperatureC: tomorrowForecast?.day?.mintemp_c,
        chanceOfRain: tomorrowForecast?.day?.daily_chance_of_rain,
        localTime,
        lastUpdated,
        forecastDate: tomorrowForecast?.date,
      },
    };
  }

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
    },
  };
}
