## Why

The current orchestration layer relies on hardcoded router enums, monolithic 1,500-line procedural files, single-shot intent parsing, and zero offline evaluation harnesses. Replacing this brittle pipeline with a graph-based harness engineering engine (inspired by Mastra, Pi.dev, and modern Agent SDKs) unlocks modular skills, heterogeneous multi-model subagents, lifecycle hooks, and deterministic CI/CD evaluation suites.

## What Changes

- **Graph-Based Harness Runtime**: Introduce a state-graph execution engine supporting cyclic ReAct loops, parallel subagent fan-out/fan-in, and pause/resume checkpoints.
- **Modular Skill Engine**: Standardize agent capabilities into self-contained Skill packages with Zod input/output schemas, system instructions, and isolated tool registries.
- **Heterogeneous Multi-Model Routing**: Enable individual subagents and skills to bind to their optimal model provider (e.g. lightweight models for scraping, reasoning models for risk/decision synthesis).
- **Harness Hooks & Observability**: Provide lifecycle interceptors (`beforeTool`, `afterTool`, `onStep`, `onError`) and structured OpenTelemetry tracing.
- **Offline Test & Eval Harness**: Implement deterministic trajectory testing, mock tool runners, and automated scoring fixtures runnable in standard CI.
- **BREAKING**: Replaces legacy `TOOL_REGISTRY` and hardcoded workflow generators in `agentOrchestrator.ts` with the new Graph Harness and Skill registry.

## Non-goals

- Implementing full multi-user authentication or cloud billing.
- Replacing the client-side Next.js React UI presentation layer.
- Relying on external cloud-only proprietary evaluation services (e.g. LangSmith Cloud); all evals must run locally and in CI.

## Capabilities

### New Capabilities
- `graph-harness-engine`: Core graph execution engine, modular skill definitions, heterogeneous multi-model dispatching, lifecycle hooks, and offline evaluation test harness.

### Modified Capabilities
None.

## Impact

- **Backend Architecture**: `backend/orchestrator/agentOrchestrator.ts`, `backend/agents/`, and `backend/llm/openai.ts` will be restructured around `backend/harness/` and `backend/skills/`.
- **Dependencies**: Adds `@mastra/core` (or Vercel AI SDK core dependencies) for multi-provider routing and evaluation scorers while leveraging TypeScript state machines.
- **API Contracts**: Preserves the existing `/api/chat` NDJSON streaming contract while upgrading intermediate step telemetry.
