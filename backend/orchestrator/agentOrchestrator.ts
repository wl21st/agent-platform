import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import {
  COSMETIC_SAFE_CHECK_AGENT,
  INGREDIENTS_SCRAPE_AGENT,
  ORCHESTRATOR_AGENT,
  chunkText,
  createMessage,
  type ConversationTurn,
  type AgentSummary,
  type StreamEvent,
  type TaskStatus,
  type UserPreferences,
  type WeatherContext,
} from '@/lib/agent-chat';
import { runCosmeticSafeCheckAgent } from '@backend/agents/cosmeticSafeCheckAgent';
import {
  buildCombinedScrapeAndSafetyResult,
  scrapeIngredientsOnly,
} from '@backend/agents/ingredientsScrapeAgent';
import {
  getToolDefinition,
  resolveToolRouteWithContext,
  type ToolRoute,
  type ToolExecutionResult,
} from '@backend/agents/toolAgents';
import {
  classifyUserIntent,
  generateAssistantResponse,
  type IntentClassification,
} from '@backend/llm/openai';
import {
  appendMessage,
  getOrCreateSession,
  updatePreferences,
} from '@backend/memory/sessionStore';

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
});

type OrchestratorStateType = typeof OrchestratorState.State;

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────────── */

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  // Try LLM-based intent classification first
  const llmIntent = await classifyUserIntent({
    input: state.input,
    history: state.history,
    preferences: state.preferences,
  });

  if (llmIntent) {
    const selectedTool: SelectedToolRoute = llmIntent.tool;
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
  const response = await generateAssistantResponse({
    input: state.input,
    toolResult: state.toolResult,
    preferences: state.preferences,
    history: state.history,
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
}): AsyncGenerator<StreamEvent> {
  const { sessionId, input, intent, preferences, history } = params;

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

  yield { type: 'tasks', tasks };

  /* ── Step 2: Run Ingredients Scrape Agent ────────────────────────────── */
  const toolContext = {
    input,
    preferences,
    extractedUrl: intent.url || undefined,
  };

  const scrapeResult = await scrapeIngredientsOnly(toolContext);

  tasks = markTask(tasks, 'ingredients-scrape-tool', scrapeResult.ingredientText ? 'completed' : 'failed');
  yield { type: 'tasks', tasks };

  /* ── Emit the scrape result as its own chat bubble ──────────────────── */
  const scrapeMessage = createMessage({
    role: 'assistant',
    content: scrapeResult.toolResult.markdown,
    agent: INGREDIENTS_SCRAPE_AGENT,
    status: 'done',
  });
  appendMessage(sessionId, scrapeMessage);
  yield { type: 'agent-done', message: scrapeMessage };

  if (!scrapeResult.ingredientText) {
    /* ── No ingredients found — skip safety check ─────────────────────── */
    tasks = markTask(tasks, 'cosmetic-safe-check-sub', 'failed');
    tasks = markTask(tasks, 'compose-response', 'completed');
    yield { type: 'tasks', tasks };

    const updatedSession = updatePreferences(
      sessionId,
      derivePreferenceUpdates(input, 'ingredients-scrape', scrapeResult.toolResult, preferences),
    );

    const failMessage = createMessage({
      role: 'assistant',
      content: 'No ingredients were found on the page, so the safety analysis could not be performed. Please try a different URL or provide the ingredients manually.',
      agent: ORCHESTRATOR_AGENT,
    });
    appendMessage(sessionId, failMessage);

    for (const delta of chunkText(failMessage.content)) {
      yield { type: 'message', delta, agent: ORCHESTRATOR_AGENT };
      await pause(35);
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
  });

  tasks = markTask(tasks, 'compose-response', 'completed');
  yield { type: 'tasks', tasks };

  /* ── Step 5: Update preferences ─────────────────────────────────────── */
  const combinedToolResult = buildCombinedScrapeAndSafetyResult(scrapeResult, safetyResult);
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
    yield { type: 'message', delta, agent: COSMETIC_SAFE_CHECK_AGENT };
    await pause(35);
  }

  appendMessage(sessionId, assistantMessage);

  yield {
    type: 'done',
    message: assistantMessage,
    tasks,
    preferences: updatedSession.preferences,
  };
}

/**
 * Main streaming entry point. Routes to the appropriate workflow:
 * - `ingredients-scrape` → two-step workflow with intermediate task streaming
 * - Everything else → standard LangGraph pipeline
 */
export async function* streamOrchestratorSession(params: {
  sessionId?: string;
  input: string;
}): AsyncGenerator<StreamEvent> {
  const sessionId = params.sessionId || crypto.randomUUID();
  const session = getOrCreateSession(sessionId);

  const sessionWithUserMessage = appendMessage(
    sessionId,
    createMessage({
      role: 'user',
      content: params.input,
    }),
  );

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
  });

  const intent: IntentClassification = llmIntent || {
    tool: resolveToolRouteWithContext({
      input: params.input,
      preferences: session.preferences,
    }),
    isFollowUp: !llmIntent && session.history.length > 1,
  };

  /* ── Route to the appropriate workflow ───────────────────────────────── */
  if (intent.tool === 'ingredients-scrape') {
    yield* streamIngredientsScrapeWorkflow({
      sessionId,
      input: params.input,
      intent,
      preferences: session.preferences,
      history,
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
    selectedTool: intent.tool,
    tasks: [],
    toolResult: null,
    response: '',
    agent: ORCHESTRATOR_AGENT,
  });

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
    yield { type: 'message', delta, agent: result.agent };
    await pause(35);
  }

  appendMessage(sessionId, assistantMessage);

  yield {
    type: 'done',
    message: assistantMessage,
    tasks: result.tasks,
    preferences: updatedSession.preferences,
  };
}
