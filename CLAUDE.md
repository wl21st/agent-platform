# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development & Build
- `npm run dev` - Start Next.js development server at `http://localhost:3000`
- `npm run build` - Build the production application
- `npm run start` - Start the production server
- `npm run lint` - Run ESLint checks (`eslint .`)
- `npm run liquidity` - Run the standalone stock liquidity analysis script (`tsx backend/agents/liquidity.ts`)

### Testing
- `npx tsx --test backend/llm/openai.test.ts` - Run the unit test suite (uses Node.js native `node:test` runner via `tsx`)
- `npx tsx --test <path-to-test-file>` - Run a single test file

## Architecture & Code Structure

The project is a multi-agent AI platform featuring parallel agent execution, intelligent intent detection, and real-time streaming task updates.

```
├── src/                          # Frontend & Next.js App Router
│   ├── app/
│   │   ├── page.tsx              # Main dashboard view
│   │   ├── layout.tsx            # Root layout with fonts and metadata
│   │   ├── globals.css           # Tailwind CSS styles
│   │   ├── components/           # React UI components (Sidebar, ChatInterface, JobsInterface, AgentsList, AgentDetails)
│   │   ├── data/agents.ts        # Agent UI directory and metadata definitions
│   │   └── api/                  # Next.js Route Handlers
│   │       ├── chat/route.ts     # POST endpoint streaming NDJSON events from orchestrator
│   │       └── session/[sessionId]/route.ts # GET/DELETE session state
│   └── lib/
│       ├── agent-chat.ts         # Core TypeScript types (AgentSummary, StreamEvent, TaskStatus, UserPreferences, ChatMessage)
│       └── stockAnalysisInterfaces.ts # Stock analysis domain data contracts
│
├── backend/                      # Agent system, LLM orchestration, & data services
│   ├── orchestrator/
│   │   └── agentOrchestrator.ts  # LangGraph-based workflow coordinator, intent routing, parallel execution & response streaming
│   ├── agents/                   # Individual tool & domain agents
│   │   ├── toolAgents.ts         # Central TOOL_REGISTRY, route mapping, and regex fallback matchers
│   │   ├── weatherAgent.ts       # WeatherAPI client and formatter
│   │   ├── searchAgent.ts        # Web search agent
│   │   ├── webpageSummarizeAgent.ts # Puppeteer-based webpage scraper and summarizer
│   │   ├── cosmeticSafeCheckAgent.ts # Cosmetic ingredient safety analyzer
│   │   ├── ingredientsScrapeAgent.ts # Product ingredient extractor and pipeline
│   │   ├── stockDataAgent.ts     # Yahoo Finance fundamental/financial data fetcher
│   │   ├── newsScrapeAgent.ts    # Exa API news search
│   │   ├── newsSummaryAgent.ts   # News sentiment and summarization
│   │   ├── technicalAnalysisAgent.ts # Technical indicator evaluation
│   │   ├── riskAgent.ts          # Risk scoring and normalization
│   │   ├── decisionAgent.ts      # Multi-factor investment decision agent
│   │   ├── liquidityAgent.ts / liquidity.ts # Stock liquidity filtering
│   │   ├── screenHitAgent.ts / screening.ts # Technical setup screener
│   │   └── finalSelectAgent.ts   # Final candidate selection and trade plan generator
│   ├── llm/
│   │   └── openai.ts             # OpenAI/OpenRouter client, intent classification, response generation & synthesis
│   ├── memory/
│   │   └── sessionStore.ts       # In-memory conversation history and user preference store
│   └── api/
│       └── fastifyApp.ts         # Standalone Fastify backend option
```

## Key Technical Conventions

- **Path Aliases**: `@/*` resolves to `./src/*`, and `@backend/*` resolves to `./backend/*`.
- **Framework**: Next.js 16 with React 19 and Tailwind CSS 4.
- **Streaming Communication**: The `/api/chat` endpoint emits newline-delimited JSON (`application/x-ndjson`) streams containing `StreamEvent` objects (`session`, `tasks`, `message`, `agent-done`, `done`, `error`).
- **Intent Resolution**: Queries are classified via `classifyUserIntent` (LLM-first) with regex fallback in `toolAgents.ts`. Supports multi-intent parallel execution where independent tasks run concurrently with `Promise.all()`.
- **Environment Configuration**:
  - `LLM_API_KEY` - API key for OpenAI or OpenRouter
  - `LLM_API_BASE_URL` (or legacy `LLM_API_URL`) - Defaults to `https://openrouter.ai/api/v1`
  - `LLM_BASE_MODEL` - Default: `openai/gpt-4.1-mini`
  - `WEATHERAPI_API_KEY` - WeatherAPI service key (optional)
  - `EXA_API_KEY` - Exa search API key (optional)
