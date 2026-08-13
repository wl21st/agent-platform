## Configuration Items Reference

This document defines all observability configuration environment variables: their names, types, defaults, validation rules, and when they are implemented.

**Core principle**: Every observability feature has an ON/OFF flag first, then tuning parameters (level, rate, etc.) second. This makes operational decisions clear: "Is this signal enabled?" before "How verbose?"

## Configuration Item Template

```
ENV_VAR_NAME
├─ Type: <boolean | string | number>
├─ Scope: <global | logging | tracing | signal>
├─ Default (dev): <value>
├─ Default (prod): <value>
├─ Valid Values: <list or range>
├─ Phase: <1 | 1.5 | 2 | 3>
├─ Purpose: <what this controls>
└─ Notes: <implementation details or special handling>
```

---

## GLOBAL CONFIGURATION (Scope: global)

### OBS_ENABLED
```
Type: boolean (true/false)
Scope: global
Default (dev): true
Default (prod): true
Valid Values: true, false
Phase: 1
Purpose: Master on/off switch for all observability (logging, tracing, metrics)
Notes:
  - When false, all observability is disabled with zero overhead
  - All loggers and tracers become no-ops
  - Parsing: "true", "1", "yes" → true; "false", "0", "no" → false
```

### OBS_ENVIRONMENT
```
Type: string
Scope: global
Default (dev): "development"
Default (prod): "production"
Valid Values: "development", "production", "staging", or custom
Phase: 1
Purpose: Deployment environment name; used in resource attributes and tracing
Notes:
  - Maps to OTel resource attribute deployment.environment
  - If not set, derives from NODE_ENV if available, else "development"
```

### OBS_SERVICE_NAME
```
Type: string
Scope: global
Default (dev): "agent-platform"
Default (prod): "agent-platform"
Valid Values: any non-empty string (alphanumeric + hyphens)
Phase: 1
Purpose: Service name for tracing and logging (OTel resource attribute service.name)
Notes:
  - Used to identify this service in distributed traces
  - Should be consistent across all instances of this service
```

### OBS_SERVICE_VERSION
```
Type: string
Scope: global
Default (dev): "0.0.1-dev" (or from package.json version)
Default (prod): (from package.json version)
Valid Values: any semantic version string
Phase: 1
Purpose: Service version for tracing and logging (OTel resource attribute service.version)
Notes:
  - Should match app version in package.json
  - Used to track when code changes affect observability
```

---

## LOGGING CONFIGURATION (Scope: logging)

### OBS_LOGGING_ENABLED
```
Type: boolean
Scope: logging (master switch)
Default (dev): true
Default (prod): true
Valid Values: true, false
Phase: 1
Purpose: Master on/off switch for all logging
Notes:
  - When false, no logs are emitted (loggers are no-ops)
  - Independent of OBS_TRACING_ENABLED (can have logs without traces)
  - Parsing: "true", "1", "yes" → true; "false", "0", "no" → false
```

### OBS_LOG_LEVEL
```
Type: string
Scope: logging (global level)
Default (dev): "debug"
Default (prod): "info"
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 1
Purpose: Global default log level for all components (when OBS_LOGGING_ENABLED=true)
Notes:
  - Only applies when OBS_LOGGING_ENABLED=true
  - Pino levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error
  - Can be overridden per-component via OBS_LOG_<COMPONENT>_LEVEL
  - Applies to all logging signals (HTTP, orchestration, LLM, etc.) unless they have their own levels
```

### OBS_LOG_<COMPONENT>_ENABLED
```
Type: boolean
Scope: logging (per-component on/off)
Default: inherits OBS_LOGGING_ENABLED
Valid Values: true, false
Phase: 1
Purpose: Enable/disable logging for a specific component
Pattern: OBS_LOG_<COMPONENT_NAME>_ENABLED
Examples:
  - OBS_LOG_AGENTS_ENABLED = true/false (log all agents)
  - OBS_LOG_AGENTS_LIQUIDITY_ENABLED = true/false (log liquidity agent only)
  - OBS_LOG_LLM_OPENAI_ENABLED = true/false (log OpenAI client only)
  - OBS_LOG_ORCHESTRATOR_ENABLED = true/false
  - OBS_LOG_API_ENABLED = true/false
Notes:
  - Hierarchical: OBS_LOG_AGENTS_LIQUIDITY_ENABLED overrides OBS_LOG_AGENTS_ENABLED overrides OBS_LOGGING_ENABLED
  - Component names use dots internally (e.g., agents.liquidity) but underscores in env vars
  - Unknown components are ignored (no error, just not matched)
```

### OBS_LOG_<COMPONENT>_LEVEL
```
Type: string
Scope: logging (per-component level)
Default: inherits OBS_LOG_LEVEL
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 1
Purpose: Component-specific log level (when OBS_LOG_<COMPONENT>_ENABLED=true)
Pattern: OBS_LOG_<COMPONENT_NAME>_LEVEL
Examples:
  - OBS_LOG_AGENTS_LEVEL = "debug" (all agents at debug level)
  - OBS_LOG_AGENTS_LIQUIDITY_LEVEL = "trace" (liquidity agent at trace level)
  - OBS_LOG_LLM_OPENAI_LEVEL = "debug" (OpenAI client at debug level)
  - OBS_LOG_ORCHESTRATOR_LEVEL = "info"
  - OBS_LOG_API_LEVEL = "trace"
Notes:
  - Hierarchical: OBS_LOG_AGENTS_LIQUIDITY_LEVEL overrides OBS_LOG_AGENTS_LEVEL overrides OBS_LOG_LEVEL
  - Component names use dots internally (e.g., agents.liquidity) but underscores in env vars
  - Only applies if OBS_LOG_<COMPONENT>_ENABLED=true
```

### OBS_LOG_FORMAT
```
Type: string
Scope: logging (output format)
Default (dev): "pretty"
Default (prod): "json"
Valid Values: "json", "pretty"
Phase: 1
Purpose: Log output format (independent of enabled/level)
Notes:
  - "json": one JSON object per line (machine-readable, production-ready)
  - "pretty": colorized, human-readable text (development-friendly)
  - pino-pretty transport used for "pretty" format
  - Format applies when OBS_LOGGING_ENABLED=true; no effect when disabled
```

---

## TRACING CONFIGURATION (Scope: tracing)

### OBS_TRACING_ENABLED
```
Type: boolean
Scope: tracing (master switch)
Default (dev): true
Default (prod): true
Valid Values: true, false
Phase: 1
Purpose: Master on/off switch for all distributed tracing
Notes:
  - When false, tracer is initialized but is a no-op (zero overhead)
  - Independent of OBS_LOGGING_ENABLED (can have traces without logs)
  - Parsing: "true", "1", "yes" → true; "false", "0", "no" → false
```

### OBS_TRACE_SAMPLE_RATE
```
Type: number
Scope: tracing (sampling rate)
Default (dev): 1.0
Default (prod): 0.1
Valid Values: 0.0 to 1.0 (inclusive)
Phase: 1
Purpose: Sampling rate for traces (when OBS_TRACING_ENABLED=true)
Notes:
  - 0.0 = no traces, 1.0 = all traces, 0.1 = 10% of traces
  - Only applies when OBS_TRACING_ENABLED=true
  - Sampling is probabilistic and respects parent trace (100% sampling if parent is sampled)
  - OTel sampler: ProbabilitySampler configured with this rate
  - Errors and slow requests sampled at 100% (Phase 3 tail sampling)
```

### OBS_TRACE_EXPORT_CONSOLE
```
Type: boolean
Scope: tracing (console exporter)
Default (dev): true
Default (prod): false
Valid Values: true, false
Phase: 1
Purpose: Enable console span exporter (prints spans to stdout)
Notes:
  - Only active when OBS_TRACING_ENABLED=true
  - Format: "SPAN [<span.name>] trace_id=<trace_id> span_id=<span_id> duration_ms=<duration> status=<status>"
  - Useful for debugging; too verbose for production
  - Deferred to Phase 3: file exporter with rotation, remote exporters (OTLP, Datadog, Honeycomb)
```

---

## SIGNAL TOGGLES (Scope: signals — Phase 1)

All signals follow the pattern: `OBS_<SIGNAL>_ENABLED` (on/off) + `OBS_<SIGNAL>_LEVEL` or `OBS_TRACE_<SIGNAL>_SAMPLE_RATE` (tuning).

### HTTP Request Signal

**OBS_HTTP_REQUESTS_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable logging of HTTP request lifecycle (incoming, complete, error)
Notes:
  - When false: HTTP middleware does not emit logs (incoming_request, request_complete, request_error)
  - Does NOT affect request correlation (trace ID is always set)
  - Only applies when OBS_LOGGING_ENABLED=true
```

**OBS_HTTP_REQUESTS_LEVEL**
```
Type: string
Scope: signal
Default: "debug" (for incoming_request), "info" (for request_complete)
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 1
Purpose: Log level for HTTP request events (when OBS_HTTP_REQUESTS_ENABLED=true)
Notes:
  - Incoming requests logged at this level
  - Request completions logged at this level
  - Errors always logged regardless of level (ERROR)
```

**OBS_TRACE_HTTP_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable tracing of HTTP requests (root span per request)
Notes:
  - When false: HTTP middleware does not create spans (even if OBS_TRACING_ENABLED=true)
  - Only applies when OBS_TRACING_ENABLED=true
  - Trace ID still generated and available in logs for correlation
```

**OBS_REQUEST_CORRELATION_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable trace ID and span ID propagation through request context
Notes:
  - When true: trace ID/span ID are generated and propagated to all downstream code
  - When false: no trace ID generated (breaks correlation)
  - Should rarely be disabled (only if performance critical and logging/tracing already off)
  - Independent of HTTP_REQUESTS and HTTP tracing
```

---

### Orchestration Signal

**OBS_ORCHESTRATION_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable logging of orchestrator lifecycle (start, complete, error)
Notes:
  - When false: orchestrator does not emit logs (orchestration_started, orchestration_complete, orchestration_error)
  - Only applies when OBS_LOGGING_ENABLED=true
```

**OBS_ORCHESTRATION_LEVEL**
```
Type: string
Scope: signal
Default: "debug"
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 1
Purpose: Log level for orchestration events (when OBS_ORCHESTRATION_ENABLED=true)
Notes:
  - Orchestration start/complete logged at this level
  - Errors always logged at ERROR level regardless
```

**OBS_TRACE_ORCHESTRATION_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable tracing of orchestration (spans for orchestrator execution)
Notes:
  - When false: orchestrator does not create spans (even if OBS_TRACING_ENABLED=true)
  - Only applies when OBS_TRACING_ENABLED=true
  - Span name: "orchestrate_session"
  - Phase 2 will integrate agent execution spans as children of this span
```

---

### LLM Call Signal

**OBS_LLM_DETAILS_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable logging of LLM call details (model, tokens, latency, finish_reason)
Notes:
  - When false: LLM client does not emit logs (llm_call_succeeded, llm_call_failed)
  - Only applies when OBS_LOGGING_ENABLED=true
  - Errors always logged regardless of this toggle
```

**OBS_LLM_DETAILS_LEVEL**
```
Type: string
Scope: signal
Default: "info"
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 1
Purpose: Log level for LLM call events (when OBS_LLM_DETAILS_ENABLED=true)
Notes:
  - Successful calls logged at this level
  - Failed calls always logged at ERROR level
```

**OBS_TRACE_LLM_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable tracing of LLM calls (spans for each API call)
Notes:
  - When false: LLM client does not create spans (even if OBS_TRACING_ENABLED=true)
  - Only applies when OBS_TRACING_ENABLED=true
  - Span name: "llm_call"
  - Phase 2 will integrate spans as children of orchestration span
```

---

### Error Signal

**OBS_ERROR_CONTEXT_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 1
Purpose: Enable/disable full error context (stack traces, request details) in error logs
Notes:
  - When true: error logs include full stack trace, local state, request context
  - When false: error logs include only error message and error type
  - Errors are ALWAYS logged at ERROR level (not subject to sampling or enabled toggles)
  - Useful to disable in production if logs are being exfiltrated
```

---

### Session Tracking Signal (Phase 2)

**OBS_SESSION_TRACKING_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 2
Purpose: Enable/disable logging of session operations (create, load, save, delete)
Notes:
  - Not implemented in Phase 1
  - When true: session store emits logs (session_created, session_loaded, session_saved, session_deleted)
  - Only applies when OBS_LOGGING_ENABLED=true
```

**OBS_SESSION_TRACKING_LEVEL**
```
Type: string
Scope: signal
Default: "debug"
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 2
Purpose: Log level for session tracking events (when OBS_SESSION_TRACKING_ENABLED=true)
Notes:
  - Not implemented in Phase 1
```

**OBS_TRACE_SESSION_OPERATIONS_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 2
Purpose: Enable/disable tracing of session operations (spans for each operation)
Notes:
  - Not implemented in Phase 1
  - Only applies when OBS_TRACING_ENABLED=true
```

---

### Agent Timing Signal (Phase 2)

**OBS_AGENT_TIMING_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 2
Purpose: Enable/disable logging of agent execution timing and performance
Notes:
  - Not implemented in Phase 1
  - When true: each agent emits logs (agent_started, agent_completed, agent_error)
  - Only applies when OBS_LOGGING_ENABLED=true
```

**OBS_AGENT_TIMING_LEVEL**
```
Type: string
Scope: signal
Default: "debug"
Valid Values: "trace", "debug", "info", "warn", "error"
Phase: 2
Purpose: Log level for agent timing events (when OBS_AGENT_TIMING_ENABLED=true)
Notes:
  - Not implemented in Phase 1
```

**OBS_TRACE_AGENT_EXECUTION_ENABLED**
```
Type: boolean
Scope: signal
Default: true
Valid Values: true, false
Phase: 2
Purpose: Enable/disable tracing of individual agent execution (spans for each agent run)
Notes:
  - Phase 1: creates span "orchestrate_session" for orchestrator; agent spans added Phase 2
  - Phase 2: each agent run gets its own span as child of orchestration span
  - Only applies when OBS_TRACING_ENABLED=true
```

---

## EXPORTER CONFIGURATION (Scope: exporters — Phase 3)

### OBS_EXPORT_OTLP_ENABLED
```
Type: boolean
Scope: exporter
Default: false
Valid Values: true, false
Phase: 3
Purpose: Enable OTLP (OpenTelemetry Protocol) exporter for remote trace collection
Notes:
  - Phase 3 implementation
  - Only applies when OBS_TRACING_ENABLED=true
  - Requires OBS_EXPORT_OTLP_ENDPOINT to be set
```

### OBS_EXPORT_OTLP_ENDPOINT
```
Type: string
Scope: exporter
Default: "http://localhost:4317"
Valid Values: valid HTTP URL
Phase: 3
Purpose: OTLP exporter endpoint
Notes:
  - Only used if OBS_EXPORT_OTLP_ENABLED=true
  - Format: "http://hostname:port" or "https://hostname:port"
  - Timeout: 30 seconds (configurable Phase 3)
```

### OBS_EXPORT_DATADOG_ENABLED
```
Type: boolean
Scope: exporter
Default: false
Valid Values: true, false
Phase: 3
Purpose: Enable Datadog APM exporter for remote trace collection
Notes:
  - Phase 3 implementation
  - Only applies when OBS_TRACING_ENABLED=true
  - Requires DATADOG_API_KEY to be set
```

### OBS_EXPORT_HONEYCOMB_ENABLED
```
Type: boolean
Scope: exporter
Default: false
Valid Values: true, false
Phase: 3
Purpose: Enable Honeycomb exporter for remote trace collection
Notes:
  - Phase 3 implementation
  - Only applies when OBS_TRACING_ENABLED=true
  - Requires HONEYCOMB_API_KEY to be set
```

---

## REDACTION CONFIGURATION (Phase 3)

### OBS_REDACTION_ENABLED
```
Type: boolean
Scope: redaction
Default: false
Valid Values: true, false
Phase: 3
Purpose: Enable redaction of sensitive fields in logs and spans
Notes:
  - Phase 3 implementation
  - When false, sensitive data is logged as-is
  - When true, fields listed in OBS_REDACTION_FIELDS are masked with [REDACTED]
```

### OBS_REDACTION_FIELDS
```
Type: array (comma-separated list)
Scope: redaction
Default: "apiKey,secretKey,password,token,Authorization"
Valid Values: comma-separated field names
Phase: 3
Purpose: List of field names to redact in logs and spans
Notes:
  - Phase 3 implementation
  - Example: "OBS_REDACTION_FIELDS=apiKey,apiSecret,bearerToken"
  - Parsing: split on comma, trim whitespace
  - Redaction applied if OBS_REDACTION_ENABLED=true
```

---

## SUMMARY TABLE

| Env Var | Type | Default (Dev) | Default (Prod) | Phase | Purpose |
|---------|------|---------------|----------------|-------|---------|
| **OBS_ENABLED** | bool | true | true | 1 | Master on/off for all observability |
| **OBS_ENVIRONMENT** | string | "development" | "production" | 1 | Environment name |
| **OBS_SERVICE_NAME** | string | "agent-platform" | "agent-platform" | 1 | Service ID |
| **OBS_SERVICE_VERSION** | string | "0.0.1-dev" | pkg.json | 1 | Service version |
| **OBS_LOGGING_ENABLED** | bool | true | true | 1 | Master on/off for logging |
| **OBS_LOG_LEVEL** | string | "debug" | "info" | 1 | Global log level |
| **OBS_LOG_<COMPONENT>_ENABLED** | bool | (inherit) | (inherit) | 1 | Per-component logging on/off |
| **OBS_LOG_<COMPONENT>_LEVEL** | string | (inherit) | (inherit) | 1 | Per-component log level |
| **OBS_LOG_FORMAT** | string | "pretty" | "json" | 1 | Output format |
| **OBS_TRACING_ENABLED** | bool | true | true | 1 | Master on/off for tracing |
| **OBS_TRACE_SAMPLE_RATE** | number | 1.0 | 0.1 | 1 | Sampling rate (0.0-1.0) |
| **OBS_TRACE_EXPORT_CONSOLE** | bool | true | false | 1 | Console span exporter |
| **OBS_HTTP_REQUESTS_ENABLED** | bool | true | true | 1 | HTTP request logging on/off |
| **OBS_HTTP_REQUESTS_LEVEL** | string | "debug" / "info" | "debug" / "info" | 1 | HTTP request log level |
| **OBS_TRACE_HTTP_ENABLED** | bool | true | true | 1 | HTTP request tracing on/off |
| **OBS_REQUEST_CORRELATION_ENABLED** | bool | true | true | 1 | Trace ID propagation on/off |
| **OBS_ORCHESTRATION_ENABLED** | bool | true | true | 1 | Orchestration logging on/off |
| **OBS_ORCHESTRATION_LEVEL** | string | "debug" | "debug" | 1 | Orchestration log level |
| **OBS_TRACE_ORCHESTRATION_ENABLED** | bool | true | true | 1 | Orchestration tracing on/off |
| **OBS_LLM_DETAILS_ENABLED** | bool | true | true | 1 | LLM call logging on/off |
| **OBS_LLM_DETAILS_LEVEL** | string | "info" | "info" | 1 | LLM call log level |
| **OBS_TRACE_LLM_ENABLED** | bool | true | true | 1 | LLM call tracing on/off |
| **OBS_ERROR_CONTEXT_ENABLED** | bool | true | true | 1 | Full error context on/off |
| **OBS_SESSION_TRACKING_ENABLED** | bool | true | true | 2 | Session logging on/off |
| **OBS_SESSION_TRACKING_LEVEL** | string | "debug" | "debug" | 2 | Session log level |
| **OBS_TRACE_SESSION_OPERATIONS_ENABLED** | bool | true | true | 2 | Session tracing on/off |
| **OBS_AGENT_TIMING_ENABLED** | bool | true | true | 2 | Agent timing logging on/off |
| **OBS_AGENT_TIMING_LEVEL** | string | "debug" | "debug" | 2 | Agent timing log level |
| **OBS_TRACE_AGENT_EXECUTION_ENABLED** | bool | true | true | 2 | Agent execution tracing on/off |
| **OBS_EXPORT_OTLP_ENABLED** | bool | false | false | 3 | OTLP exporter on/off |
| **OBS_EXPORT_OTLP_ENDPOINT** | string | localhost:4317 | localhost:4317 | 3 | OTLP endpoint URL |
| **OBS_EXPORT_DATADOG_ENABLED** | bool | false | false | 3 | Datadog exporter on/off |
| **OBS_EXPORT_HONEYCOMB_ENABLED** | bool | false | false | 3 | Honeycomb exporter on/off |
| **OBS_REDACTION_ENABLED** | bool | false | false | 3 | Redaction on/off |
| **OBS_REDACTION_FIELDS** | array | (default list) | (default list) | 3 | Fields to redact |

---

## Implementation Notes

### Parsing Rules
- **Boolean**: Accept "true", "1", "yes" (case-insensitive) as true; "false", "0", "no" as false
- **Number**: Parse as float; validate range (0.0–1.0 for sampling rate)
- **String**: Trim whitespace; validate against allowed values
- **Array**: Split on comma; trim each element

### Naming Conventions
- All environment variables use **UPPERCASE** with underscores: `OBS_LOGGING_ENABLED`, `OBS_LOG_AGENTS_LIQUIDITY_LEVEL`
- Parsing is **case-insensitive**: `obs_logging_enabled`, `OBS_LOGGING_ENABLED`, `Obs_Logging_Enabled` all equivalent
- By convention, always use ALL CAPS in .env files and documentation

### Component Names (Phase 1 must support)
- `api` - API layer / Fastify routes
- `orchestrator` - Agent orchestration
- `agents` - Generic agent component
- `agents.liquidity` - Specific agent (example)
- `agents.*` - Any agent (pattern matching)
- `llm` - Generic LLM component
- `llm.openai` - OpenAI client
- `memory` - Session memory
- `memory.sessionStore` - Session store implementation

### Precedence Rules (General Pattern)

For any feature, the precedence is:
1. **Master enable** (e.g., `OBS_ENABLED` or `OBS_LOGGING_ENABLED`)
2. **Per-signal enable** (e.g., `OBS_HTTP_REQUESTS_ENABLED`)
3. **Per-signal level/rate** (e.g., `OBS_HTTP_REQUESTS_LEVEL`, `OBS_TRACE_SAMPLE_RATE`)
4. **Per-component enable** (e.g., `OBS_LOG_AGENTS_ENABLED`)
5. **Per-component level** (e.g., `OBS_LOG_AGENTS_LEVEL`)

Example flow for deciding if an HTTP request log is emitted:
```
if not OBS_ENABLED → no log
else if not OBS_LOGGING_ENABLED → no log
else if not OBS_HTTP_REQUESTS_ENABLED → no log
else if OBS_HTTP_REQUESTS_LEVEL filter matches → emit log
```

---

## Production Operational Use Cases

### Use Case 1: "Troubleshoot orchestration in production without affecting other signals"
```bash
OBS_ENABLED=true
OBS_LOGGING_ENABLED=true
OBS_ORCHESTRATION_ENABLED=true
OBS_ORCHESTRATION_LEVEL=debug
OBS_HTTP_REQUESTS_ENABLED=false          # turn off noisy HTTP logs
OBS_LLM_DETAILS_ENABLED=false            # turn off noisy LLM logs
OBS_AGENT_TIMING_ENABLED=false           # turn off agent timing
# Result: only orchestration logs at debug level, everything else quiet
```

### Use Case 2: "Disable all tracing but keep debug logs for specific component"
```bash
OBS_ENABLED=true
OBS_LOGGING_ENABLED=true
OBS_TRACING_ENABLED=false                # turn off all tracing
OBS_LOG_AGENTS_LIQUIDITY_ENABLED=true
OBS_LOG_AGENTS_LIQUIDITY_LEVEL=debug
OBS_LOG_LEVEL=info                       # everything else at info
# Result: liquidity agent at debug level (lots of detail), traces disabled, other components at info
```

### Use Case 3: "Full observability disabled, zero overhead"
```bash
OBS_ENABLED=false
# Result: app runs with zero observability overhead; everything is no-op
```

### Use Case 4: "Production baseline: minimal observability, fast sampling"
```bash
OBS_ENABLED=true
OBS_LOGGING_ENABLED=true
OBS_LOG_LEVEL=info                       # info level only
OBS_HTTP_REQUESTS_ENABLED=false          # no HTTP request logs (too verbose)
OBS_AGENT_TIMING_ENABLED=false           # no agent timing logs
OBS_TRACING_ENABLED=true
OBS_TRACE_SAMPLE_RATE=0.1                # 10% sampling
OBS_LLM_DETAILS_ENABLED=true
OBS_LLM_DETAILS_LEVEL=info
# Result: minimal operational overhead, key signals sampled, easy for ops to tune
```

---

## Configuration Hierarchy

### Logging Hierarchy
```
OBS_ENABLED=false → all disabled
    ↓
OBS_LOGGING_ENABLED=true → logging is active
    ↓
OBS_LOG_LEVEL=info → global default level
    ↓
OBS_HTTP_REQUESTS_ENABLED=true → HTTP logging is active
    ↓
OBS_HTTP_REQUESTS_LEVEL=debug → HTTP logs at debug level
    ↓
OBS_LOG_API_ENABLED=true → API component logging is active
    ↓
OBS_LOG_API_LEVEL=trace → API component logs at trace level
```

### Tracing Hierarchy
```
OBS_ENABLED=false → all disabled
    ↓
OBS_TRACING_ENABLED=true → tracing is active
    ↓
OBS_TRACE_SAMPLE_RATE=1.0 → 100% sampling
    ↓
OBS_TRACE_HTTP_ENABLED=true → HTTP tracing is active
    ↓
OBS_REQUEST_CORRELATION_ENABLED=true → trace IDs propagated
```
