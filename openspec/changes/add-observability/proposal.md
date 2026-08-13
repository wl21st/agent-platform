## Why

The platform currently has no structured observability. Logging is ad-hoc console.log/error scattered across the codebase with no correlation IDs, and there's no visibility into agent execution timing, LLM call costs (token usage, latency), or session flows. This makes debugging in production difficult, cost tracking opaque, and performance optimization impossible.

We need production-grade observability that is dev-friendly, fully configurable, and future-proof for both local debugging and remote cloud platforms (Datadog, Honeycomb, etc.).

## What Changes

- Add structured logging via Pino (fast JSON-based logger)
- Add distributed tracing via OpenTelemetry (vendor-neutral, standards-based)
- Add configuration system to control observability on/off, per-component log levels, trace sampling, and which signals to capture
- Instrument Fastify HTTP middleware to propagate request correlation IDs (trace ID, span ID)
- Instrument agent orchestrator and key agent execution paths to emit timing and execution metrics
- Replace console.log/error with structured logger calls (additive, no refactoring of existing code)
- Implement graceful failure handling (observability failures don't break app requests, just log warnings)
- Add interactive TUI tool for configuring observability settings (Phase 1.5, optional companion)

## Capabilities

### New Capabilities

- `observability/logging`: Structured JSON logging with Pino; supports console (dev) and file exporters; configurable per-component log levels (trace/debug/info/warn/error)
- `observability/tracing`: Distributed tracing with OpenTelemetry; configurable sampling (local: 100%, prod: 10%+); support for console spans (dev) and OTLP exporters (prod); context propagation through async code
- `observability/configuration`: Environment-driven configuration for observability settings; master on/off switch; independent toggles for agent timing, LLM details, session tracking, error context, request correlation; no code changes needed to adjust levels
- `observability/tui-config`: Interactive terminal UI tool for configuring observability settings; browse and edit all flags without touching .env or command line; export configuration as shell commands or .env file (Phase 1.5)

### Modified Capabilities

- `api/fastify-http`: HTTP middleware now sets up request correlation context (trace ID, span ID) and logs incoming/outgoing requests; zero breaking changes to route handlers

## Impact

**Code**:
- New: `backend/observability/` (config, logger, tracer initialization)
- New: `backend/observability/tui-config.ts` (TUI tool for configuration, Phase 1.5)
- Modified: `backend/api/fastifyApp.ts` (HTTP middleware for correlation)
- Modified: Agent files will receive structured logging calls incrementally (no refactoring in Phase 1)
- Modified: `backend/llm/openai.ts` to use structured logger instead of console.error
- Modified: `package.json` add script: `"config:tui": "node --import tsx backend/observability/tui-config.ts"`

**Dependencies**:
- Phase 1: `pino`, `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/resources`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/auto-instrumentations-node`
- Phase 1 Dev: `pino-pretty` (pretty-printing logs in development)
- Phase 1.5 Dev: `blessed`, `dotenv` (TUI library and .env file parsing)

**Configuration**:
- New env vars: `OBS_ENABLED`, `OBS_LOG_LEVEL`, `OBS_TRACE_ENABLED`, `OBS_TRACE_SAMPLE_RATE`, `OBS_AGENT_TIMING`, `OBS_LLM_DETAILS`, `OBS_SESSION_TRACKING`, `OBS_ERROR_CONTEXT`, `OBS_REQUEST_CORRELATION`
- Defaults in code allow zero-config startup (observability enabled with reasonable defaults)

**Breaking Changes**: None. Observability is purely additive; existing code paths unchanged.

**Phases**:
1. **Phase 1** (MVP): Config system, logging setup, basic OTel tracing, Fastify HTTP middleware, goal = pretty logs + request correlation + basic timing
2. **Phase 1.5** (Optional): Interactive TUI tool for configuration (`npm run config:tui`), no code changes required in app
3. **Phase 2**: Agent execution tracing (instrument all agent runners with spans)
4. **Phase 3**: Metrics, session tracking, remote exporters (Datadog/Honeycomb), tail sampling, redaction policies
