import OpenAI from 'openai';

import {
  ORCHESTRATOR_AGENT,
  type ConversationTurn,
  type UserPreferences,
} from '@/lib/agent-chat';
import type { DecisionData, FinancialData, NewsData, NormalizedScores, RiskAssessmentData, TechnicalData } from '@/lib/stockAnalysisInterfaces';
import type { ToolExecutionResult } from '@backend/agents/toolAgents';

const DEFAULT_LLM_BASE_MODEL = 'openai/gpt-4.1-mini';
const DEFAULT_LLM_API_URL = 'https://openrouter.ai/api/v1';

let openAiClient: OpenAI | null | undefined;

function getLlmBaseModel() {
  return process.env.LLM_BASE_MODEL || DEFAULT_LLM_BASE_MODEL;
}

function getLlmApiUrl(): string {
  return process.env.LLM_API_BASE_URL || process.env.LLM_API_URL || DEFAULT_LLM_API_URL;
}

function getOpenAiClient() {
  if (openAiClient !== undefined) {
    return openAiClient;
  }

  openAiClient = process.env.LLM_API_KEY
    ? new OpenAI({
        apiKey: process.env.LLM_API_KEY,
        baseURL: getLlmApiUrl(),
        defaultHeaders: {
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'Agents Platform',
        },
    })
    : null;

  return openAiClient;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Intent Classification — LLM-first architecture
 * ────────────────────────────────────────────────────────────────────────── */

export type IntentTool =
  | 'weather'
  | 'search'
  | 'webpage-summarize'
  | 'cosmetic-safe-check'
  | 'ingredients-scrape'
  | 'stock-data'
  | 'news-scrape'
  | 'news-summary'
  | 'stock-analysis'
  | 'liquidity-filter'
  | 'screen-hit'
  | 'final-select'
  | 'none';

const VALID_INTENT_TOOLS: IntentTool[] = [
  'weather',
  'search',
  'webpage-summarize',
  'cosmetic-safe-check',
  'ingredients-scrape',
  'stock-data',
  'news-scrape',
  'news-summary',
  'stock-analysis',
  'liquidity-filter',
  'screen-hit',
  'final-select',
  'none',
];

/**
 * A single, atomic intent. Used both as the top-level primary intent
 * AND as each entry in the `intents` array for parallel multi-intent queries.
 */
export interface SingleIntent {
  /** Which tool should be invoked (or 'none' for direct LLM response) */
  tool: IntentTool;
  /** Extracted city / location (weather queries only) */
  location?: string;
  /** current day or tomorrow (weather queries only) */
  timeframe?: 'current' | 'tomorrow';
  /** Search query text (search queries only) */
  searchQuery?: string;
  /** Extracted URL (webpage-summarize / ingredients-scrape queries) */
  url?: string;
  /** Extracted stock ticker symbol (stock-data queries only) */
  ticker?: string;
  /** Extracted news URLs (news-summary queries) */
  newsUrls?: Array<{url: string, title: string}>;
}

export interface IntentClassification extends SingleIntent {
  /**
   * When the user asks for multiple INDEPENDENT things in one query
   * (e.g. "summarize https://... AND what's the weather in Tokyo"),
   * the LLM returns each intent here for parallel execution.
   *
   * When present and containing 2+ entries, the orchestrator runs all
   * tools concurrently via Promise.all() and merges the results.
   *
   * When absent / length < 2, the top-level `tool` is used (single-intent).
   */
  intents?: SingleIntent[];
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
    '  stock-data          — For stock financial analysis. Trigger when the user asks about a stock\'s financials,',
    '                        financial statements (income statement, balance sheet, cash flow), stock analysis,',
    '                        earnings, revenue, profit margins, or mentions a ticker symbol (e.g. AAPL, $MSFT, 600519).',
    '                        Extract the ticker symbol into the "ticker" field.',
    '  news-scrape         — For searching and scraping recent news articles about a stock. Trigger when the user',
    '                        asks for news, articles, headlines, or recent developments about a specific stock.',
    '                        Extract the ticker symbol into the "ticker" field.',
    '  news-summary        — For summarizing multiple news articles and analyzing overall sentiment. Trigger when',
    '                        the user asks to summarize news, analyze sentiment, or wants an overall news assessment.',
    '                        Extract news URLs into the "newsUrls" field if provided.',
    '  stock-analysis      — For a FULL investment analysis of a stock that combines fundamentals, news sentiment,',
    '                        technical analysis, risk assessment, and a final buy/hold/sell recommendation.',
    '                        Trigger when the user asks whether to buy/sell a stock, wants an investment decision,',
    '                        asks "should I buy X?", "can I buy X now?", "is X a good investment?",',
    '                        or requests a comprehensive stock analysis with a recommendation.',
    '                        Extract the ticker symbol into the "ticker" field.',
    '  final-select        — For scanning today\'s US stock market and selecting the top stock ideas.',
    '                        Trigger when the user asks to scan today\'s US stocks, scan the US market,',
    '                        scan S&P 500, scan Nasdaq / Nasdaq 100, scan for US stock opportunities,',
    '                        or asks in Chinese like "扫描今天的美股", "扫描标普500", "扫描纳斯达克",',
    '                        "扫描纳斯达克100", "挑选纳斯达克股票，给我前10个".',
    '                        The orchestrator will coordinate Liquidity Filter Agent, Screen Hit Agent,',
    '                        and Final Select Agent sequentially.',
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
    '- If the user asks about stock financials, financial statements, earnings, revenue, profit margins,',
    '  or mentions a ticker symbol (like $AAPL, MSFT, GOOGL, 600519, 0700.HK), set tool to "stock-data".',
    '  Extract the ticker symbol into the "ticker" field. Do NOT include the $ sign.',
    '- If the user asks whether to BUY or SELL a stock, wants an investment recommendation, asks',
    '  "should I buy X?", "can I buy X now?", "is now a good time to buy X?", "is X a good buy?",',
    '  set tool to "stock-analysis". Extract the ticker into the "ticker" field.',
    '- If the user asks to scan/select top US stocks / US market / S&P 500 / Nasdaq / Nasdaq 100, set tool to "final-select".',
    '  Chinese examples: "挑选纳斯达克股票，给我前10个", "挑选纳斯达克100股票，给我前10个".',
    '  This is a single multi-step workflow, so do NOT split it into parallel intents.',
    '- For greetings, general chat, or follow-up questions, set tool to "none".',
    '',
    'PARALLEL INTENT DETECTION (IMPORTANT):',
    '- If the user asks for MULTIPLE INDEPENDENT things in one query, return an "intents" array',
    '  with each intent as a separate object (each with its own tool + extracted fields).',
    '  Examples of parallel multi-intent queries:',
    '    • "Summarize https://example.com and tell me the weather in Tokyo"',
    '       → two intents: webpage-summarize + weather',
    '    • "What\'s the weather in Paris and give me AAPL financials?"',
    '       → two intents: weather + stock-data',
    '    • "Get news for TSLA and summarize https://foo.com"',
    '       → two intents: news-scrape + webpage-summarize',
    '- Only use "intents" when the requests are TRULY INDEPENDENT. Do NOT split a single',
    '  multi-step task (e.g. "scrape ingredients from X and check safety" is ONE intent:',
    '  ingredients-scrape, because that tool does both steps internally).',
    '- When the user asks for only one thing, DO NOT include "intents" (or set it to an empty array).',
    '- When returning "intents", also fill the top-level tool/fields with the FIRST intent',
    '  (for backward compatibility).',
    '- Each element of "intents" must have its own tool and its own extracted fields',
    '  (location, url, ticker, etc.) — do NOT leak fields from one intent into another.',
    '',
    'You MUST respond ONLY with a valid JSON object, nothing else.',
    'Single-intent example:',
    '{"tool":"stock-data","ticker":"AAPL","url":"","location":"","timeframe":"","searchQuery":"","isFollowUp":false}',
    'Parallel multi-intent example:',
    '{"tool":"webpage-summarize","url":"https://example.com","intents":[' +
      '{"tool":"webpage-summarize","url":"https://example.com"},' +
      '{"tool":"weather","location":"Tokyo","timeframe":"current"}' +
      '],"isFollowUp":false}',
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
 * Build multi-turn chat messages for OpenAI-compatible API.
 */
function buildMultiTurnMessages(params: {
  systemPrompt: string;
  history: ConversationTurn[];
  currentInput: string;
  currentUserSuffix?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];

  // System message
  messages.push({
    role: 'system',
    content: params.systemPrompt,
  });

  const allTurns = params.history;
  const previousTurns =
    allTurns.length > 0 &&
    allTurns[allTurns.length - 1].role === 'user' &&
    allTurns[allTurns.length - 1].content === params.currentInput
      ? allTurns.slice(0, -1)
      : allTurns;

  const recentTurns = previousTurns.slice(-14);
  for (const turn of recentTurns) {
    messages.push({
      role: turn.role,
      content: turn.agentName ? `[${turn.agentName}] ${turn.content}` : turn.content,
    });
  }

  // Current user message
  const messageText = params.currentUserSuffix
    ? `${params.currentInput}\n\n${params.currentUserSuffix}`
    : params.currentInput;

  messages.push({
    role: 'user',
    content: messageText,
  });

  return messages;
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
  const client = getOpenAiClient();
  if (!client) return null;

  try {
    const messages = buildMultiTurnMessages({
      systemPrompt: buildIntentSystemPrompt(params.preferences),
      history: params.history,
      currentInput: params.input,
    });

    const response = await client.chat.completions.create({
      model: getLlmBaseModel(),
      messages,
    });

    // Parse the JSON response (the system prompt instructs JSON-only output)
    const text = response.choices[0]?.message?.content?.trim() || '';
    // Handle possible markdown code fences around JSON
    const jsonText = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(jsonText) as IntentClassification;

    // Validate top-level tool
    if (!VALID_INTENT_TOOLS.includes(parsed.tool)) {
      return null;
    }

    // Validate & sanitize each parallel intent, if present
    if (Array.isArray(parsed.intents)) {
      const clean = parsed.intents.filter(
        (i): i is SingleIntent => !!i && typeof i === 'object' && VALID_INTENT_TOOLS.includes(i.tool),
      );

      // Drop 'none' entries — they add no work to a parallel batch
      const actionable = clean.filter((i) => i.tool !== 'none');

      // Only keep the intents array when there are 2+ actionable parallel intents.
      // Otherwise, fall back to the single-intent (top-level) shape.
      parsed.intents = actionable.length >= 2 ? actionable : undefined;
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
    'You are a helpful orchestration assistant. You help users with weather, search, webpage summarization, ingredient scraping, cosmetic safety checks, stock financial analysis, and general questions.',
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
    '',
    'Rules for stock financial analysis responses:',
    '- When presenting stock financial data, present the tool result markdown (financial statements, ratios, analysis) as-is.',
    '- You may add a brief conversational intro explaining the company and its financial overview.',
    '- Provide a summary covering: core business logic, valuation assessment, key risk factors, and investment recommendation.',
    '- Highlight any red flags (e.g. declining margins, high leverage, negative cash flow).',
    '- Compare key metrics against industry benchmarks when possible.',
    '- Always include a disclaimer that this is not investment advice.',
    '- If the user asks follow-up about specific financial metrics, answer from the provided context.',
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
 * weather data. Works as a fallback when the LLM is not available.
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
      `*For more intelligent follow-up responses, configure LLM_API_KEY.*`,
    ].filter(Boolean).join('\n');
  }

  return [
    `# ${ORCHESTRATOR_AGENT.name}`,
    '',
    `**Your request:** ${params.input}`,
    '',
    `I can route weather and search requests to specialized tools. For general conversation, configure LLM_API_KEY.`,
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
  const client = getOpenAiClient();
  if (!client) return buildFallbackResponse(params);

  try {
    let toolSuffix: string | undefined;
    if (params.toolResult) {
      const isWebpageSummary = params.toolResult.agent.id === 'webpage-summarize';
      const isIngredientsScrape = params.toolResult.agent.id === 'ingredients-scrape';
      const isStockData = params.toolResult.agent.id === 'stock-data';
      let presentationInstruction: string;
      if (isStockData) {
        presentationInstruction = [
          'Present this stock financial analysis report to the user.',
          'Keep the financial data tables and analysis as-is.',
          'Add a brief conversational intro about the company.',
          'Provide a comprehensive summary covering: core business logic, valuation, key risk points, and investment recommendation.',
          'Always include a disclaimer that this is not investment advice.',
        ].join(' ');
      } else if (isWebpageSummary) {
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

    const messages = buildMultiTurnMessages({
      systemPrompt: buildResponseSystemPrompt(params.preferences),
      history: params.history,
      currentInput: params.input,
      currentUserSuffix: toolSuffix,
    });

    const response = await client.chat.completions.create({
      model: getLlmBaseModel(),
      messages,
    });

    return response.choices[0]?.message?.content || buildFallbackResponse(params);
  } catch (error) {
    console.error('[generateAssistantResponse] LLM response generation failed:', error);
    return buildFallbackResponse(params);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Parallel Response Generator — merges multiple tool results into a single
 * cohesive answer for multi-intent queries executed concurrently.
 * ────────────────────────────────────────────────────────────────────────── */

function buildParallelFallbackResponse(
  toolResults: ToolExecutionResult[],
  errors: Array<{ tool: IntentTool; error: string }>,
): string {
  const sections = toolResults.map(
    (r, idx) => `## ${idx + 1}. **${r.agent.icon} ${r.agent.name}**\n\n${r.markdown}`,
  );

  if (errors.length > 0) {
    sections.push(
      [
        '## ⚠️ Failed Tasks',
        '',
        ...errors.map((e) => `- **${e.tool}**: ${e.error}`),
      ].join('\n'),
    );
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Generate a single combined response that merges results from multiple
 * tools executed in parallel. Uses clear section headings for each topic
 * so the user can scan each result independently.
 */
export async function generateParallelResponse(params: {
  input: string;
  toolResults: ToolExecutionResult[];
  errors?: Array<{ tool: IntentTool; error: string }>;
  preferences: UserPreferences;
  history: ConversationTurn[];
}): Promise<string> {
  const errors = params.errors ?? [];

  if (params.toolResults.length === 0) {
    // Nothing succeeded — surface the errors directly
    return buildParallelFallbackResponse([], errors);
  }

  const client = getOpenAiClient();
  if (!client) {
    return buildParallelFallbackResponse(params.toolResults, errors);
  }

  try {
    const toolsBlock = params.toolResults
      .map((r, idx) =>
        [
          `--- Tool #${idx + 1}: ${r.agent.name} (${r.agent.id}) ---`,
          r.markdown,
        ].join('\n'),
      )
      .join('\n\n');

    const errorsBlock =
      errors.length > 0
        ? [
            '',
            '--- Failed Tools ---',
            ...errors.map((e) => `- ${e.tool}: ${e.error}`),
          ].join('\n')
        : '';

    const suffix = [
      '---',
      'The user asked for MULTIPLE INDEPENDENT things in one query, and several tools',
      'were executed IN PARALLEL. Below are all the tool results.',
      '',
      toolsBlock,
      errorsBlock,
      '---',
      '',
      'CRITICAL FORMATTING REQUIREMENT — READ CAREFULLY:',
      'Combine these results into a SINGLE cohesive response for the user.',
      '',
      'SECTION HEADING FORMAT (MANDATORY):',
      `Use "## N. **Title**" markdown headings for each section, where N is the section number.`,
      `Example for section 1: "## 1. **Summary of CNN Article**"`,
      `Example for section 2: "## 2. **Weather in Tokyo, Japan Today**"`,
      'DO NOT use plain numbered lists (1. text) for the section headings — use ## headings.',
      'This ensures each section number is always visible and never reset by the markdown renderer.',
      '',
      'Other requirements:',
      '- Include a brief summary of the actual answer in the section title itself.',
      '- Keep section titles concise but informative — include key facts from the answer.',
      '- Under each ## heading, use BULLET POINTS (-) for details.',
      '- Preserve important data (temperatures, financial figures, summaries, ingredient lists) as-is.',
      '- Keep the markdown formatting rules from the system prompt (webpage summary structure,',
      '  stock analysis disclaimer, etc.) for each relevant section.',
      '- Briefly note any failed tools at the end so the user knows what did not run.',
      '- Write in the same language the user used.',
      '- Do NOT re-ask clarifying questions — just present the results.',
    ].join('\n');

    const messages = buildMultiTurnMessages({
      systemPrompt: buildResponseSystemPrompt(params.preferences),
      history: params.history,
      currentInput: params.input,
      currentUserSuffix: suffix,
    });

    const response = await client.chat.completions.create({
      model: getLlmBaseModel(),
      messages,
    });

    return (
      response.choices[0]?.message?.content || buildParallelFallbackResponse(params.toolResults, errors)
    );
  } catch (error) {
    console.error('[generateParallelResponse] LLM response generation failed:', error);
    return buildParallelFallbackResponse(params.toolResults, errors);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Risk Assessment — LLM evaluates risk across all three dimensions
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Calls the LLM to produce a structured risk assessment for a stock.
 * Inputs the normalized scores + key financial/technical/news metrics.
 * Returns a full RiskAssessmentData JSON including stop-loss and take-profit targets.
 */
export async function generateRiskAssessment(params: {
  ticker: string;
  currentPrice: number;
  normalizedScores: NormalizedScores;
  financialData: FinancialData;
  technicalData: TechnicalData;
  newsData: NewsData;
}): Promise<RiskAssessmentData> {
  const { ticker, currentPrice, normalizedScores, financialData, technicalData, newsData } = params;
  const client = getOpenAiClient();

  // Fallback if no LLM
  const fallback: RiskAssessmentData = {
    ticker,
    timestamp: new Date().toISOString(),
    riskScores: {
      overallRisk: 100 - normalizedScores.overallScore,
      marketRisk: 100 - normalizedScores.technicalScore,
      financialRisk: 100 - normalizedScores.financialScore,
      operationalRisk: 50,
      liquidityRisk: 100 - (normalizedScores.financialScore * 0.7 + normalizedScores.technicalScore * 0.3),
    },
    riskFactors: [{ factor: 'LLM Unavailable', description: 'Risk assessment generated from scores only.', severity: 'low', impact: 'low' }],
    riskSummary: `Overall score: ${normalizedScores.overallScore.toFixed(0)}/100. Financial: ${normalizedScores.financialScore.toFixed(0)}, News: ${normalizedScores.newsScore.toFixed(0)}, Technical: ${normalizedScores.technicalScore.toFixed(0)}.`,
    stopLossPrice: technicalData.indicators.atr14 != null
      ? parseFloat((currentPrice - 2 * technicalData.indicators.atr14).toFixed(2))
      : parseFloat((currentPrice * 0.93).toFixed(2)),
    takeProfitTargets: [
      { label: 'Target 1 (conservative)', price: parseFloat((currentPrice * 1.10).toFixed(2)) },
      { label: 'Target 2 (moderate)', price: parseFloat((currentPrice * 1.20).toFixed(2)) },
      { label: 'Target 3 (aggressive)', price: parseFloat((currentPrice * 1.35).toFixed(2)) },
    ],
  };

  if (!client) return fallback;

  try {
    const atr = technicalData.indicators.atr14 ?? currentPrice * 0.02;
    const systemPrompt = [
      'You are a professional equity risk analyst. Respond ONLY with a valid JSON object — no markdown, no explanation.',
      '',
      'Analyze the stock and return a RiskAssessmentData JSON with these exact fields:',
      '{',
      '  "ticker": string,',
      '  "timestamp": ISO string,',
      '  "riskScores": {',
      '    "overallRisk": number (0-100, higher = more risky),',
      '    "marketRisk": number (0-100),',
      '    "financialRisk": number (0-100),',
      '    "operationalRisk": number (0-100),',
      '    "liquidityRisk": number (0-100)',
      '  },',
      '  "riskFactors": [{ "factor": string, "description": string, "severity": "low"|"medium"|"high", "impact": "low"|"medium"|"high" }],',
      '  "riskSummary": string (2-3 sentences),',
      '  "stopLossPrice": number (price level; use 2×ATR below current price as a starting point),',
      '  "takeProfitTargets": [',
      '    { "label": "Target 1 (conservative, ~8-12%)", "price": number },',
      '    { "label": "Target 2 (moderate, ~18-25%)", "price": number },',
      '    { "label": "Target 3 (aggressive, ~35-50%)", "price": number }',
      '  ]',
      '}',
    ].join('\n');

    const userMessage = [
      `Ticker: ${ticker}`,
      `Current Price: $${currentPrice.toFixed(2)}`,
      `ATR (14-day): $${atr.toFixed(2)}`,
      '',
      `Normalized Scores: Financial=${normalizedScores.financialScore.toFixed(0)}/100, News=${normalizedScores.newsScore.toFixed(0)}/100, Technical=${normalizedScores.technicalScore.toFixed(0)}/100, Overall=${normalizedScores.overallScore.toFixed(0)}/100`,
      '',
      `Technical Signals: Trend=${technicalData.signals.trend}, Momentum=${technicalData.signals.momentum}, Volatility=${technicalData.signals.volatility}, Volume=${technicalData.signals.volume}, Overall=${technicalData.signals.overall}`,
      `RSI(14)=${technicalData.indicators.rsi14?.toFixed(1) ?? 'N/A'}, MACD=${technicalData.indicators.macd?.toFixed(3) ?? 'N/A'} vs Signal=${technicalData.indicators.macdSignal?.toFixed(3) ?? 'N/A'}`,
      `52W range: $${technicalData.priceData.low52w?.toFixed(2) ?? 'N/A'} – $${technicalData.priceData.high52w?.toFixed(2) ?? 'N/A'}`,
      '',
      `Financial Ratios: GrossMargin=${financialData.ratios.grossMargin != null ? (financialData.ratios.grossMargin * 100).toFixed(1) + '%' : 'N/A'}, NetMargin=${financialData.ratios.netMargin != null ? (financialData.ratios.netMargin * 100).toFixed(1) + '%' : 'N/A'}, D/E=${financialData.ratios.debtToEquity?.toFixed(2) ?? 'N/A'}, CurrentRatio=${financialData.ratios.currentRatio?.toFixed(2) ?? 'N/A'}, RevenueGrowthYoY=${financialData.ratios.revenueGrowthYoY != null ? (financialData.ratios.revenueGrowthYoY * 100).toFixed(1) + '%' : 'N/A'}`,
      '',
      `News Sentiment: ${newsData.overallSentiment?.label ?? 'neutral'} (score=${newsData.overallSentiment?.score?.toFixed(2) ?? '0'}), Articles=${newsData.articles.length}`,
    ].join('\n');

    const response = await client.chat.completions.create({
      model: getLlmBaseModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const text = (response.choices[0]?.message?.content || '').trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(text) as RiskAssessmentData;
    parsed.timestamp = new Date().toISOString();
    parsed.ticker = ticker;
    return parsed;
  } catch (error) {
    console.error('[generateRiskAssessment] LLM call failed:', error);
    return fallback;
  }
}

/**
 * Simple LLM call for text generation
 */
export async function callLLM(params: { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; temperature?: number }): Promise<{ content: string }> {
  const client = getOpenAiClient();
  if (!client) throw new Error('LLM client not available');

  const response = await client.chat.completions.create({
    model: getLlmBaseModel(),
    messages: params.messages,
    temperature: params.temperature || 0.7,
  });

  return { content: response.choices[0]?.message?.content || '' };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Investment Decision — LLM produces buy/hold/sell + entry, stop-loss, targets
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Calls the LLM to produce the final investment decision for a stock.
 * Takes all prior analysis (scores + risk) and outputs a DecisionData JSON.
 */
export async function generateInvestmentDecision(params: {
  ticker: string;
  currentPrice: number;
  normalizedScores: NormalizedScores;
  riskAssessment: RiskAssessmentData;
  financialData: FinancialData;
  technicalData: TechnicalData;
  newsData: NewsData;
}): Promise<DecisionData> {
  const { ticker, currentPrice, normalizedScores, riskAssessment, financialData, technicalData, newsData } = params;
  const client = getOpenAiClient();

  const fallback: DecisionData = {
    ticker,
    timestamp: new Date().toISOString(),
    recommendation: normalizedScores.overallScore >= 60 ? 'buy' : normalizedScores.overallScore >= 40 ? 'hold' : 'sell',
    confidenceScore: Math.abs(normalizedScores.overallScore - 50) + 50,
    entryPrice: currentPrice,
    stopLossPrice: riskAssessment.stopLossPrice,
    takeProfitTargets: riskAssessment.takeProfitTargets,
    timeHorizon: 'medium-term',
    reasoning: `Based on composite score of ${normalizedScores.overallScore.toFixed(0)}/100. Financial: ${normalizedScores.financialScore.toFixed(0)}/100, News: ${normalizedScores.newsScore.toFixed(0)}/100, Technical: ${normalizedScores.technicalScore.toFixed(0)}/100.`,
    keyBullishFactors: [],
    keyBearishFactors: [],
    componentScores: {
      financialScore: normalizedScores.financialScore,
      newsScore: normalizedScores.newsScore,
      technicalScore: normalizedScores.technicalScore,
      overallScore: normalizedScores.overallScore,
    },
    riskAssessment,
  };

  if (!client) return fallback;

  try {
    const systemPrompt = [
      'You are a senior equity analyst. Respond ONLY with a valid JSON object — no markdown, no extra text.',
      '',
      'Produce a DecisionData JSON with these exact fields:',
      '{',
      '  "ticker": string,',
      '  "timestamp": ISO string,',
      '  "recommendation": "buy"|"hold"|"sell",',
      '  "confidenceScore": number (0-100, based on strength/consensus of signals),',
      '  "entryPrice": number (suggested limit order entry price, can equal current price or a slightly lower level),',
      '  "stopLossPrice": number (from risk assessment),',
      '  "takeProfitTargets": [{ "label": string, "price": number }],',
      '  "timeHorizon": "short-term"|"medium-term"|"long-term",',
      '  "reasoning": string (3-5 sentences explaining the recommendation),',
      '  "keyBullishFactors": string[] (top 3 bullish factors),',
      '  "keyBearishFactors": string[] (top 3 risk factors),',
      '  "riskRewardRatio": number (estimated R:R, e.g. 2.5 means risk 1 to gain 2.5)',
      '}',
    ].join('\n');

    const t1 = riskAssessment.takeProfitTargets?.[0]?.price ?? currentPrice * 1.10;
    const sl = riskAssessment.stopLossPrice ?? currentPrice * 0.93;
    const rrRatio = currentPrice > sl ? (t1 - currentPrice) / (currentPrice - sl) : 1;

    const userMessage = [
      `Ticker: ${ticker}`,
      `Current Price: $${currentPrice.toFixed(2)}`,
      '',
      `Composite Score: ${normalizedScores.overallScore.toFixed(0)}/100`,
      `  ├─ Financial Score: ${normalizedScores.financialScore.toFixed(0)}/100`,
      `  ├─ News Score: ${normalizedScores.newsScore.toFixed(0)}/100 (sentiment: ${newsData.overallSentiment?.label ?? 'neutral'})`,
      `  └─ Technical Score: ${normalizedScores.technicalScore.toFixed(0)}/100 (overall signal: ${technicalData.signals.overall})`,
      '',
      `Risk Assessment:`,
      `  Overall Risk: ${riskAssessment.riskScores.overallRisk}/100`,
      `  Stop-Loss: $${riskAssessment.stopLossPrice?.toFixed(2) ?? 'N/A'}`,
      `  Take-Profit targets: ${(riskAssessment.takeProfitTargets ?? []).map(t => `${t.label} @ $${t.price.toFixed(2)}`).join(', ')}`,
      `  Est. R:R Ratio: ${rrRatio.toFixed(2)}`,
      `  Risk Summary: ${riskAssessment.riskSummary}`,
      '',
      `Technical Signals: Trend=${technicalData.signals.trend}, Momentum=${technicalData.signals.momentum}, RSI=${technicalData.indicators.rsi14?.toFixed(1) ?? 'N/A'}`,
      '',
      `Financial Highlights: NetMargin=${financialData.ratios.netMargin != null ? (financialData.ratios.netMargin * 100).toFixed(1) + '%' : 'N/A'}, RevenueGrowthYoY=${financialData.ratios.revenueGrowthYoY != null ? (financialData.ratios.revenueGrowthYoY * 100).toFixed(1) + '%' : 'N/A'}, FreeCashFlow=${financialData.fundamentals.freeCashFlow != null ? (financialData.fundamentals.freeCashFlow > 0 ? 'positive' : 'negative') : 'N/A'}`,
      '',
      `News: ${newsData.articles.length} articles, overall sentiment=${newsData.overallSentiment?.label ?? 'neutral'}`,
    ].join('\n');

    const response = await client.chat.completions.create({
      model: getLlmBaseModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const text = (response.choices[0]?.message?.content || '').trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(text) as DecisionData;
    parsed.timestamp = new Date().toISOString();
    parsed.ticker = ticker;
    parsed.componentScores = {
      financialScore: normalizedScores.financialScore,
      newsScore: normalizedScores.newsScore,
      technicalScore: normalizedScores.technicalScore,
      overallScore: normalizedScores.overallScore,
    };
    parsed.riskAssessment = riskAssessment;
    return parsed;
  } catch (error) {
    console.error('[generateInvestmentDecision] LLM call failed:', error);
    return { ...fallback, riskAssessment };
  }
}
