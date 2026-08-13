# Technical Architecture & Handoff Report: Graph-Based Harness Engineering Engine

> **Document Status**: Complete Architecture & Exploration Handoff  
> **Target Change**: `openspec/changes/add-graph-harness-engine/`  
> **Associated OpenSpec Artifacts**:
> * Proposal: [proposal.md](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/openspec/changes/add-graph-harness-engine/proposal.md)
> * Delta Specification: [spec.md](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/openspec/changes/add-graph-harness-engine/specs/graph-harness-engine/spec.md)

---

## 1. Executive Summary & Key Takeaways

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CORE ARCHITECTURE VERDICT                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Current State: Fragile 1,517-line router, hardcoded regexes, zero offline tests.        │
│ 2. Winning Target: Mastra-style Graph Harness Engine (or Claude SDK + LiteLLM Proxy).       │
│ 3. Skills Standard: All 12 agents converted into self-contained, Zod-typed Skill packages.  │
│ 4. Heterogeneous Models: Cheap fast models (Flash/Haiku) for scrape, Sonnet/R1 for reason. │
│ 5. Memory Engine: 4-tier memory (Scratchpad, Sliding Turns, Tree Checkpoints, Semantic KV).│
│ 6. Sandboxing: Multi-level execution isolation (Zod bounds, Worker threads, Docker/e2b).    │
│ 7. Offline CI Evals: Deterministic mock fixtures + trajectory assertions in CI/CD.         │
│ 8. Migration: 4-phase rollout preserving 100% backward compatibility with /api/chat stream. │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

The current `agent-platform` codebase coordinates 12+ specialized agents via a monolithic, 1,517-line orchestrator ([agentOrchestrator.ts](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/backend/orchestrator/agentOrchestrator.ts)) and a 960-line LLM interface ([openai.ts](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/backend/llm/openai.ts)). While functional for linear demos, this architecture is fragile:
* Adding a single capability requires touching 6–8 disparate files.
* Execution is single-shot and rigid; agents cannot perform iterative ReAct loops, self-correct bad tool calls, or dynamically spawn subagents.
* There is zero offline testability or deterministic trajectory evaluation; tests depend on live network calls to third-party endpoints.

This report establishes the blueprint for migrating to a **Graph-Based Harness Engineering Engine**. It provides a comprehensive analysis of modern open-source agent frameworks (**Mastra**, **Pi.dev**, **Anthropic Claude Agent SDK**, **OpenAI Agents SDK**, and **LangGraph.js**), their 3rd-party LLM proxy capabilities, memory architectures, sandboxing tiers, and offline evaluation harnesses.

---

## 2. Key Questions & Decision Gates

Before commencing Phase 1 implementation under `design.md`, the following strategic and technical decisions must be aligned:

### 1. Framework Foundation: Mastra vs. Claude SDK (via LiteLLM) vs. Custom Graph
* **Option A (Recommended: Mastra `@mastra/core`)**:
  - *URL*: [github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra) (25k+ stars, 400+ contributors, Apache 2.0).
  - *Benefits*: Native TypeScript-first framework. Bundles graph state-machine workflows, built-in CI/CD eval scorers, Vercel AI SDK multi-model support, memory threads, and local `Mastra Studio` UI out of the box.
* **Option B (Claude Agent SDK via LiteLLM / OpenRouter Proxy)**:
  - *URL*: [docs.anthropic.com/en/docs/agents-and-tools/claude-code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code) (`claude-agent-sdk`).
  - *Benefits*: Battle-tested context compaction and MCP integration from Claude Code. With `ANTHROPIC_BASE_URL` pointing to LiteLLM / OpenRouter, it can route across OpenAI, Gemini, and DeepSeek models.
  - *Trade-off*: Non-graph workflow execution; requires running a local LiteLLM proxy container.
* **Option C (Custom Graph on `@langchain/langgraph` + Vercel AI SDK Core)**:
  - *Benefits*: Zero new runtime framework dependencies; utilizes existing `@langchain/langgraph` in `package.json`.
  - *Trade-off*: We must hand-roll the offline eval scorer engine and visual debugging harness.
* **Decision Gate**: Choose between full framework adoption (**Option A**), proxy-backed Claude harness (**Option B**), or custom graph kernel (**Option C**).

### 2. Multi-Model Proxy & Key Infrastructure
* **Option A (OpenRouter Unified Gateway)**:
  - Single `LLM_API_KEY` with OpenRouter endpoint (`https://openrouter.ai/api/v1`). Provides instant access to 200+ models (Claude 3.7 Sonnet, GPT-4o, Gemini 2.0 Flash, DeepSeek-R1) with unified billing and zero credential sprawl.
* **Option B (LiteLLM Proxy Middleware)**:
  - Run LiteLLM as an in-process or sidecar proxy translating Anthropic/OpenAI API formats across local vLLM/Ollama and cloud providers.
* **Option C (Direct Multi-Provider SDKs)**:
  - Separate API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).
* **Decision Gate**: OpenRouter (**Option A**) is currently configured in `.env` and represents the cleanest path.

### 3. Memory & Chat History Architecture
* **Working Memory**: Transient graph scratchpad for intermediate tool observations.
* **Sliding Conversation Buffer**: Rolling window with automated token compaction when history exceeds 75% of context limits.
* **Tree-Structured Session Checkpointing**: Pi.dev-style tree branching allowing rollback, alternative branches, and parallel sub-conversations.
* **Semantic User Memory**: Key-value preference store (`UserPreferences`) with vector embeddings for long-term user personalization.

### 4. Sandboxing & Tool Isolation Level
* **Level 1 (In-Process Zod Validation + AbortController Timeouts)**: Mandatory for all tools.
* **Level 2 (Worker Threads / Node VM Isolation)**: For dynamic code evaluation and untrusted scripts.
* **Level 3 (Filesystem & Command Scoping)**: Strict path allowlists and command denylists.
* **Level 4 (Container Sandboxes - e2b / Docker)**: For external web scraping tasks.

### 5. Skill Migration Phasing & Pilot Scope
* **Pilot Skill Scope**: Start with the **Stock Analysis & Pullback Screening Skill** (highest complexity, tests multi-tool data pipelines) or **Cosmetics Safety Check Skill** (tests deep chemical reasoning and deterministic toxicology tables).

---

## Table of Contents
1. [Executive Summary & Key Takeaways](#1-executive-summary--key-takeaways)
2. [Key Questions & Decision Gates](#2-key-questions--decision-gates)
3. [Framework Background & Open Source Ecosystem Investigation](#3-framework-background--open-source-ecosystem-investigation)
4. [3rd-Party LLM API Proxying (Claude SDK, OpenAI SDK, OpenRouter, LiteLLM)](#4-3rd-party-llm-api-proxying-claude-sdk-openai-sdk-openrouter-litellm)
5. [Comprehensive Memory & Chat History Architecture](#5-comprehensive-memory--chat-history-architecture)
6. [Multi-Level Execution Sandboxing Architecture](#6-multi-level-execution-sandboxing-architecture)
7. [Universal Graph-Based Harness Architecture](#7-universal-graph-based-harness-architecture)
8. [The Modular Skill Engineering Standard](#8-the-modular-skill-engineering-standard)
9. [Heterogeneous Multi-Model Routing Strategy](#9-heterogeneous-multi-model-routing-strategy)
10. [Cross-Cutting Middleware, Hooks & Observability](#10-cross-cutting-middleware-hooks--observability)
11. [3-Tier Offline Evaluation & Testing Engine](#11-3-tier-offline-evaluation--testing-engine)
12. [Frontend Streaming Contract & Backward Compatibility](#12-frontend-streaming-contract--backward-compatibility)
13. [Phased Migration & Implementation Roadmap](#13-phased-migration--implementation-roadmap)
14. [Reference Links & OpenSpec Artifacts](#14-reference-links--openspec-artifacts)

---

## 3. Framework Background & Open Source Ecosystem Investigation

```
                            FRAMEWORK ECOSYSTEM OVERVIEW
┌─────────────────┬──────────────────────┬─────────────┬──────────────┬───────────────────────────┐
│ Framework       │ GitHub Repository    │ Stars / Com.│ License      │ Primary Packages          │
├─────────────────┼──────────────────────┼─────────────┼──────────────┼───────────────────────────┤
│ Mastra          │ mastra-ai/mastra     │ 25,000+ /400│ Apache 2.0   │ @mastra/core, @mastra/eval│
│ Pi.dev Core     │ earendil-works/pi    │ Growing/Ind.│ MIT          │ @earendil-works/pi-agent  │
│ Claude Agent SDK│ anthropic/claude-code│ Official CLI│ Proprietary/ │ claude-agent-sdk (npm/pip)│
│ OpenAI Agents   │ openai/openai-agents │ Official SDK│ MIT          │ @openai/agents            │
│ LangGraph.js    │ langchain-ai/lang... │ 12,000+ /250│ MIT          │ @langchain/langgraph      │
└─────────────────┴──────────────────────┴─────────────┴──────────────┴───────────────────────────┘
```

### 3.1 Mastra (`@mastra/core`)
* **Repository**: [https://github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra)
* **Official Website & Docs**: [https://mastra.ai](https://mastra.ai)
* **Ecosystem Maturity**: 25,000+ GitHub stars, 400+ contributors, backed by substantial open-source venture investment.
* **Core Philosophy**: A unified, production-grade TypeScript AI agent framework. Mastra replaces the need to stitch together separate prompt managers, vector databases, state machines, and eval suites.
* **Dependent Open Source Modules**:
  - `@mastra/core`: Core agent loops, workflows, and state machines.
  - `@mastra/evals`: Automated scoring fixtures (Hallucination, Tool Selection, Relevance).
  - `@mastra/memory`: Semantic and thread-based long-term conversation memory.
  - `@mastra/rag`: Vector search and chunking pipeline.
  - `@mastra/engine`: Embedded SQLite/LibSQL storage layer.
* **Production Readiness**: High. Fully typed in TypeScript, zero Python dependency, native Next.js/Fastify integration.

### 3.2 Pi.dev (`@earendil-works/pi-agent-core`)
* **Repository & Docs**: [https://pi.dev](https://pi.dev)
* **Packages**: `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`
* **Core Philosophy**: Extreme minimalism and anti-monolithic design. Created by Mario Zupan and the Earendil team as a flexible, hacker-friendly agent kernel.
* **Key Innovation**: **Session Trees** (modeling conversations as branchable DAGs rather than linear arrays) and `pi-ai` (a universal multi-provider client supporting 15+ providers including local `llama.cpp`).
* **Production Readiness**: Excellent for CLI tools and custom lightweight runners; lacks built-in CI/CD eval scoring suites.

### 3.3 Anthropic Claude Agent SDK (`claude-agent-sdk`)
* **Official Documentation**: [https://docs.anthropic.com/en/docs/agents-and-tools/claude-code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)
* **Packages**: `claude-agent-sdk` (TypeScript npm / Python pip)
* **Core Philosophy**: Exposes the high-performance agent runtime powering Anthropic's **Claude Code** CLI for programmatic integration into custom applications.
* **Key Strengths**: Industry-standard context compaction engine, Model Context Protocol (MCP) tool harness, bash/file sandboxing, and rich lifecycle hooks (`beforeToolCall`, `afterToolCall`, `onCompaction`).
* **Multi-Model Capability**: Can route through 3rd-party proxies via `ANTHROPIC_BASE_URL` (see Section 4).

### 3.4 OpenAI Agents SDK (`@openai/agents`)
* **Repository**: [https://github.com/openai/openai-agents-python](https://github.com/openai/openai-agents-python) / [https://github.com/openai/openai-agents-js](https://github.com/openai/openai-agents-js)
* **Official Docs**: [https://openai.github.io/openai-agents-python/](https://openai.github.io/openai-agents-python/)
* **Core Philosophy**: The production-grade evolution of OpenAI Swarm. Provides lightweight `Agent` primitives with typed tools, multi-agent `handoff()`, and guardrail interceptors.
* **Production Readiness**: Good for handoff-based swarms, but lacks state reducers and offline trajectory eval suites.

### 3.5 LangGraph.js (`@langchain/langgraph`)
* **Repository**: [https://github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) (Already installed in repo)
* **Official Docs**: [https://langchain-ai.github.io/langgraphjs/](https://langchain-ai.github.io/langgraphjs/)
* **Core Philosophy**: General-purpose cyclic state graph computation engine.
* **Key Strengths**: Deep checkpointing, state reducers, time-travel debugging, and `interrupt()` human approval gates.

---

## 4. 3rd-Party LLM API Proxying (Claude SDK, OpenAI SDK, OpenRouter, LiteLLM)

A critical architectural discovery is that both **Anthropic Claude Agent SDK** and **OpenAI Agents SDK** can be decoupled from first-party cloud lock-in using **3rd-party LLM API Proxies**:

```
                              LLM PROXY ROUTING ARCHITECTURE
┌──────────────────────────────┐                ┌───────────────────────────────────────────┐
│ Agent Harness Engine         │                │ 3rd-Party LLM API Proxy                   │
│                              │                │                                           │
│ ┌──────────────────────────┐ │                │  ┌──────────────────────────────────────┐ │
│ │ Claude Agent SDK Runtime │ ┼── ANTHROPIC ──▶│  │ OpenRouter / LiteLLM Gateway         │ │
│ │ (or Mastra / OpenAI SDK) │ │   BASE_URL     │  │ (Translates schemas & routes models) │ │
│ └──────────────────────────┘ │                │  └──────────────────┬───────────────────┘ │
└──────────────────────────────┘                └─────────────────────┼─────────────────────┘
                                                                      │
                                        ┌─────────────────────────────┼─────────────────────────────┐
                                        ▼                             ▼                             ▼
                            ┌───────────────────────┐     ┌───────────────────────┐     ┌───────────────────────┐
                            │ Google Gemini 2 Flash │     │ DeepSeek-R1 / V3      │     │ Claude 3.7 / GPT-4o   │
                            │ (Fast Scraping Tier)  │     │ (Deep Reasoning Tier) │     │ (Synthesis Tier)      │
                            └───────────────────────┘     └───────────────────────┘     └───────────────────────┘
```

### 4.1 Claude Agent SDK Proxy Setup via `ANTHROPIC_BASE_URL`
The Claude Agent SDK honors standard Anthropic environment variables:
```typescript
// Example: Configuring Claude Agent SDK with OpenRouter / LiteLLM Proxy
import { ClaudeAgent } from 'claude-agent-sdk';

const agent = new ClaudeAgent({
  env: {
    ANTHROPIC_BASE_URL: process.env.LLM_API_BASE_URL || 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: process.env.LLM_API_KEY,
    ANTHROPIC_API_KEY: '', // Leave blank when using OpenRouter bearer token
  },
  model: 'anthropic/claude-3.7-sonnet', // or 'google/gemini-2.0-flash'
});
```

### 4.2 LiteLLM Translation Layer
When using **LiteLLM** as an intermediary proxy (`http://localhost:4000`), LiteLLM accepts Anthropic Claude tool-use formatting from the SDK and translates it into OpenAI / Gemini / DeepSeek tool-call JSON schemas on the fly.

### 4.3 Mastra Native Multi-Model Abstraction (Vercel AI SDK Core)
Mastra eliminates the need for proxy translation by natively using the Vercel AI SDK provider ecosystem:
```typescript
import { Agent } from '@mastra/core';
import { createOpenAI } from '@ai-sdk/openai';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.LLM_API_KEY,
});

export const scraperAgent = new Agent({
  name: 'News Scraper',
  model: openrouter('google/gemini-2.0-flash'),
  instructions: 'Extract structured stock news from raw HTML.',
});
```

---

## 5. Comprehensive Memory & Chat History Architecture

```
                              4-TIER MEMORY ARCHITECTURE
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Working Memory (Scratchpad)                                                              │
│    - Ephemeral in-memory state during a single graph cycle.                                 │
│    - Holds raw tool payloads, temporary HTML buffers, and step plans.                       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. Short-Term Conversation Memory (Sliding Buffer + Auto-Compaction)                         │
│    - Chronological turns: [{ role: 'user', content: '...' }, { role: 'tool', ... }]         │
│    - Context Compactor: Truncates or summarizes tool buffers when tokens exceed 75% budget. │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. Tree-Structured Session Checkpoints (Pi.dev Pattern)                                     │
│    - Sessions stored as DAG/Trees rather than flat arrays.                                  │
│    - Enables branching ("explore alternative stock setup"), rollbacks, and parallel forks.  │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4. Long-Term Semantic & User Preference Store (Mastra Memory Engine)                        │
│    - Key-value attributes: preferredWeatherLocation, riskTolerance, favoriteTickers.        │
│    - Vector embeddings for cross-session knowledge recall and RAG.                          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Memory Context Compactor Implementation
When conversational histories grow large, the Context Compactor replaces verbose tool outputs with concise structured summaries:
```typescript
// backend/harness/memory/contextCompactor.ts
export function compactHistory(history: MessageTurn[], maxTokens: number): MessageTurn[] {
  const currentTokenEstimate = estimateTokens(history);
  if (currentTokenEstimate <= maxTokens * 0.75) {
    return history;
  }

  return history.map((turn) => {
    // Retain user queries and assistant final responses verbatim
    if (turn.role === 'user' || (turn.role === 'assistant' && !turn.toolCallId)) {
      return turn;
    }
    // Summarize verbose tool execution payloads
    if (turn.role === 'tool' && turn.content.length > 500) {
      return {
        ...turn,
        content: `[Compacted Tool Result: ${turn.name} returned ${turn.content.slice(0, 200)}... (truncated)]`,
      };
    }
    return turn;
  });
}
```

---

## 6. Multi-Level Execution Sandboxing Architecture

To prevent runaway loops, unvalidated inputs, or untrusted script execution, the harness implements **4 Sandboxing Tiers**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 1: In-Process Zod Validation & AbortController Bounds (Mandatory)                     │
│ - Every tool input is strictly validated against a Zod schema before execution.             │
│ - Every execution is bound to an AbortSignal with a strict timeout (e.g. 15s).              │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ LEVEL 2: Node Worker Threads / VM Isolation                                                 │
│ - Mathematical evaluations, indicators, and custom user scripts execute in isolated VMs.   │
│ - Memory allocation capped at 128MB per worker with zero access to Node global scope.       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ LEVEL 3: Filesystem & Shell Path Scoping (Claude Code / Codex Style)                         │
│ - Read/write boundaries locked strictly to `<workspace>/scratch/` and configured roots.     │
│ - Shell execution blocked by default; destructive commands require Human Approval Gates.    │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ LEVEL 4: Ephemeral Container Sandboxes (e2b / Docker)                                        │
│ - Dynamic headless Puppeteer scraping runs in isolated container sandboxes.                 │
│ - Prevents host network poisoning and resource exhaustion.                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Universal Graph-Based Harness Architecture

The new architecture unifies all capabilities under an autonomous **State Graph Engine**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 GRAPH HARNESS RUNTIME ENGINE                                │
│                                                                                             │
│  USER QUERY                                                                                 │
│      │                                                                                      │
│      ▼                                                                                      │
│ ┌──────────────────────────────────────────────┐                                            │
│ │ 1. Intent & Skill Matcher Node               │ ── Model: Gemini 2.0 Flash / GPT-4.1 Mini  │
│ │    (Extracts parameters & binds Zod tools)   │    (Latency: < 400ms)                      │
│ └──────────────────────┬───────────────────────┘                                            │
│                        │                                                                    │
│                        ▼                                                                    │
│ ┌──────────────────────────────────────────────┐                                            │
│ │ 2. Agent ReAct Reasoner Node                 │◀──────────────────────────────────────┐    │
│ │    (Iterative planning & tool dispatch)      │                                       │    │
│ └──────────────────────┬───────────────────────┘                                       │    │
│                        │ Tool Calls                                                    │    │
│                        ▼                                                               │    │
│ ┌──────────────────────────────────────────────┐                                       │    │
│ │ 3. Tool Sandbox & Execution Node             │                                       │    │
│ │    ├─ Hook: beforeTool (Guardrails & HITL)   │                                       │    │
│ │    ├─ Subagent Dispatch (Isolated Context)   │                                       │    │
│ │    ├─ Execution (Deterministic / Network)    │                                       │    │
│ │    └─ Hook: afterTool (Sanitization/Compact) │                                       │    │
│ └──────────────────────┬───────────────────────┘                                       │    │
│                        │ Observations & Tool Results                                   │    │
│                        ▼                                                               │    │
│ ┌──────────────────────────────────────────────┐                                       │    │
│ │ 4. Reflection & Critic Node                  │                                       │    │
│ │    (Detects empty hits, schema errors, or    │─── Requires another step ─────────────┘    │
│ │     divergent trajectories; triggers retry)  │                                            │
│ └──────────────────────┬───────────────────────┘                                            │
│                        │ Trajectory Complete / Max Steps Reached                            │
│                        ▼                                                                    │
│ ┌──────────────────────────────────────────────┐                                            │
│ │ 5. Response Synthesizer Node                 │ ── Model: Claude 3.7 Sonnet / GPT-4o       │
│ │    (Generates final structured markdown)     │    (High-precision multi-source synthesis) │
│ └──────────────────────┬───────────────────────┘                                            │
│                        │                                                                    │
│                        ▼                                                                    │
│               NDJSON Client Stream (step_start, tool_call, message, done)                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. The Modular Skill Engineering Standard

Every capability in the system is structured as an isolated **Skill Package**:

```
backend/skills/
├── types.ts                     # Universal Skill & Tool interfaces
├── registry.ts                  # Central Skill Registry
├── stockAnalysis/               # Example: Stock Analysis Skill
│   ├── skill.config.ts          # Metadata, model selection & system instructions
│   ├── prompt.ts                # Domain-specific prompt templates
│   ├── tools/                   # Isolated Zod-validated tool definitions
│   │   ├── liquidityTool.ts
│   │   ├── pullbackScreenTool.ts
│   │   └── financialSummaryTool.ts
│   ├── interceptors.ts          # Skill-specific safety guardrails
│   └── evals/                   # Deterministic offline evaluation fixtures
│       ├── datasets.json        # Golden input/output trajectory test cases
│       └── stockSkill.eval.ts   # Automated runner
├── cosmeticsSafety/
├── newsIntelligence/
└── weatherUtility/
```

### 8.1 Skill Definition Interface

```typescript
// backend/skills/types.ts
import { z } from 'zod';

export interface SkillTool<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = unknown> {
  name: string;
  description: string;
  schema: TInput;
  execute: (args: z.infer<TInput>, context: SkillExecutionContext) => Promise<TOutput>;
}

export interface SkillExecutionContext {
  sessionId: string;
  modelOverride?: string;
  emitStreamEvent: (event: unknown) => void;
  signal?: AbortSignal;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  model: {
    provider: 'openai' | 'anthropic' | 'google' | 'openrouter';
    modelName: string;
    temperature?: number;
    maxTokens?: number;
  };
  systemPrompt: string;
  tools: Record<string, SkillTool>;
  hooks?: {
    beforeTool?: (toolName: string, args: unknown) => Promise<void>;
    afterTool?: (toolName: string, result: unknown) => Promise<unknown>;
  };
}
```

---

## 9. Heterogeneous Multi-Model Routing Strategy

```
                               MODEL ALLOCATION TIERS
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Low-Latency Extractors (Sub-500ms, Cheap Token Cost)                            │
│ Models: Gemini 2.0 Flash, GPT-4.1 Mini, Claude 3.5 Haiku                                │
│ Tasks: Intent classification, HTML/News scraping, parameter extraction                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: Deterministic Logic (0ms LLM Latency, $0 Cost, 0% Hallucination)                 │
│ Engine: Native TypeScript, Fastify helpers, Yahoo Finance API, Math formulas            │
│ Tasks: DMA calculations, RSI indicators, liquidity volume filters                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: Deep Domain Reasoning & Toxicological Analysis                                  │
│ Models: Claude 3.7 Sonnet, DeepSeek-R1, GPT-4o                                          │
│ Tasks: Chemical interaction analysis (Cosmetics), multi-factor investment risk scoring  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: Strategy Synthesis & Multi-Source Reconciliation                                │
│ Models: Claude 3.7 Sonnet, GPT-4o                                                       │
│ Tasks: Final markdown report generation, reconciling conflicting news vs technical data│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Cross-Cutting Middleware, Hooks & Observability

```typescript
// backend/harness/middleware.ts
export interface HarnessMiddleware {
  onSessionStart?: (state: HarnessState) => Promise<void>;
  beforeModelCall?: (params: { model: string; messages: unknown[] }) => Promise<void>;
  afterModelCall?: (params: { model: string; output: unknown; usage: TokenUsage }) => Promise<void>;
  beforeTool?: (params: { toolName: string; args: unknown }) => Promise<{ proceed: boolean; error?: string }>;
  afterTool?: (params: { toolName: string; result: unknown }) => Promise<unknown>;
  onStep?: (state: HarnessState) => Promise<void>;
  onError?: (error: Error, state: HarnessState) => Promise<void>;
  onSessionEnd?: (state: HarnessState) => Promise<void>;
}
```

---

## 11. 3-Tier Offline Evaluation & Testing Engine

```
                       EVALUATION HARNESS PYRAMID
                     ┌─────────────────────────────┐
                     │   Tier 3: CI Eval Scorers   │  ◄── Evaluates Hallucination,
                     │    (Offline LLM-as-Judge)   │      Relevance, Safety
                     ├─────────────────────────────┤
                     │ Tier 2: Trajectory Replays  │  ◄── Verifies exact tool call
                     │     (Mock Tool Fixtures)    │      sequences and arguments
                     ├─────────────────────────────┤
                     │   Tier 1: Zod Schema Units  │  ◄── Fast offline parser and
                     │     (Pure TypeScript)       │      input validation tests
                     └─────────────────────────────┘
```

### Example Trajectory Test Spec
```typescript
// backend/skills/stockAnalysis/evals/stockAnalysis.eval.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTrajectoryEval } from '@/backend/harness/evalRunner';
import { StockAnalysisSkill } from '../skill.config';

describe('StockAnalysisSkill - Trajectory Benchmark', () => {
  it('executes pullback scan with exact tool sequence and valid arguments', async () => {
    const evalResult = await runTrajectoryEval({
      skill: StockAnalysisSkill,
      input: 'Scan NASDAQ for liquid pullback stocks with RSI < 40',
      mockFixtures: {
        liquidityFilter: {
          inputMatch: { universe: 'nasdaq' },
          output: [{ ticker: 'NVDA', avgVolume: 60000000, price: 125.5 }],
        },
        pullbackScreen: {
          inputMatch: { ticker: 'NVDA' },
          output: [{ ticker: 'NVDA', rsi: 38.2, dma50: 120.0, passed: true }],
        },
      },
      expectedTrajectory: [
        { tool: 'liquidityFilter', matchArgs: { universe: 'nasdaq' } },
        { tool: 'pullbackScreen', matchArgs: { ticker: 'NVDA' } },
      ],
      scorers: ['trajectory-exact', 'schema-validation', 'no-hallucinated-tickers'],
    });

    assert.equal(evalResult.passed, true);
    assert.equal(evalResult.scores['trajectory-exact'], 1.0);
    assert.equal(evalResult.scores['schema-validation'], 1.0);
  });
});
```

---

## 12. Frontend Streaming Contract & Backward Compatibility

The Next.js App Router client (`src/app/`) currently consumes newline-delimited JSON (NDJSON) over `POST /api/chat`. The new harness maintains 100% backward compatibility with this contract:

```typescript
export type StreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'tasks'; tasks: TaskStatus[] }
  | { type: 'step-start'; stepIndex: number; name: string }
  | { type: 'tool-call'; toolName: string; args: unknown; agent: AgentSummary }
  | { type: 'tool-result'; toolName: string; summary: string; agent: AgentSummary }
  | { type: 'approval-request'; id: string; action: string; metadata: unknown }
  | { type: 'message'; delta: string; agent?: AgentSummary }
  | { type: 'agent-done'; message: ChatMessage }
  | { type: 'done'; message: ChatMessage; tasks: TaskStatus[]; preferences: UserPreferences }
  | { type: 'error'; message: string };
```

---

## 13. Phased Migration & Implementation Roadmap

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Harness Foundation, Memory Engine & Eval Runner                    │
│ ├─ Install @mastra/core (or Vercel AI SDK core dependencies)                │
│ ├─ Build backend/harness/ (State Graph, Memory Compactor, Sandbox VM)       │
│ └─ Build backend/harness/evalRunner.ts (Trajectory & Mock Fixture Runner)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Pilot Skill Migration (Stock Analysis & Pullback Screening)        │
│ ├─ Port liquidity, screening, and decision logic to backend/skills/stock/   │
│ ├─ Write Zod tool schemas and offline trajectory eval suites                │
│ └─ Wire /api/chat adapter to run pilot skill through Graph Harness          │
├─────────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Domain Skills Migration                                            │
│ ├─ Port Cosmetics Safety Check to backend/skills/cosmetics/                 │
│ ├─ Port News Scraping & Webpage Summarization to backend/skills/research/   │
│ └─ Port Weather and Search utility skills                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: Deprecation & Decommissioning                                      │
│ ├─ Decommission backend/orchestrator/agentOrchestrator.ts (1,517 lines)     │
│ ├─ Remove hardcoded regex routing in backend/agents/toolAgents.ts           │
│ ├─ Run full CI offline eval regression test suite                           │
│ └─ Sync and archive OpenSpec change add-graph-harness-engine                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 14. Reference Links & OpenSpec Artifacts

### 14.1 Open-Source Framework Repositories & Official Docs
* **Mastra Framework**:
  - GitHub: [https://github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra)
  - Documentation: [https://mastra.ai](https://mastra.ai)
  - Workflow State Machines: [https://mastra.ai/docs/workflows](https://mastra.ai/docs/workflows)
  - CI/CD Evals & Scorers: [https://mastra.ai/docs/evals](https://mastra.ai/docs/evals)
  - Memory Engine: [https://mastra.ai/docs/memory](https://mastra.ai/docs/memory)
* **Pi.dev Agent Core**:
  - Official Website & Docs: [https://pi.dev](https://pi.dev)
  - npm Package: [@earendil-works/pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
  - Multi-Model Library: [@earendil-works/pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)
* **Anthropic Claude Agent SDK & Claude Code**:
  - Claude Code CLI & Agent Documentation: [https://docs.anthropic.com/en/docs/agents-and-tools/claude-code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)
  - Model Context Protocol (MCP): [https://modelcontextprotocol.io](https://modelcontextprotocol.io)
* **OpenAI Agents SDK**:
  - Python SDK Repository: [https://github.com/openai/openai-agents-python](https://github.com/openai/openai-agents-python)
  - TypeScript SDK Repository: [https://github.com/openai/openai-agents-js](https://github.com/openai/openai-agents-js)
  - Documentation: [https://openai.github.io/openai-agents-python/](https://openai.github.io/openai-agents-python/)
* **LangGraph.js Engine**:
  - GitHub Repository: [https://github.com/langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)
  - Documentation: [https://langchain-ai.github.io/langgraphjs/](https://langchain-ai.github.io/langgraphjs/)
* **Vercel AI SDK Core**:
  - Official Documentation: [https://sdk.vercel.ai/docs](https://sdk.vercel.ai/docs)

### 14.2 Multi-Model Gateway & Proxy Infrastructure
* **OpenRouter**: [https://openrouter.ai/docs](https://openrouter.ai/docs) (Unified API endpoint for 200+ models)
* **LiteLLM Proxy**: [https://github.com/BerriAI/litellm](https://github.com/BerriAI/litellm) | [https://docs.litellm.ai/docs/proxy/quick_start](https://docs.litellm.ai/docs/proxy/quick_start)

### 14.3 OpenSpec Artifacts & Local Files
* **OpenSpec Change Proposal**: [proposal.md](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/openspec/changes/add-graph-harness-engine/proposal.md)
* **OpenSpec Delta Spec**: [spec.md](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/openspec/changes/add-graph-harness-engine/specs/graph-harness-engine/spec.md)
* **Universal Statusline Script**: [statusline-command.sh](file:///Users/I073228/.claude/statusline-command.sh)
* **Legacy Orchestrator**: [backend/orchestrator/agentOrchestrator.ts](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/backend/orchestrator/agentOrchestrator.ts)
* **Legacy Tool Registry**: [backend/agents/toolAgents.ts](file:///Users/I073228/SAPDevelop/workspaces/ai/work/agent-platform/backend/agents/toolAgents.ts)

