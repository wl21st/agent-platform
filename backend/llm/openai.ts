import OpenAI from 'openai';

import {
  ORCHESTRATOR_AGENT,
  type ConversationTurn,
  type UserPreferences,
} from '@/lib/agent-chat';
import type { ToolExecutionResult } from '@backend/agents/toolAgents';

let openAIClient: OpenAI | null | undefined;

function getOpenAIClient() {
  if (openAIClient !== undefined) {
    return openAIClient;
  }

  openAIClient = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

  return openAIClient;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Intent Classification — LLM-first architecture
 * ────────────────────────────────────────────────────────────────────────── */

export interface IntentClassification {
  /** Which tool should be invoked (or 'none' for direct LLM response) */
  tool: 'weather' | 'search' | 'webpage-summarize' | 'cosmetic-safe-check' | 'ingredients-scrape' | 'none';
  /** Extracted city / location (weather queries only) */
  location?: string;
  /** current day or tomorrow (weather queries only) */
  timeframe?: 'current' | 'tomorrow';
  /** Search query text (search queries only) */
  searchQuery?: string;
  /** Extracted URL (webpage-summarize / ingredients-scrape queries) */
  url?: string;
  /** Whether this message is a follow-up to the previous conversation */
  isFollowUp: boolean;
}

function buildIntentSystemPrompt(preferences: UserPreferences): string {
  const lines: string[] = [
    'You are an intent classifier for a multi-agent assistant.',
    'Analyze the user message AND the conversation history to determine what to do.',
    '',
    'Available tools:',
    '  weather            — For weather-related queries. Extract the city/location and timeframe.',
    '  search             — For web search / information lookup. Extract the search query.',
    '  webpage-summarize  — For summarizing a specific webpage/URL. Extract the URL.',
    '  cosmetic-safe-check — For analyzing cosmetic/skincare product ingredients for safety risks.',
    '                        Trigger when the user provides a list of cosmetic ingredients or asks about',
    '                        ingredient safety, product safety, or skincare ingredient analysis.',
    '  ingredients-scrape  — For scraping/extracting product ingredients from a URL and running a safety check.',
    '                        Trigger when the user asks to scrape, extract, or get ingredients from a product',
    '                        URL/webpage, or wants to check a cosmetic product page for ingredient safety.',
    '                        Extract the URL into the "url" field.',
    '  none               — For follow-up questions, conversational messages, temperature conversions,',
    '                        greetings, or anything that can be answered from context.',
    '',
    'Rules:',
    '- If the user asks to CONVERT temperatures or references previously-discussed data,',
    '  set tool to "none" and isFollowUp to true.',
    '- If the user asks about weather for a specific place, set tool to "weather".',
    '  Extract the location (city name only, NO time words like "tomorrow").',
    '  Set timeframe to "tomorrow" only if the user explicitly asks about tomorrow.',
    '- If the user asks to search or find information, set tool to "search".',
    '- If the user provides a URL and asks to summarize, read, or extract content from it,',
    '  set tool to "webpage-summarize" and extract the full URL into the "url" field.',
    '  This includes messages like "summarize https://...", "what does this page say: https://..."',
    '  or simply pasting a URL.',
    '- If the user provides a URL and asks to scrape/extract/get ingredients or check a product,',
    '  set tool to "ingredients-scrape" and extract the full URL into the "url" field.',
    '  This includes messages like "scrape ingredients from https://...", "check this product: https://..."',
    '  or "what ingredients are in https://...".',
    '- For greetings, general chat, or follow-up questions, set tool to "none".',
    '',
    'You MUST respond ONLY with a valid JSON object, nothing else. Example:',
    '{"tool":"ingredients-scrape","url":"https://example.com/product","location":"","timeframe":"","searchQuery":"","isFollowUp":false}',
  ];

  if (preferences.preferredWeatherLocation) {
    lines.push('', `User's preferred weather location: ${preferences.preferredWeatherLocation}`);
  }

  if (preferences.lastWeatherResult) {
    const w = preferences.lastWeatherResult;
    lines.push('', `Last weather lookup: ${w.location} (${w.timeframe})`);
  }

  return lines.join('\n');
}

/**
 * Build multi-turn input messages for the Responses API.
 * Uses only system + user roles (no assistant role in input)
 * to avoid potential API compatibility issues.
 */
function buildMultiTurnInput(params: {
  systemPrompt: string;
  history: ConversationTurn[];
  currentInput: string;
  currentUserSuffix?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any[] = [];

  // System message
  input.push({
    role: 'system',
    content: [{ type: 'input_text', text: params.systemPrompt }],
  });

  // Conversation history — pack previous turns into the system context
  // to avoid issues with assistant role in Responses API input
  const allTurns = params.history;
  const previousTurns =
    allTurns.length > 0 &&
    allTurns[allTurns.length - 1].role === 'user' &&
    allTurns[allTurns.length - 1].content === params.currentInput
      ? allTurns.slice(0, -1)
      : allTurns;

  const recentTurns = previousTurns.slice(-14);
  if (recentTurns.length > 0) {
    const historyText = recentTurns
      .map((t) => `[${t.role}]: ${t.content}`)
      .join('\n\n');

    input.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Here is the recent conversation history:\n\n${historyText}\n\n---\nPlease use this context for my next message.`,
        },
      ],
    });

    input.push({
      role: 'assistant',
      content: 'I understand the conversation context. Please go ahead with your message.',
    });
  }

  // Current user message
  const messageText = params.currentUserSuffix
    ? `${params.currentInput}\n\n${params.currentUserSuffix}`
    : params.currentInput;

  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: messageText }],
  });

  return input;
}

/**
 * LLM Intent Parser — calls the LLM to classify the user's intent.
 * Returns `null` when the LLM is unavailable (no API key or API error);
 * the caller should fall back to keyword-based routing.
 */
export async function classifyUserIntent(params: {
  input: string;
  history: ConversationTurn[];
  preferences: UserPreferences;
}): Promise<IntentClassification | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  try {
    const input = buildMultiTurnInput({
      systemPrompt: buildIntentSystemPrompt(params.preferences),
      history: params.history,
      currentInput: params.input,
    });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input,
    });

    // Parse the JSON response (the system prompt instructs JSON-only output)
    const text = response.output_text.trim();
    // Handle possible markdown code fences around JSON
    const jsonText = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(jsonText) as IntentClassification;

    // Validate
    if (!['weather', 'search', 'webpage-summarize', 'cosmetic-safe-check', 'ingredients-scrape', 'none'].includes(parsed.tool)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[classifyUserIntent] LLM intent classification failed:', error);
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Response Generation — LLM generates the final user-facing answer
 * ────────────────────────────────────────────────────────────────────────── */

function buildResponseSystemPrompt(preferences: UserPreferences): string {
  const lines: string[] = [
    'You are a helpful orchestration assistant. You help users with weather, search, webpage summarization, ingredient scraping, cosmetic safety checks, and general questions.',
    '',
    'Rules for conversation continuity:',
    '- ALWAYS use the full conversation history to understand context.',
    '- When the user asks a follow-up question, answer it based on what was previously discussed.',
    '- Do NOT repeat entire previous responses. Only answer the specific follow-up.',
    '- For example, if you previously showed weather in Fahrenheit and the user asks to convert to Celsius, just provide the Celsius conversion — do NOT repeat the full weather report.',
    '- If the user refers to something mentioned earlier (like "that temperature", "convert it", "what about tomorrow"), look back in the conversation to find what they are referring to.',
    '- Respond in the same language the user is using.',
    '- Use markdown formatting for clear responses.',
    '- Be concise and direct.',
    '',
    'Rules for webpage summarization responses:',
    '- When presenting a webpage summary, ALWAYS use the following structured markdown format:',
    '  1. Start with a heading: "# Page Summary: <title>"',
    '  2. Show the source URL',
    '  3. A brief one-sentence overview paragraph',
    '  4. "## 🔑 Key Points" section with 3-7 bullet points highlighting the most important information',
    '  5. "## 📋 Details" section with a more detailed breakdown if the content warrants it',
    '  6. "## 💡 Overall Takeaway" section with a concise 1-2 sentence conclusion',
    '- Bold important terms and use clear, scannable formatting',
    '- If the page content is minimal or empty, note this to the user',
    '',
    'Rules for cosmetic ingredient safety responses:',
    '- When presenting a cosmetic ingredient analysis, present the tool result markdown as-is.',
    '- You may add a brief conversational intro and any additional context about specific ingredients.',
    '- Emphasize high-risk ingredients and explain why they should be avoided.',
    '- If the user asks follow-up questions about specific ingredients, answer from context.',
    '',
    'Rules for ingredient scraping responses:',
    '- When presenting ingredient scrape results, present the combined report (extracted ingredients + safety analysis) as-is.',
    '- You may add a brief conversational intro explaining what was found.',
    '- Highlight any high-risk ingredients and recommend safer alternatives when relevant.',
    '- If no ingredients were found, suggest the user try a different URL or provide ingredients manually.',
  ];

  if (preferences.preferredWeatherLocation) {
    lines.push('', `User preference — preferred weather location: ${preferences.preferredWeatherLocation}`);
  }

  if (preferences.lastWeatherResult) {
    const w = preferences.lastWeatherResult;
    lines.push('', 'Stored weather context from the most recent weather lookup:');
    lines.push(`  Location: ${w.location}, Timeframe: ${w.timeframe}`);
    if (w.condition) lines.push(`  Condition: ${w.condition}`);
    if (w.temperatureF != null && w.temperatureC != null)
      lines.push(`  Temperature: ${w.temperatureF}°F (${w.temperatureC}°C)`);
    if (w.feelsLikeF != null && w.feelsLikeC != null)
      lines.push(`  Feels like: ${w.feelsLikeF}°F (${w.feelsLikeC}°C)`);
    if (w.averageTemperatureF != null && w.averageTemperatureC != null)
      lines.push(`  Average: ${w.averageTemperatureF}°F (${w.averageTemperatureC}°C)`);
    if (w.maxTemperatureF != null && w.maxTemperatureC != null)
      lines.push(`  High: ${w.maxTemperatureF}°F (${w.maxTemperatureC}°C)`);
    if (w.minTemperatureF != null && w.minTemperatureC != null)
      lines.push(`  Low: ${w.minTemperatureF}°F (${w.minTemperatureC}°C)`);
    if (w.humidity != null) lines.push(`  Humidity: ${w.humidity}%`);
    if (w.windSpeedKph != null) lines.push(`  Wind: ${w.windSpeedKph} kph`);
    if (w.chanceOfRain != null) lines.push(`  Chance of rain: ${w.chanceOfRain}%`);
  }

  return lines.join('\n');
}

/**
 * Detect temperature conversion request and generate a response from stored
 * weather data. Works as a fallback when OpenAI is not available.
 */
function tryTemperatureConversion(input: string, preferences: UserPreferences): string | null {
  const w = preferences.lastWeatherResult;
  if (!w) return null;

  const lower = input.trim().toLowerCase();
  let toCelsius = false;
  let toFahrenheit = false;

  if (/摄氏/.test(input) || /celsius/i.test(lower) || /centigrade/i.test(lower)) toCelsius = true;
  else if (/华氏/.test(input) || /fahrenheit/i.test(lower)) toFahrenheit = true;
  if (!toCelsius && !toFahrenheit) return null;

  const fmt = (v: number | undefined, unit: string) =>
    v != null ? `${Math.round(v * 10) / 10}°${unit}` : null;

  const useChinese = /[\u4e00-\u9fff]/.test(input);

  if (w.timeframe === 'tomorrow') {
    if (toCelsius) {
      const avg = fmt(w.averageTemperatureC, 'C');
      const high = fmt(w.maxTemperatureC, 'C');
      const low = fmt(w.minTemperatureC, 'C');
      if (!avg && !high && !low) return null;
      return [
        useChinese
          ? `基于之前 **${w.location}** 明天的天气数据，转换为摄氏度：`
          : `Based on the previous forecast for **${w.location}** tomorrow, converted to Celsius:`,
        avg ? `- ${useChinese ? '平均温度' : 'Average'}: ${avg}` : null,
        high && low ? `- ${useChinese ? '最高 / 最低' : 'High / Low'}: ${high} / ${low}` : null,
      ].filter(Boolean).join('\n');
    }
    const avg = fmt(w.averageTemperatureF, 'F');
    const high = fmt(w.maxTemperatureF, 'F');
    const low = fmt(w.minTemperatureF, 'F');
    if (!avg && !high && !low) return null;
    return [
      useChinese
        ? `基于之前 **${w.location}** 明天的天气数据，转换为华氏度：`
        : `Based on the previous forecast for **${w.location}** tomorrow, converted to Fahrenheit:`,
      avg ? `- ${useChinese ? '平均温度' : 'Average'}: ${avg}` : null,
      high && low ? `- ${useChinese ? '最高 / 最低' : 'High / Low'}: ${high} / ${low}` : null,
    ].filter(Boolean).join('\n');
  }

  if (toCelsius) {
    const temp = fmt(w.temperatureC, 'C');
    const feels = fmt(w.feelsLikeC, 'C');
    if (!temp && !feels) return null;
    return [
      useChinese
        ? `基于之前 **${w.location}** 的天气数据，转换为摄氏度：`
        : `Based on the previous weather data for **${w.location}**, converted to Celsius:`,
      temp ? `- ${useChinese ? '当前温度' : 'Temperature'}: ${temp}` : null,
      feels ? `- ${useChinese ? '体感温度' : 'Feels like'}: ${feels}` : null,
    ].filter(Boolean).join('\n');
  }

  const temp = fmt(w.temperatureF, 'F');
  const feels = fmt(w.feelsLikeF, 'F');
  if (!temp && !feels) return null;
  return [
    useChinese
      ? `基于之前 **${w.location}** 的天气数据，转换为华氏度：`
      : `Based on the previous weather data for **${w.location}**, converted to Fahrenheit:`,
    temp ? `- ${useChinese ? '当前温度' : 'Temperature'}: ${temp}` : null,
    feels ? `- ${useChinese ? '体感温度' : 'Feels like'}: ${feels}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Fallback response when the LLM is unavailable.
 */
function buildFallbackResponse(params: {
  input: string;
  toolResult: ToolExecutionResult | null;
  preferences: UserPreferences;
  history: ConversationTurn[];
}) {
  if (params.toolResult) {
    return [`# ${params.toolResult.agent.name}`, '', params.toolResult.markdown].join('\n');
  }

  const conversionResult = tryTemperatureConversion(params.input, params.preferences);
  if (conversionResult) return conversionResult;

  if (params.preferences.lastWeatherResult) {
    const w = params.preferences.lastWeatherResult;
    return [
      `# ${ORCHESTRATOR_AGENT.name}`,
      '',
      `Based on our conversation about **${w.location}** weather:`,
      '',
      w.temperatureF != null && w.temperatureC != null
        ? `- Temperature: ${w.temperatureF}°F / ${w.temperatureC}°C`
        : null,
      w.feelsLikeF != null && w.feelsLikeC != null
        ? `- Feels like: ${w.feelsLikeF}°F / ${w.feelsLikeC}°C`
        : null,
      w.condition ? `- Condition: ${w.condition}` : null,
      w.humidity != null ? `- Humidity: ${w.humidity}%` : null,
      '',
      `**Your follow-up:** ${params.input}`,
      '',
      `*For more intelligent follow-up responses, configure a valid OPENAI_API_KEY.*`,
    ].filter(Boolean).join('\n');
  }

  return [
    `# ${ORCHESTRATOR_AGENT.name}`,
    '',
    `**Your request:** ${params.input}`,
    '',
    `I can route weather and search requests to specialized tools. For general conversation, please configure an OPENAI_API_KEY.`,
  ].join('\n');
}

/**
 * LLM Response Generator — produces the final user-facing answer using
 * conversation history, tool results, and stored preferences.
 */
export async function generateAssistantResponse(params: {
  input: string;
  toolResult: ToolExecutionResult | null;
  preferences: UserPreferences;
  history: ConversationTurn[];
}) {
  const client = getOpenAIClient();
  if (!client) return buildFallbackResponse(params);

  try {
    let toolSuffix: string | undefined;
    if (params.toolResult) {
      const isWebpageSummary = params.toolResult.agent.id === 'webpage-summarize';
      const isIngredientsScrape = params.toolResult.agent.id === 'ingredients-scrape';
      let presentationInstruction: string;
      if (isWebpageSummary) {
        presentationInstruction = [
          'Summarize this webpage content using the structured markdown format specified in the system prompt.',
          'Include: a brief overview, Key Points (bullet list), Details (if warranted), and an Overall Takeaway.',
          'Use bold for important terms. Be concise yet informative.',
        ].join(' ');
      } else if (isIngredientsScrape) {
        presentationInstruction = [
          'Present this ingredient scraping and safety analysis report to the user.',
          'Keep the extracted ingredients list and safety report as-is.',
          'Add a brief conversational intro explaining what was found.',
          'Highlight any high-risk ingredients and recommend safer alternatives.',
        ].join(' ');
      } else {
        presentationInstruction = 'Present this information naturally to the user. Use markdown formatting.';
      }

      toolSuffix = [
        '---',
        `**Tool result from ${params.toolResult.agent.name}:**`,
        params.toolResult.markdown,
        '---',
        '',
        presentationInstruction,
      ].join('\n');
    }

    const input = buildMultiTurnInput({
      systemPrompt: buildResponseSystemPrompt(params.preferences),
      history: params.history,
      currentInput: params.input,
      currentUserSuffix: toolSuffix,
    });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input,
    });

    return response.output_text || buildFallbackResponse(params);
  } catch (error) {
    console.error('[generateAssistantResponse] LLM response generation failed:', error);
    return buildFallbackResponse(params);
  }
}
