import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import {
  COSMETIC_SAFE_CHECK_AGENT,
  FINAL_SELECT_AGENT,
  INGREDIENTS_SCRAPE_AGENT,
  LIQUIDITY_AGENT,
  NEWS_SCRAPE_AGENT,
  NEWS_SUMMARY_AGENT,
  ORCHESTRATOR_AGENT,
  RISK_ASSESSMENT_AGENT,
  SCREEN_HIT_AGENT,
  STOCK_DATA_AGENT,
  STOCK_DECISION_AGENT,
  TECHNICAL_ANALYSIS_AGENT,
  chunkText,
  createMessage,
  type ConversationTurn,
  type AgentSummary,
  type StreamEvent,
  type TaskStatus,
  type UserPreferences,
  type WeatherContext,
} from '@/lib/agent-chat';
import type { FinancialData, NewsData, TechnicalData } from '@/lib/stockAnalysisInterfaces';
import { runCosmeticSafeCheckAgent } from '@backend/agents/cosmeticSafeCheckAgent';
import { runInvestmentDecision } from '@backend/agents/decisionAgent';
import { runFinalSelectAgent } from '@backend/agents/finalSelectAgent';
import {
  buildCombinedScrapeAndSafetyResult,
  scrapeIngredientsOnly,
} from '@backend/agents/ingredientsScrapeAgent';
import type { LiquidityResult } from '@backend/agents/liquidity';
import { runLiquidityAgent } from '@backend/agents/liquidityAgent';
import { runNewsScrapeAgent } from '@backend/agents/newsScrapeAgent';
import { runNewsSummaryAgent } from '@backend/agents/newsSummaryAgent';
import { buildNormalizedScores, runRiskAssessment } from '@backend/agents/riskAgent';
import {
  screenPullback,
  screenPullbackQuoteCandidates,
  type PullbackQuoteCandidateInput,
  type ScreenHit,
} from '@backend/agents/screening';
import { runStockDataAgent } from '@backend/agents/stockDataAgent';
import { runTechnicalAnalysisAgent } from '@backend/agents/technicalAnalysisAgent';
import {
  getToolDefinition,
  resolveToolRouteWithContext,
  type ToolRoute,
  type ToolExecutionResult,
} from '@backend/agents/toolAgents';
import {
  classifyUserIntent,
  generateAssistantResponse,
  generateParallelResponse,
  type IntentClassification,
  type SingleIntent,
} from '@backend/llm/openai';
import {
  appendMessage,
  getOrCreateSession,
  updatePreferences,
} from '@backend/memory/sessionStore';
import { abortableDelay, throwIfAborted } from '@/lib/cancellation';

type SelectedToolRoute = ToolRoute | 'none';

/* ──────────────────────────────────────────────────────────────────────────
 * LangGraph State
 * ─────────────────────────────────────────────────────────────────────── */

const OrchestratorState = Annotation.Root({
  input: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),
  sessionId: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),
  preferences: Annotation<UserPreferences>({
    reducer: (_current, update) => update,
    default: () => ({ recentSearchTopics: [] }),
  }),
  history: Annotation<ConversationTurn[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  /** Intent classification result from the LLM (or keyword fallback) */
  intent: Annotation<IntentClassification>({
    reducer: (_current, update) => update,
    default: () => ({ tool: 'none', isFollowUp: false }),
  }),

  selectedTool: Annotation<SelectedToolRoute>({
    reducer: (_current, update) => update,
    default: () => 'none',
  }),
  tasks: Annotation<TaskStatus[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  toolResult: Annotation<ToolExecutionResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  response: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),
  agent: Annotation<AgentSummary>({
    reducer: (_current, update) => update,
    default: () => ORCHESTRATOR_AGENT,
  }),
  signal: Annotation<AbortSignal | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),
});

type OrchestratorStateType = typeof OrchestratorState.State;

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────────── */

function pause(milliseconds: number, signal?: AbortSignal) {
  return abortableDelay(milliseconds, signal);
}

/**
 * Async generator that yields each promise's settled result in the order
 * they complete (NOT in the order they were started). Used by the parallel
 * workflow to stream live task-status updates as each tool finishes.
 */
async function* yieldAsCompleted<T>(
  promises: Array<Promise<T>>,
  signal?: AbortSignal,
): AsyncGenerator<{ index: number; result: PromiseSettledResult<T> }> {
  type Marker = { i: number; r: PromiseSettledResult<T> };
  const markers: Array<Promise<Marker>> = promises.map((p, i) =>
    p.then(
      (value): Marker => ({ i, r: { status: 'fulfilled', value } }),
      (reason): Marker => ({ i, r: { status: 'rejected', reason } }),
    ),
  );

  const settled = new Set<number>();
  while (settled.size < markers.length) {
    throwIfAborted(signal);
    const pending = markers.filter((_, i) => !settled.has(i));
    const { i, r } = await raceWithAbort(Promise.race(pending), signal);
    throwIfAborted(signal);
    if (settled.has(i)) continue;
    settled.add(i);
    yield { index: i, result: r };
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        finish(() => reject(error));
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function markTask(tasks: TaskStatus[], taskId: string, status: TaskStatus['status']) {
  return tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
}

function buildPlanningTasks(route: SelectedToolRoute) {
  const tasks: TaskStatus[] = [
    {
      id: 'parse-intent',
      description: 'LLM intent classification',
      status: 'completed',
      agent: ORCHESTRATOR_AGENT.name,
    },
  ];

  if (route !== 'none') {
    const tool = getToolDefinition(route);
    tasks.push({
      id: tool.taskId,
      description: tool.taskDescription,
      status: 'running',
      agent: tool.agentName,
    });
  }

  tasks.push({
    id: 'compose-response',
    description: 'LLM response generation',
    status: route === 'none' ? 'running' : 'pending',
    agent: ORCHESTRATOR_AGENT.name,
  });

  return tasks;
}

function derivePreferenceUpdates(
  input: string,
  selectedTool: SelectedToolRoute,
  toolResult: ToolExecutionResult | null,
  preferences: UserPreferences,
) {
  const updates: Partial<UserPreferences> = {
    lastUsedAgent: toolResult?.agent.name ?? ORCHESTRATOR_AGENT.name,
  };

  if (selectedTool === 'weather') {
    const resolvedLocation = toolResult?.metadata.location;
    const weatherContext = toolResult?.metadata as Partial<WeatherContext> | undefined;

    if (typeof resolvedLocation === 'string' && resolvedLocation.trim()) {
      updates.preferredWeatherLocation = resolvedLocation.trim();
    }

    if (weatherContext?.location && typeof weatherContext.location === 'string') {
      updates.lastWeatherResult = {
        location: weatherContext.location,
        timeframe: weatherContext.timeframe === 'tomorrow' ? 'tomorrow' : 'current',
        condition: typeof weatherContext.condition === 'string' ? weatherContext.condition : undefined,
        temperatureF:
          typeof weatherContext.temperatureF === 'number' ? weatherContext.temperatureF : undefined,
        temperatureC:
          typeof weatherContext.temperatureC === 'number' ? weatherContext.temperatureC : undefined,
        feelsLikeF:
          typeof weatherContext.feelsLikeF === 'number' ? weatherContext.feelsLikeF : undefined,
        feelsLikeC:
          typeof weatherContext.feelsLikeC === 'number' ? weatherContext.feelsLikeC : undefined,
        averageTemperatureF:
          typeof weatherContext.averageTemperatureF === 'number'
            ? weatherContext.averageTemperatureF
            : undefined,
        averageTemperatureC:
          typeof weatherContext.averageTemperatureC === 'number'
            ? weatherContext.averageTemperatureC
            : undefined,
        maxTemperatureF:
          typeof weatherContext.maxTemperatureF === 'number' ? weatherContext.maxTemperatureF : undefined,
        maxTemperatureC:
          typeof weatherContext.maxTemperatureC === 'number' ? weatherContext.maxTemperatureC : undefined,
        minTemperatureF:
          typeof weatherContext.minTemperatureF === 'number' ? weatherContext.minTemperatureF : undefined,
        minTemperatureC:
          typeof weatherContext.minTemperatureC === 'number' ? weatherContext.minTemperatureC : undefined,
        humidity: typeof weatherContext.humidity === 'number' ? weatherContext.humidity : undefined,
        windSpeedKph:
          typeof weatherContext.windSpeedKph === 'number' ? weatherContext.windSpeedKph : undefined,
        chanceOfRain:
          typeof weatherContext.chanceOfRain === 'number' ? weatherContext.chanceOfRain : undefined,
        localTime: typeof weatherContext.localTime === 'string' ? weatherContext.localTime : undefined,
        lastUpdated:
          typeof weatherContext.lastUpdated === 'string' ? weatherContext.lastUpdated : undefined,
      };
    }
  }

  if (selectedTool !== 'none') {
    const tool = getToolDefinition(selectedTool);
    return {
      ...updates,
      ...(tool.buildPreferenceUpdates?.({ input, preferences }) ?? {}),
    };
  }

  return updates;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Node 1 — LLM Intent Parser
 *
 * Calls the LLM to classify the user's intent (which tool, location,
 * timeframe, etc.). Falls back to keyword regex matching when the LLM
 * is unavailable.
 * ─────────────────────────────────────────────────────────────────────── */

async function intentParserNode(state: OrchestratorStateType) {
  throwIfAborted(state.signal);
  // Try LLM-based intent classification first
  const llmIntent = await classifyUserIntent({
    input: state.input,
    history: state.history,
    preferences: state.preferences,
    signal: state.signal,
  });

  if (llmIntent) {
    // 'stock-analysis' is handled by its own streaming workflow before reaching LangGraph;
    // if somehow it ends up here, fall back to 'none' so the standard pipeline doesn't crash.
    const selectedTool: SelectedToolRoute = (llmIntent.tool === 'stock-analysis' ? 'none' : llmIntent.tool) as SelectedToolRoute;
    return {
      intent: llmIntent,
      selectedTool,
      tasks: buildPlanningTasks(selectedTool),
      agent: ORCHESTRATOR_AGENT,
    };
  }

  // Fallback: keyword-based routing
  const selectedTool = resolveToolRouteWithContext({
    input: state.input,
    preferences: state.preferences,
  });

  const fallbackIntent: IntentClassification = {
    tool: selectedTool,
    isFollowUp: selectedTool === 'none' && state.history.length > 1,
  };

  return {
    intent: fallbackIntent,
    selectedTool,
    tasks: buildPlanningTasks(selectedTool),
    agent: ORCHESTRATOR_AGENT,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Node 2 — Tool Executor
 *
 * Runs the selected agent/tool. Passes LLM-extracted parameters (location,
 * timeframe, search query) when available for more accurate tool calls.
 * ─────────────────────────────────────────────────────────────────────── */

async function executeToolNode(state: OrchestratorStateType) {
  throwIfAborted(state.signal);
  if (state.selectedTool === 'none') {
    return {
      toolResult: null,
      tasks: state.tasks,
      agent: ORCHESTRATOR_AGENT,
    };
  }

  const tool = getToolDefinition(state.selectedTool);
  const toolResult = await tool.execute({
    input: state.input,
    preferences: state.preferences,
    // Pass LLM-extracted parameters for more accurate tool execution
    extractedLocation: state.intent.location || undefined,
    extractedTimeframe: state.intent.timeframe || undefined,
    extractedSearchQuery: state.intent.searchQuery || undefined,
    extractedUrl: state.intent.url || undefined,
    extractedTicker: state.intent.ticker || undefined,
    extractedNewsUrls: state.intent.newsUrls || undefined,
    signal: state.signal,
  });

  return {
    toolResult,
    tasks: markTask(state.tasks, tool.taskId, 'completed'),
    agent: toolResult.agent,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Node 3 — LLM Response Generator
 *
 * Generates the final user-facing response. Uses conversation history and
 * tool results to produce a contextual, non-repetitive answer in the
 * user's language.
 * ─────────────────────────────────────────────────────────────────────── */

async function responseGeneratorNode(state: OrchestratorStateType) {
  throwIfAborted(state.signal);
  const response = await generateAssistantResponse({
    input: state.input,
    toolResult: state.toolResult,
    preferences: state.preferences,
    history: state.history,
    signal: state.signal,
  });

  return {
    response,
    tasks: markTask(state.tasks, 'compose-response', 'completed'),
    agent: state.toolResult?.agent ?? ORCHESTRATOR_AGENT,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * LangGraph — Wire up the nodes
 *
 *   START → intentParser → executeTool (if needed) → responseGenerator → END
 *           (LLM)           (Agent/Tool)              (LLM)
 * ─────────────────────────────────────────────────────────────────────── */

const orchestratorGraph = new StateGraph(OrchestratorState)
  .addNode('intentParser', intentParserNode)
  .addNode('executeTool', executeToolNode)
  .addNode('responseGenerator', responseGeneratorNode)
  .addEdge(START, 'intentParser')
  .addConditionalEdges(
    'intentParser',
    (state) => {
      if (state.selectedTool !== 'none') {
        return 'executeTool';
      }
      return 'responseGenerator';
    },
    {
      executeTool: 'executeTool',
      responseGenerator: 'responseGenerator',
    },
  )
  .addEdge('executeTool', 'responseGenerator')
  .addEdge('responseGenerator', END)
  .compile();

/* ──────────────────────────────────────────────────────────────────────────
 * Session Stream — public entry point
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Helper: build the conversation history array from session messages.
 */
function buildHistory(session: ReturnType<typeof getOrCreateSession>) {
  return session.history.map((message) => ({
    role: message.role,
    content: message.content,
    agentName: message.agent?.name,
    timestamp: message.timestamp,
  }));
}

/**
 * News-summary two-step workflow.
 *
 * Runs news scraping and summary analysis as separate visible tasks with
 * intermediate streaming. Each agent's result is shown as a distinct
 * chat bubble so the user can clearly see which agent did what:
 *
 *   📰 News Scrape Agent → scraped news articles
 *   📝 News Summary Agent → sentiment analysis and summary
 */
async function* streamNewsSummaryWorkflow(params: {
  sessionId: string;
  input: string;
  intent: IntentClassification;
  preferences: UserPreferences;
  history: ConversationTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const { sessionId, input, intent, preferences, history, signal } = params;

  /* ── Step 1: Build initial task list ────────────────────────────────── */
  let tasks: TaskStatus[] = [
    {
      id: 'parse-intent',
      description: 'LLM intent classification',
      status: 'completed',
      agent: ORCHESTRATOR_AGENT.name,
    },
    {
      id: 'news-scrape-tool',
      description: 'Scrape recent news articles for the stock',
      status: 'running',
      agent: NEWS_SCRAPE_AGENT.name,
    },
    {
      id: 'news-summary-sub',
      description: 'Analyze news sentiment and provide summary',
      status: 'pending',
      agent: NEWS_SUMMARY_AGENT.name,
    },
    {
      id: 'compose-response',
      description: 'LLM response generation',
      status: 'pending',
      agent: ORCHESTRATOR_AGENT.name,
    },
  ];

  throwIfAborted(signal);
  yield { type: 'tasks', tasks };

  /* ── Step 2: Run News Scrape Agent ────────────────────────────── */
  const toolContext = {
    input,
    preferences,
    extractedTicker: intent.ticker || undefined,
    signal,
  };

  throwIfAborted(signal);
  const scrapeResult = await runNewsScrapeAgent(toolContext);
  throwIfAborted(signal);

  const initialNewsItems = scrapeResult.metadata.newsItems as Array<{title: string, url: string, publishedDate: string}> | undefined;
  tasks = markTask(tasks, 'news-scrape-tool', initialNewsItems?.length ? 'completed' : 'failed');
  yield { type: 'tasks', tasks };

  /* ── Emit the scrape result as its own chat bubble ──────────────────── */
  const scrapeMessage = createMessage({
    role: 'assistant',
    content: scrapeResult.markdown,
    agent: NEWS_SCRAPE_AGENT,
    status: 'done',
  });
  throwIfAborted(signal);
  appendMessage(sessionId, scrapeMessage);
  yield { type: 'agent-done', message: scrapeMessage };

  if (!initialNewsItems?.length) {
    /* ── No news found — skip summary ─────────────────────── */
    tasks = markTask(tasks, 'news-summary-sub', 'failed');
    tasks = markTask(tasks, 'compose-response', 'completed');
    yield { type: 'tasks', tasks };

    throwIfAborted(signal);
    const updatedSession = updatePreferences(
      sessionId,
      derivePreferenceUpdates(input, 'news-scrape', scrapeResult, preferences),
    );

    const failMessage = createMessage({
      role: 'assistant',
      content: 'No news articles were found for the specified stock, so the news summary analysis could not be performed. Please try a different ticker symbol or check back later.',
      agent: ORCHESTRATOR_AGENT,
    });
    throwIfAborted(signal);
    appendMessage(sessionId, failMessage);

    for (const delta of chunkText(failMessage.content)) {
      throwIfAborted(signal);
      yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
      await pause(35, signal);
    }

    yield {
      type: 'done',
      message: failMessage,
      tasks,
      preferences: updatedSession.preferences,
    };
    return;
  }

  /* ── Step 3: Run News Summary Agent ───────────────────────────── */
  tasks = markTask(tasks, 'news-summary-sub', 'running');
  yield { type: 'tasks', tasks };

  const newsItems = scrapeResult.metadata.newsItems as Array<{title: string, url: string, publishedDate: string}>;
  const extractedNewsUrls = newsItems.map(item => ({ url: item.url, title: item.title }));

  const summaryResult = await runNewsSummaryAgent({
    ...toolContext,
    extractedNewsUrls,
    signal,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'news-summary-sub', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 4: LLM Response Generation ────────────────────────────────── */
  tasks = markTask(tasks, 'compose-response', 'running');
  yield { type: 'tasks', tasks };

  // Pass only the summary result to the LLM — news scrape is already shown above
  const response = await generateAssistantResponse({
    input,
    toolResult: summaryResult,
    preferences,
    history,
    signal,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'compose-response', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 5: Update preferences ─────────────────────────────────────── */
  const combinedToolResult = {
    ...summaryResult,
    metadata: {
      ...summaryResult.metadata,
      ...scrapeResult.metadata,
    },
  };
  throwIfAborted(signal);
  const updatedSession = updatePreferences(
    sessionId,
    derivePreferenceUpdates(input, 'news-summary', combinedToolResult, preferences),
  );

  /* ── Step 6: Stream the summary analysis as the LLM response ─────────── */
  const assistantMessage = createMessage({
    role: 'assistant',
    content: response,
    agent: NEWS_SUMMARY_AGENT,
  });

  for (const delta of chunkText(response)) {
    throwIfAborted(signal);
    yield { type: 'message', delta, agent: NEWS_SUMMARY_AGENT };
    await pause(35, signal);
  }

  throwIfAborted(signal);
  appendMessage(sessionId, assistantMessage);

  yield {
    type: 'done',
    message: assistantMessage,
    tasks,
    preferences: updatedSession.preferences,
  };
}

/**
 * US stock scan workflow coordinated by the Orchestrator.
 *
 * Pipeline (pullback-only for performance — trend/momentum agents still
 * exist but are not used here so a "scan Nasdaq" run can finish in tens of
 * seconds instead of minutes):
 *   1. Liquidity Filter Agent — Yahoo `quote()` batches over the universe.
 *   2. Pullback Stage 1 (quote-only prefilter) — drops every liquid ticker
 *      whose 50/200 DMA + price already disqualify it from a pullback
 *      setup. Zero extra HTTP requests (data already pulled in step 1).
 *   3. Pullback Stage 2 (chart-based) — runs the full pullback rule via
 *      `screenPullback` only on the small Stage-1 candidate set.
 *   4. Final Select Agent — top 10 trade plans by score.
 */
async function* streamUsStockScanWorkflow(params: {
  sessionId: string;
  input: string;
  preferences: UserPreferences;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const { sessionId, input, preferences, signal } = params;

  let tasks: TaskStatus[] = [
    {
      id: 'parse-intent',
      description: 'LLM intent classification',
      status: 'completed',
      agent: ORCHESTRATOR_AGENT.name,
    },
    {
      id: 'liquidity-filter-tool',
      description: 'Load requested stock universe and run liquidity filter',
      status: 'running',
      agent: LIQUIDITY_AGENT.name,
    },
    {
      id: 'screen-hit-tool',
      description: 'Pullback screening (quote prefilter + chart confirmation)',
      status: 'pending',
      agent: SCREEN_HIT_AGENT.name,
    },
    {
      id: 'final-select-tool',
      description: 'Show the final top 10 stocks in table format',
      status: 'pending',
      agent: FINAL_SELECT_AGENT.name,
    },
  ];

  throwIfAborted(signal);
  yield { type: 'tasks', tasks };

  console.info(`[stock-scan] Starting workflow for input: ${input}`);

  throwIfAborted(signal);
  const liquidityResult = await runLiquidityAgent({
    input,
    preferences,
    signal,
  });
  throwIfAborted(signal);

  const liquidityUniverse = liquidityResult.metadata.universe as { label?: string; tickers?: string[] } | undefined;
  const universeLabel = typeof liquidityUniverse?.label === 'string'
    ? liquidityUniverse.label
    : 'Requested stock universe';

  const liquidStocks = (Array.isArray(liquidityResult.metadata.results)
    ? liquidityResult.metadata.results
    : []) as LiquidityResult[];
  const liquidTickers = liquidStocks
    .map((stock) => {
      if (stock && typeof stock === 'object' && 'ticker' in stock) {
        return String(stock.ticker).toUpperCase();
      }
      return '';
    })
    .filter((ticker) => ticker.length > 0);
  const totalUniverseTickers = Array.isArray(liquidityUniverse?.tickers)
    ? liquidityUniverse.tickers.length
    : liquidTickers.length;

  console.info(`[stock-scan] Liquidity filter completed: ${liquidTickers.length}/${totalUniverseTickers} liquid tickers from ${universeLabel}`);

  tasks = markTask(tasks, 'liquidity-filter-tool', liquidTickers.length > 0 ? 'completed' : 'failed');
  yield { type: 'tasks', tasks };

  const liquidityMessage = createMessage({
    role: 'assistant',
    content: liquidityResult.markdown,
    agent: LIQUIDITY_AGENT,
    status: 'done',
  });
  throwIfAborted(signal);
  appendMessage(sessionId, liquidityMessage);
  yield { type: 'agent-done', message: liquidityMessage };

  if (liquidTickers.length === 0) {
    tasks = markTask(tasks, 'screen-hit-tool', 'failed');
    tasks = markTask(tasks, 'final-select-tool', 'failed');
    yield { type: 'tasks', tasks };

    const noLiquidityMarkdown = [
      '# US Stock Scan',
      '',
      'No stocks passed the liquidity filter, so technical screening and final selection were skipped.',
      '',
      `Universe scanned: ${universeLabel}`,
      `Symbols loaded: ${totalUniverseTickers}`,
    ].join('\n');

    const noLiquidityMessage = createMessage({
      role: 'assistant',
      content: noLiquidityMarkdown,
      agent: ORCHESTRATOR_AGENT,
    });
    throwIfAborted(signal);
    appendMessage(sessionId, noLiquidityMessage);

    for (const delta of chunkText(noLiquidityMarkdown)) {
      throwIfAborted(signal);
      yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
      await pause(35, signal);
    }

    throwIfAborted(signal);
    const updatedSession = updatePreferences(sessionId, { lastUsedAgent: LIQUIDITY_AGENT.name });
    yield { type: 'done', message: noLiquidityMessage, tasks, preferences: updatedSession.preferences };
    return;
  }

  tasks = markTask(tasks, 'screen-hit-tool', 'running');
  yield { type: 'tasks', tasks };

  // Stage 1: quote-only pullback prefilter. No extra HTTP — uses fields
  // already returned by the liquidity batch quote() call.
  const stage1Inputs: PullbackQuoteCandidateInput[] = liquidStocks.map((stock) => ({
    ticker: stock.ticker,
    close: stock.metrics.close,
    fiftyDayAverage: stock.metrics.fiftyDayAverage,
    twoHundredDayAverage: stock.metrics.twoHundredDayAverage,
  }));
  const stage1 = screenPullbackQuoteCandidates(stage1Inputs);

  console.info(
    `[stock-scan] Pullback Stage 1 (quote-only prefilter): ${stage1.candidates.length} candidates from ${stage1.inputCount} liquid tickers; rejected ${stage1.rejectedByQuote}, missing 50/200 DMA ${stage1.missingMaData}`,
  );

  // Stage 2: full pullback rule on chart data, but only for Stage-1 survivors.
  const stage2Started = Date.now();
  const screenHits: ScreenHit[] = stage1.candidates.length > 0
    ? await screenPullback(stage1.candidates, signal)
    : [];
  throwIfAborted(signal);
  console.info(
    `[stock-scan] Pullback Stage 2 (chart confirmation): ${screenHits.length} hits from ${stage1.candidates.length} Stage-1 candidates in ${Date.now() - stage2Started}ms`,
  );

  tasks = markTask(tasks, 'screen-hit-tool', screenHits.length > 0 ? 'completed' : 'failed');
  yield { type: 'tasks', tasks };

  const screenMarkdown = [
    '# 🎯 Screen Hit Agent — Pullback Only',
    '',
    `Stage 1 quote-only prefilter: ${stage1.candidates.length} pullback candidates from ${stage1.inputCount} liquid tickers (rejected ${stage1.rejectedByQuote}; ${stage1.missingMaData} let through with missing 50/200 DMA).`,
    `Stage 2 chart confirmation: ${screenHits.length} pullback setup${screenHits.length === 1 ? '' : 's'} confirmed.`,
  ].join('\n');

  const screenMessage = createMessage({
    role: 'assistant',
    content: screenMarkdown,
    agent: SCREEN_HIT_AGENT,
    status: 'done',
  });
  throwIfAborted(signal);
  appendMessage(sessionId, screenMessage);
  yield { type: 'agent-done', message: screenMessage };

  if (screenHits.length === 0) {
    tasks = markTask(tasks, 'final-select-tool', 'failed');
    yield { type: 'tasks', tasks };

    const noHitsMarkdown = [
      '# US Stock Scan',
      '',
      `Liquidity Filter Agent found ${liquidTickers.length} liquid stocks, but the pullback screen found no setups today.`,
      `Stage 1 narrowed the pool to ${stage1.candidates.length} pullback candidates, none of which passed the chart-confirmed pullback rule.`,
      '',
      'No top 10 table was generated because there are no final candidates today.',
    ].join('\n');

    const noHitsMessage = createMessage({
      role: 'assistant',
      content: noHitsMarkdown,
      agent: ORCHESTRATOR_AGENT,
    });
    throwIfAborted(signal);
    appendMessage(sessionId, noHitsMessage);

    for (const delta of chunkText(noHitsMarkdown)) {
      throwIfAborted(signal);
      yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
      await pause(35, signal);
    }

    throwIfAborted(signal);
    const updatedSession = updatePreferences(sessionId, { lastUsedAgent: SCREEN_HIT_AGENT.name });
    yield { type: 'done', message: noHitsMessage, tasks, preferences: updatedSession.preferences };
    return;
  }

  tasks = markTask(tasks, 'final-select-tool', 'running');
  yield { type: 'tasks', tasks };

  const finalResult = await runFinalSelectAgent({
    input: JSON.stringify(screenHits),
    preferences,
    signal,
  });
  throwIfAborted(signal);

  console.info('[stock-scan] Final Select Agent completed');

  tasks = markTask(tasks, 'final-select-tool', 'completed');
  yield { type: 'tasks', tasks };

  const finalMarkdown = [
    '# Today\'s US Stock Scan - Top 10 (Pullback)',
    '',
    `Universe: ${universeLabel}`,
    `Liquidity Filter Agent: ${liquidTickers.length}/${totalUniverseTickers} symbols passed`,
    `Pullback Stage 1 (quote prefilter): ${stage1.candidates.length} candidates from ${stage1.inputCount} liquid tickers`,
    `Pullback Stage 2 (chart confirmation): ${screenHits.length} setup${screenHits.length === 1 ? '' : 's'} confirmed`,
    '',
    finalResult.markdown,
  ].join('\n');

  const finalMessage = createMessage({
    role: 'assistant',
    content: finalMarkdown,
    agent: FINAL_SELECT_AGENT,
  });

  for (const delta of chunkText(finalMarkdown)) {
    throwIfAborted(signal);
      yield { type: 'message', delta, agent: FINAL_SELECT_AGENT };
    await pause(35, signal);
  }

  throwIfAborted(signal);
  appendMessage(sessionId, finalMessage);

  throwIfAborted(signal);
  const updatedSession = updatePreferences(sessionId, { lastUsedAgent: FINAL_SELECT_AGENT.name });

  yield {
    type: 'done',
    message: finalMessage,
    tasks,
    preferences: updatedSession.preferences,
  };
}

/**
 * Ingredients-scrape two-step workflow.
 *
 * Runs scraping and safety analysis as separate visible tasks with
 * intermediate streaming. Each agent's result is shown as a distinct
 * chat bubble so the user can clearly see which agent did what:
 *
 *   🔬 Ingredients Scrape Agent → extracted ingredients
 *   🧴 Cosmetic Safe Check Agent → safety analysis
 */
async function* streamIngredientsScrapeWorkflow(params: {
  sessionId: string;
  input: string;
  intent: IntentClassification;
  preferences: UserPreferences;
  history: ConversationTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const { sessionId, input, intent, preferences, history, signal } = params;

  /* ── Step 1: Build initial task list ────────────────────────────────── */
  let tasks: TaskStatus[] = [
    {
      id: 'parse-intent',
      description: 'LLM intent classification',
      status: 'completed',
      agent: ORCHESTRATOR_AGENT.name,
    },
    {
      id: 'ingredients-scrape-tool',
      description: 'Scrape product ingredients from URL',
      status: 'running',
      agent: INGREDIENTS_SCRAPE_AGENT.name,
    },
    {
      id: 'cosmetic-safe-check-sub',
      description: 'Analyze ingredient safety',
      status: 'pending',
      agent: COSMETIC_SAFE_CHECK_AGENT.name,
    },
    {
      id: 'compose-response',
      description: 'LLM response generation',
      status: 'pending',
      agent: ORCHESTRATOR_AGENT.name,
    },
  ];

  throwIfAborted(signal);
  yield { type: 'tasks', tasks };

  /* ── Step 2: Run Ingredients Scrape Agent ────────────────────────────── */
  const toolContext = {
    input,
    preferences,
    extractedUrl: intent.url || undefined,
    signal,
  };

  throwIfAborted(signal);
  const scrapeResult = await scrapeIngredientsOnly(toolContext);
  throwIfAborted(signal);

  tasks = markTask(tasks, 'ingredients-scrape-tool', scrapeResult.ingredientText ? 'completed' : 'failed');
  yield { type: 'tasks', tasks };

  /* ── Emit the scrape result as its own chat bubble ──────────────────── */
  const scrapeMessage = createMessage({
    role: 'assistant',
    content: scrapeResult.toolResult.markdown,
    agent: INGREDIENTS_SCRAPE_AGENT,
    status: 'done',
  });
  throwIfAborted(signal);
  appendMessage(sessionId, scrapeMessage);
  yield { type: 'agent-done', message: scrapeMessage };

  if (!scrapeResult.ingredientText) {
    /* ── No ingredients found — skip safety check ─────────────────────── */
    tasks = markTask(tasks, 'cosmetic-safe-check-sub', 'failed');
    tasks = markTask(tasks, 'compose-response', 'completed');
    yield { type: 'tasks', tasks };

    throwIfAborted(signal);
    const updatedSession = updatePreferences(
      sessionId,
      derivePreferenceUpdates(input, 'ingredients-scrape', scrapeResult.toolResult, preferences),
    );

    const failMessage = createMessage({
      role: 'assistant',
      content: 'No ingredients were found on the page, so the safety analysis could not be performed. Please try a different URL or provide the ingredients manually.',
      agent: ORCHESTRATOR_AGENT,
    });
    throwIfAborted(signal);
    appendMessage(sessionId, failMessage);

    for (const delta of chunkText(failMessage.content)) {
      throwIfAborted(signal);
      yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
      await pause(35, signal);
    }

    yield {
      type: 'done',
      message: failMessage,
      tasks,
      preferences: updatedSession.preferences,
    };
    return;
  }

  /* ── Step 3: Run Cosmetic Safe Check Agent ───────────────────────────── */
  tasks = markTask(tasks, 'cosmetic-safe-check-sub', 'running');
  yield { type: 'tasks', tasks };

  const safetyResult = await runCosmeticSafeCheckAgent({
    ...toolContext,
    input: scrapeResult.ingredientText,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'cosmetic-safe-check-sub', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 4: LLM Response Generation ────────────────────────────────── */
  tasks = markTask(tasks, 'compose-response', 'running');
  yield { type: 'tasks', tasks };

  // Pass only the safety result to the LLM — ingredients are already
  // shown in the Ingredients Scrape Agent's chat bubble above
  const response = await generateAssistantResponse({
    input,
    toolResult: safetyResult,
    preferences,
    history,
    signal,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'compose-response', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 5: Update preferences ─────────────────────────────────────── */
  const combinedToolResult = buildCombinedScrapeAndSafetyResult(scrapeResult, safetyResult);
  throwIfAborted(signal);
  const updatedSession = updatePreferences(
    sessionId,
    derivePreferenceUpdates(input, 'ingredients-scrape', combinedToolResult, preferences),
  );

  /* ── Step 6: Stream the safety analysis as the LLM response ─────────── */
  const assistantMessage = createMessage({
    role: 'assistant',
    content: response,
    agent: COSMETIC_SAFE_CHECK_AGENT,
  });

  for (const delta of chunkText(response)) {
    throwIfAborted(signal);
    yield { type: 'message', delta, agent: COSMETIC_SAFE_CHECK_AGENT };
    await pause(35, signal);
  }

  throwIfAborted(signal);
  appendMessage(sessionId, assistantMessage);

  yield {
    type: 'done',
    message: assistantMessage,
    tasks,
    preferences: updatedSession.preferences,
  };
}

/**
 * Parallel multi-intent workflow.
 *
 * When the LLM detects that the user asked for MULTIPLE INDEPENDENT things
 * in one query (e.g. "summarize https://example.com and tell me the weather
 * in Tokyo"), this workflow:
 *
 *   1. Builds one task row per intent (all in "running" state up front)
 *   2. Fires ALL tool executions concurrently via Promise.all
 *   3. As each tool finishes (yieldAsCompleted), emits:
 *        - a task-status update (running → completed / failed)
 *        - an "agent-done" chat bubble with that tool's markdown
 *   4. Merges all results through generateParallelResponse and streams a
 *      single combined LLM summary as the final message.
 *
 * This is TRUE parallel processing — network-bound tools (weather API,
 * webpage fetch, stock API, etc.) execute simultaneously rather than
 * sequentially, so total latency ≈ max(tool latencies) instead of sum.
 */
async function* streamParallelWorkflow(params: {
  sessionId: string;
  input: string;
  intents: SingleIntent[];
  preferences: UserPreferences;
  history: ConversationTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const { sessionId, input, intents, preferences, history, signal } = params;

  /* ── Step 1: Build initial task list (intent + N parallel tools + compose) ── */
  const toolTaskIds: string[] = intents.map(
    (sub, idx) => `${getToolDefinition(sub.tool as ToolRoute).taskId}-parallel-${idx}`,
  );

  let tasks: TaskStatus[] = [
    {
      id: 'parse-intent',
      description: `LLM intent classification (${intents.length} parallel intents detected)`,
      status: 'completed',
      agent: ORCHESTRATOR_AGENT.name,
    },
    ...intents.map((sub, idx) => {
      const tool = getToolDefinition(sub.tool as ToolRoute);
      return {
        id: toolTaskIds[idx],
        description: `[Parallel ${idx + 1}/${intents.length}] ${tool.taskDescription}`,
        status: 'running' as const,
        agent: tool.agentName,
      };
    }),
    {
      id: 'compose-response',
      description: 'LLM response generation (merging parallel results)',
      status: 'pending',
      agent: ORCHESTRATOR_AGENT.name,
    },
  ];

  throwIfAborted(signal);
  yield { type: 'tasks', tasks };

  /* ── Step 2: Fire all tool executions CONCURRENTLY via Promise.all ── */
  const executionPromises = intents.map((sub) => {
    const tool = getToolDefinition(sub.tool as ToolRoute);
    return tool.execute({
      input,
      preferences,
      extractedLocation: sub.location || undefined,
      extractedTimeframe: sub.timeframe || undefined,
      extractedSearchQuery: sub.searchQuery || undefined,
      extractedUrl: sub.url || undefined,
      extractedTicker: sub.ticker || undefined,
      extractedNewsUrls: sub.newsUrls || undefined,
      signal,
    });
  });

  const results: Array<ToolExecutionResult | null> = new Array(intents.length).fill(null);
  const errors: Array<{ tool: SingleIntent['tool']; error: string }> = [];

  /* ── Step 3: Stream task-status updates as each tool finishes ──────────
   *
   * We intentionally do NOT emit an `agent-done` chat bubble per tool here.
   * Unlike the single-agent pipelines, many tools (e.g. webpage-summarize)
   * return RAW intermediate data (scraped HTML text) in their `markdown`
   * field — the actual user-facing summary is produced later by the
   * response-generator LLM. Showing the raw data would confuse the user.
   *
   * The final combined response from `generateParallelResponse` IS the
   * user-facing result for all tools in the parallel batch.
   * ─────────────────────────────────────────────────────────────────── */
  for await (const { index, result } of yieldAsCompleted(executionPromises, signal)) {
    const taskId = toolTaskIds[index];
    const sub = intents[index];

    if (result.status === 'fulfilled') {
      results[index] = result.value;
      tasks = markTask(tasks, taskId, 'completed');
      yield { type: 'tasks', tasks };
    } else {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason ?? 'Unknown error');
      console.error(`[streamParallelWorkflow] tool "${sub.tool}" failed:`, result.reason);
      errors.push({ tool: sub.tool, error: message });
      tasks = markTask(tasks, taskId, 'failed');
      yield { type: 'tasks', tasks };
    }
  }

  /* ── Step 4: LLM merges all tool results into one cohesive response ── */
  tasks = markTask(tasks, 'compose-response', 'running');
  yield { type: 'tasks', tasks };

  const successfulResults = results.filter(
    (r): r is ToolExecutionResult => r !== null,
  );

  const combinedResponse = await generateParallelResponse({
    input,
    toolResults: successfulResults,
    errors,
    preferences,
    history,
    signal,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'compose-response', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 5: Update preferences from each successful tool result ── */
  let currentPrefs = preferences;
  for (let i = 0; i < intents.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const route = intents[i].tool;
    if (route === 'none') continue;
    const updates = derivePreferenceUpdates(
      input,
      route as SelectedToolRoute,
      result,
      currentPrefs,
    );
    throwIfAborted(signal);
    const session = updatePreferences(sessionId, updates);
    currentPrefs = session.preferences;
  }

  /* ── Step 6: Stream the merged summary as the final assistant message ── */
  const assistantMessage = createMessage({
    role: 'assistant',
    content: combinedResponse,
    agent: ORCHESTRATOR_AGENT,
  });

  for (const delta of chunkText(combinedResponse)) {
    throwIfAborted(signal);
    yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
    await pause(35, signal);
  }

  throwIfAborted(signal);
  appendMessage(sessionId, assistantMessage);

  yield {
    type: 'done',
    message: assistantMessage,
    tasks,
    preferences: currentPrefs,
  };
}

/**
 * Full stock investment analysis workflow.
 *
 * Pipeline:
 *   1. Parse intent, extract ticker
 *   2. Parallel: Fundamentals (Stock Data Agent) + News (News Scrape Agent) + Technical (Technical Analysis Agent)
 *   3. Each result emitted as its own chat bubble
 *   4. Normalize scores (pure function → NormalizedScores JSON)
 *   5. Risk Agent (LLM) → RiskAssessmentData with stop-loss + take-profit
 *   6. Decision Agent (LLM) → buy/hold/sell + entry price + confidence + reasoning
 *   7. Final decision streamed as the last assistant message
 */
async function* streamStockAnalysisWorkflow(params: {
  sessionId: string;
  input: string;
  intent: IntentClassification;
  preferences: UserPreferences;
  history: ConversationTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const { sessionId, input, intent, preferences, history, signal } = params;

  const ticker = intent.ticker || '';

  /* ── Step 1: Build task list ────────────────────────────────────────── */
  let tasks: TaskStatus[] = [
    {
      id: 'parse-intent',
      description: 'LLM intent classification',
      status: 'completed',
      agent: ORCHESTRATOR_AGENT.name,
    },
    {
      id: 'fundamentals-parallel',
      description: `[Parallel 1/3] Fetch financial statements — ${ticker || 'Stock Data Agent'}`,
      status: 'running',
      agent: STOCK_DATA_AGENT.name,
    },
    {
      id: 'news-parallel',
      description: `[Parallel 2/3] Scrape recent news — ${ticker || 'News Scrape Agent'}`,
      status: 'running',
      agent: NEWS_SCRAPE_AGENT.name,
    },
    {
      id: 'technical-parallel',
      description: `[Parallel 3/3] Technical indicators — ${ticker || 'Technical Analysis Agent'}`,
      status: 'running',
      agent: TECHNICAL_ANALYSIS_AGENT.name,
    },
    {
      id: 'risk-assessment',
      description: 'Risk assessment + stop-loss/take-profit targets',
      status: 'pending',
      agent: RISK_ASSESSMENT_AGENT.name,
    },
    {
      id: 'investment-decision',
      description: 'Investment decision: buy/hold/sell + entry price + reasoning',
      status: 'pending',
      agent: STOCK_DECISION_AGENT.name,
    },
  ];

  throwIfAborted(signal);
  yield { type: 'tasks', tasks };

  const toolContext = {
    input,
    preferences,
    extractedTicker: intent.ticker || undefined,
    signal,
  };

  /* ── Step 2: Run fundamentals + news + technical IN PARALLEL ─────────── */
  const [fundamentalsResult, newsResult, technicalResult] = await raceWithAbort(
    Promise.allSettled([
      runStockDataAgent(toolContext),
      runNewsScrapeAgent(toolContext),
      runTechnicalAnalysisAgent(toolContext),
    ]),
    signal,
  );
  throwIfAborted(signal);

  /* ── Step 3: Update task statuses and emit bubbles ───────────────────── */
  const fundamentals = fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : null;
  const news = newsResult.status === 'fulfilled' ? newsResult.value : null;
  const technical = technicalResult.status === 'fulfilled' ? technicalResult.value : null;

  tasks = markTask(tasks, 'fundamentals-parallel', fundamentals ? 'completed' : 'failed');
  tasks = markTask(tasks, 'news-parallel', news ? 'completed' : 'failed');
  tasks = markTask(tasks, 'technical-parallel', technical ? 'completed' : 'failed');
  yield { type: 'tasks', tasks };

  // Emit each result as its own chat bubble
  if (fundamentals) {
    const msg = createMessage({ role: 'assistant', content: fundamentals.markdown, agent: STOCK_DATA_AGENT, status: 'done' });
    throwIfAborted(signal);
    appendMessage(sessionId, msg);
    yield { type: 'agent-done', message: msg };
  }
  if (news) {
    const msg = createMessage({ role: 'assistant', content: news.markdown, agent: NEWS_SCRAPE_AGENT, status: 'done' });
    throwIfAborted(signal);
    appendMessage(sessionId, msg);
    yield { type: 'agent-done', message: msg };
  }
  if (technical) {
    const msg = createMessage({ role: 'assistant', content: technical.markdown, agent: TECHNICAL_ANALYSIS_AGENT, status: 'done' });
    throwIfAborted(signal);
    appendMessage(sessionId, msg);
    yield { type: 'agent-done', message: msg };
  }

  /* ── Step 4: Extract typed data from results ─────────────────────────── */
  const financialData = fundamentals?.metadata.financialData as FinancialData | undefined;
  const newsData = news?.metadata.newsData as NewsData | undefined;
  const technicalData = technical?.metadata.technicalData as TechnicalData | undefined;

  if (!financialData || !newsData || !technicalData) {
    // If any of the parallel agents failed, we can't run the pipeline
    const errMessage = createMessage({
      role: 'assistant',
      content: [
        '# ⚠️ Stock Analysis — Incomplete Data',
        '',
        'One or more parallel analysis steps failed to return data. Cannot proceed with risk assessment and decision.',
        '',
        `- Fundamentals: ${fundamentals ? '✅' : '❌ Failed'}`,
        `- News: ${news ? '✅' : '❌ Failed'}`,
        `- Technical: ${technical ? '✅' : '❌ Failed'}`,
        '',
        'Please verify the ticker symbol is correct and try again.',
      ].join('\n'),
      agent: ORCHESTRATOR_AGENT,
    });
    throwIfAborted(signal);
    appendMessage(sessionId, errMessage);
    tasks = markTask(tasks, 'risk-assessment', 'failed');
    tasks = markTask(tasks, 'investment-decision', 'failed');
    yield { type: 'tasks', tasks };

    for (const delta of chunkText(errMessage.content)) {
      throwIfAborted(signal);
      yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
      await pause(35, signal);
    }
    yield { type: 'done', message: errMessage, tasks, preferences };
    return;
  }

  const resolvedTicker = ticker || financialData.ticker || newsData.ticker || technicalData.ticker;
  const currentPrice =
    technicalData.priceData.currentPrice ||
    (financialData.priceInfo?.regularMarketPrice ?? 0);

  /* ── Step 5: Normalize scores ────────────────────────────────────────── */
  const normalizedScores = buildNormalizedScores(resolvedTicker, financialData, newsData, technicalData);

  /* ── Step 6: Risk Assessment ─────────────────────────────────────────── */
  tasks = markTask(tasks, 'risk-assessment', 'running');
  yield { type: 'tasks', tasks };

  const { riskData, markdown: riskMarkdown, agent: riskAgent } = await runRiskAssessment({
    ticker: resolvedTicker,
    currentPrice,
    financialData,
    newsData,
    technicalData,
    normalizedScores,
    signal,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'risk-assessment', 'completed');
  yield { type: 'tasks', tasks };

  // Emit risk report as its own bubble
  const riskMsg = createMessage({ role: 'assistant', content: riskMarkdown, agent: riskAgent, status: 'done' });
  throwIfAborted(signal);
  appendMessage(sessionId, riskMsg);
  yield { type: 'agent-done', message: riskMsg };

  /* ── Step 7: Investment Decision ─────────────────────────────────────── */
  tasks = markTask(tasks, 'investment-decision', 'running');
  yield { type: 'tasks', tasks };

  const { decisionData, markdown: decisionMarkdown, agent: decisionAgent } = await runInvestmentDecision({
    ticker: resolvedTicker,
    currentPrice,
    normalizedScores,
    riskAssessment: riskData,
    financialData,
    newsData,
    technicalData,
    signal,
  });
  throwIfAborted(signal);

  tasks = markTask(tasks, 'investment-decision', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 8: Update session preferences ─────────────────────────────── */
  throwIfAborted(signal);
  const updatedSession = updatePreferences(sessionId, {
    lastUsedAgent: STOCK_DECISION_AGENT.name,
  });

  /* ── Step 9: Stream the decision as the final message ─────────────────── */
  const decisionMessage = createMessage({
    role: 'assistant',
    content: decisionMarkdown,
    agent: decisionAgent,
  });

  for (const delta of chunkText(decisionMarkdown)) {
    throwIfAborted(signal);
    yield { type: 'message', delta, agent: decisionAgent };
    await pause(35, signal);
  }

  throwIfAborted(signal);
  appendMessage(sessionId, decisionMessage);

  yield {
    type: 'done',
    message: decisionMessage,
    tasks,
    preferences: updatedSession.preferences,
  };
}

/**
 * Main streaming entry point. Routes to the appropriate workflow:
 * - Multiple independent intents → parallel workflow (Promise.all)
 * - `ingredients-scrape` → two-step workflow with intermediate task streaming
 * - `news-summary` → two-step news scrape + summary workflow
 * - `stock-analysis` → full 7-step investment analysis pipeline
 * - `final-select` US stock scan → Liquidity Filter → Screen Hit → Final Select
 * - Everything else → standard LangGraph pipeline
 */
export async function* streamOrchestratorSession(params: {
  sessionId?: string;
  input: string;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  throwIfAborted(params.signal);
  const sessionId = params.sessionId || crypto.randomUUID();
  const session = getOrCreateSession(sessionId);

  throwIfAborted(params.signal);
  const sessionWithUserMessage = appendMessage(
    sessionId,
    createMessage({
      role: 'user',
      content: params.input,
    }),
  );

  throwIfAborted(params.signal);
  yield { type: 'session', sessionId };
  yield {
    type: 'tasks',
    tasks: [
      {
        id: 'parse-intent',
        description: 'LLM intent classification',
        status: 'running',
        agent: ORCHESTRATOR_AGENT.name,
      },
    ],
  };

  const history = buildHistory(sessionWithUserMessage);

  /* ── Intent classification ──────────────────────────────────────────── */
  const llmIntent = await classifyUserIntent({
    input: params.input,
    history,
    preferences: session.preferences,
    signal: params.signal,
  });
  throwIfAborted(params.signal);

  const intent: IntentClassification = llmIntent || {
    tool: resolveToolRouteWithContext({
      input: params.input,
      preferences: session.preferences,
    }),
    isFollowUp: !llmIntent && session.history.length > 1,
  };

  /* ── Route to the appropriate workflow ───────────────────────────────── */

  // If the LLM detected 2+ independent intents, run them in parallel.
  // This takes priority over single-tool workflows.
  if (intent.intents && intent.intents.length >= 2) {
    yield* streamParallelWorkflow({
      sessionId,
      input: params.input,
      intents: intent.intents,
      preferences: session.preferences,
      history,
      signal: params.signal,
    });
    return;
  }

  if (intent.tool === 'ingredients-scrape') {
    yield* streamIngredientsScrapeWorkflow({
      sessionId,
      input: params.input,
      intent,
      preferences: session.preferences,
      history,
      signal: params.signal,
    });
    return;
  }

  if (intent.tool === 'news-summary') {
    yield* streamNewsSummaryWorkflow({
      sessionId,
      input: params.input,
      intent,
      preferences: session.preferences,
      history,
      signal: params.signal,
    });
    return;
  }

  if (intent.tool === 'stock-analysis') {
    yield* streamStockAnalysisWorkflow({
      sessionId,
      input: params.input,
      intent,
      preferences: session.preferences,
      history,
      signal: params.signal,
    });
    return;
  }

  if (intent.tool === 'final-select' && /(scan|select|扫描|挑选|前\s*\d+|美股|股票|market|s\s*&\s*p\s*500|sp\s*500|标普\s*500|標普\s*500|nasdaq(?:\s*100)?|纳斯达克(?:\s*100)?|納斯達克(?:\s*100)?|纳指\s*100|納指\s*100)/i.test(params.input)) {
    yield* streamUsStockScanWorkflow({
      sessionId,
      input: params.input,
      preferences: session.preferences,
      signal: params.signal,
    });
    return;
  }

  /* ── Standard LangGraph pipeline for all other tools ────────────────── */
  const result = await orchestratorGraph.invoke({
    input: params.input,
    sessionId,
    preferences: session.preferences,
    history,
    intent,
    selectedTool: intent.tool as SelectedToolRoute,
    tasks: [],
    toolResult: null,
    response: '',
    agent: ORCHESTRATOR_AGENT,
    signal: params.signal,
  });
  throwIfAborted(params.signal);

  throwIfAborted(params.signal);
  const updatedSession = updatePreferences(
    sessionId,
    derivePreferenceUpdates(
      params.input,
      result.selectedTool,
      result.toolResult,
      session.preferences,
    ),
  );

  yield { type: 'tasks', tasks: result.tasks };

  const assistantMessage = createMessage({
    role: 'assistant',
    content: result.response,
    agent: result.agent,
  });

  for (const delta of chunkText(result.response)) {
    throwIfAborted(params.signal);
    yield { type: 'message', delta, agent: result.agent };
    await pause(35, params.signal);
  }

  throwIfAborted(params.signal);
  appendMessage(sessionId, assistantMessage);

  yield {
    type: 'done',
    message: assistantMessage,
    tasks: result.tasks,
    preferences: updatedSession.preferences,
  };
}
