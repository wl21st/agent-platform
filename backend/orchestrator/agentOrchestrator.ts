import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import {
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

  const result = await orchestratorGraph.invoke({
    input: params.input,
    sessionId,
    preferences: session.preferences,
    history: sessionWithUserMessage.history.map((message) => ({
      role: message.role,
      content: message.content,
      agentName: message.agent?.name,
      timestamp: message.timestamp,
    })),
    intent: { tool: 'none', isFollowUp: false },
    selectedTool: 'none',
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
