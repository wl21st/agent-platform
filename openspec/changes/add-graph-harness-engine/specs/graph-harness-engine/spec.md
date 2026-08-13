## Purpose

Provides a graph-based agent harness engineering runtime with modular skills, heterogeneous multi-model subagent routing, lifecycle hooks, and an offline evaluation test engine.

## ADDED Requirements

### Requirement: Modular Skill Specification and Registry
The system SHALL support self-contained skill definitions that encapsulate Zod-validated tool definitions, task-specific system prompts, model binding configuration, and lifecycle hooks. The orchestrator SHALL dynamically discover and bind available skills without requiring modifications to centralized enum types or hardcoded intent classification prompts.

#### Scenario: Dynamic skill registration
- **WHEN** a new skill definition (e.g. `CosmeticsSafetySkill` or `StockAnalysisSkill`) is registered into the skill registry
- **THEN** the harness runtime SHALL make its tools and system instructions available for routing and execution without modifying global orchestrator files

#### Scenario: Schema validation on tool execution
- **WHEN** a subagent or reasoning node invokes a skill tool with input arguments
- **THEN** the skill runtime SHALL validate the arguments against the tool's Zod schema before execution and return structured validation errors if invalid

### Requirement: Graph-Based Harness State Machine
The system SHALL execute multi-agent interactions via a state graph engine that supports iterative ReAct loops, conditional branching, parallel fan-out/fan-in subagent execution, and state checkpointing.

#### Scenario: Multi-turn ReAct tool loop
- **WHEN** an agent decides to call one or more tools to answer a complex prompt
- **THEN** the state graph SHALL execute the tools, feed results back into the agent's context, and iterate until the agent produces a final synthesis or hits the configured step limit

#### Scenario: State checkpointing and error recovery
- **WHEN** a tool execution fails or encounters a recoverable error
- **THEN** the graph runtime SHALL capture the failure state, pass error feedback to the reflection node, and allow retry or graceful fallback

### Requirement: Heterogeneous Multi-Model Subagent Dispatching
The system SHALL allow individual subagents, skills, or graph nodes to be explicitly bound to different LLM providers or models (e.g. lightweight fast models for extraction and scraping, high-reasoning models for financial analysis and safety decisions).

#### Scenario: Independent model execution per subagent
- **WHEN** a complex workflow requires both web scraping and deep financial risk scoring
- **THEN** the scraping subagent SHALL execute using the fast/low-cost model while the risk scoring subagent executes using the high-reasoning model

#### Scenario: Provider fallback on rate limit or outage
- **WHEN** an LLM provider request fails with a rate limit or service error
- **THEN** the harness model dispatcher SHALL automatically retry or fall back to an alternate configured provider model

### Requirement: Lifecycle Hooks and Interceptors
The system SHALL provide extensible middleware interceptor hooks (`beforeModelCall`, `afterModelCall`, `beforeTool`, `afterTool`, `onStep`, `onError`) across all graph executions.

#### Scenario: Pre-execution tool guardrails
- **WHEN** an agent requests a sensitive or restricted tool execution
- **THEN** the `beforeTool` hook SHALL intercept the invocation and allow validation, sanitization, or rejection before execution occurs

#### Scenario: Structured OpenTelemetry tracing
- **WHEN** an agent workflow executes across multiple nodes and tools
- **THEN** the harness runtime SHALL emit structured trace events including token usage, step latency, and tool inputs/outputs

### Requirement: Offline Test and Evaluation Harness
The system SHALL provide a deterministic evaluation harness that executes skill trajectories against mock tool fixtures and scores outputs using automated metrics (tool sequence accuracy, schema conformance, hallucination checks) without requiring external live network access.

#### Scenario: Deterministic trajectory validation in CI
- **WHEN** `npm test` or a test runner executes a skill evaluation suite
- **THEN** the eval harness SHALL run the skill against recorded mock tool responses, verify the expected sequence of tool calls, and assert that all output scores meet defined thresholds

#### Scenario: Trajectory regression detection
- **WHEN** a prompt modification causes an agent to omit a required tool call or produce invalid arguments
- **THEN** the evaluation harness SHALL fail the test and report the exact trajectory divergence

### Requirement: Streaming Event Protocol Compatibility
The system SHALL stream graph state changes, intermediate tool progress, agent status transitions, and final markdown responses using the standard NDJSON stream protocol expected by the client UI.

#### Scenario: Real-time step progress streaming
- **WHEN** the graph enters a new node or starts executing a subagent tool
- **THEN** the harness SHALL emit typed stream events (`tasks`, `message`, `agent-done`, `done`, `error`) to keep the frontend updated in real-time

---

## Pending Design Questions & Decision Gates

### 1. Engine Foundation & Library Strategy
- **Option A (Recommended)**: Adopt `@mastra/core` (built on Vercel AI SDK) for unified graph workflows, built-in CI/CD eval scorers, and local dev studio.
- **Option B**: Build a custom Skill + Eval harness layer on top of `@langchain/langgraph` + Vercel AI SDK Core.
- *Status*: Open for confirmation during `design.md` creation.

### 2. State Checkpointing Storage
- **Option A (In-Memory / SQLite)**: Lightweight in-memory session checkpointing for development, with optional SQLite/file-based persistence for test replays.
- **Option B (Durable KV / Redis)**: Enterprise durable state store for long-lived asynchronous agent runs.
- *Status*: Defaulting to In-Memory with SQLite test fixture support for now.

### 3. Migration Phasing of Existing 12 Agents
- **Phase 1**: Core Harness Engine + Eval Runner + First pilot skill (e.g. Stock Analysis & Pullback Scan).
- **Phase 2**: Cosmetics Safety, Web & News Summarization Skills.
- **Phase 3**: Remaining utility skills (Weather, Search) and decommissioning of legacy `agentOrchestrator.ts`.
- *Status*: Phasing to be detailed in `design.md` and `tasks.md`.
