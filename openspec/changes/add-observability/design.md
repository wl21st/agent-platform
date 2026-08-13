## Context

The agent platform currently has no structured observability infrastructure. Logging is ad-hoc `console.log()` and `console.error()` calls scattered across ~20 backend files with no correlation IDs, no timing information, and no way to track operations through the complex orchestration flow (request → orchestrator → multiple parallel agents → LLM calls → session updates → response streaming).

The system is built on:
- Fastify HTTP server (logger currently disabled)
- Agent orchestration with potential parallel execution via async/await
- Multiple LLM and external API calls (expensive, need visibility)
- In-memory session store

Constraints:
- Zero breaking changes to existing APIs or function signatures
- Must not impact request latency when disabled
- Must support both local development (human-readable output) and production (structured JSON → cloud platforms)
- Agents can execute in parallel → need AsyncLocalStorage for trace context propagation

## Goals / Non-Goals

**Goals (Phase 1):**
- Introduce structured logging (Pino) with pretty-print in dev, JSON in prod
- Introduce distributed tracing (OpenTelemetry) with console exporter in dev
- Make all signals (agent timing, LLM details, session tracking, errors, correlation) independently toggleable via config
- Establish HTTP request correlation (trace ID generation and propagation)
- Prepare infrastructure for Phase 2 (agent instrumentation) and Phase 3 (remote exporters, metrics, redaction)
- Enable single-component debugging (e.g., trace only liquidity agent at trace level)
- Achieve <3% overhead in production with sampling, <10% in development

**Non-Goals (Phase 1):**
- Metrics collection (deferred to Phase 3)
- Remote exporters (Datadog, Honeycomb) integration (Phase 3)
- Sensitive data redaction (Phase 3)
- Tail sampling strategies (Phase 3)
- Instrumenting every function (will be selective, phase 2 covers agents)
- Frontend/client-side observability (backend-only for Phase 1)

## Decisions

### Decision 1: OpenTelemetry + Pino (not OTel alone, not Pino alone)

**Choice**: Hybrid approach - OTel for traces/metrics/spans, Pino for structured logs.

**Rationale**:
- Pino is the fastest Node.js logger (10x faster than winston, 2x faster than OTel logs). Your streaming responses push lots of data.
- OTel is the industry standard for traces/spans and has no competitor for distributed tracing in Node.js.
- Separation of concerns: logger handles high-volume logs, tracer handles request flow tracing.
- Pino logs can optionally flow into OTel via the new logs bridge (experimental but stabilizing).
- Future-proof: can add remote exporters (OTLP, Datadog, Honeycomb) without touching logger code.

**Alternatives considered**:
- OTel alone: simpler conceptually, but adds logging overhead unsuitable for high-volume scenarios. OTel's logs bridge is new and less battle-tested.
- Pino alone: no native support for distributed tracing; would need manual span tracking everywhere (massive boilerplate).
- Winston: no performance advantage; similar maintenance burden.

**Implementation impact**: Two separate initialization paths (logger at app startup, tracer at app startup), both no-op when disabled. Both are tested separately; integration is minimal.

---

### Decision 2: AsyncLocalStorage for parallel agent context

**Choice**: Use OTel's built-in AsyncLocalStorage integration for trace context propagation through parallel agent execution.

**Rationale**:
- Agents execute in parallel (e.g., `Promise.all([agentA(), agentB()])`).
- Each agent's LLM calls must be traced as children of their parent agent span, not confused with sibling agents.
- AsyncLocalStorage is built into Node.js ≥13; no external dep.
- OTel already uses it internally; we leverage existing integration.
- No overhead when tracing is disabled.

**How it works**:
```typescript
// Orchestrator wraps each agent in its own context
context.with(trace.setSpan(activeContext, agentSpan), async () => {
  await agentA(); // agentSpan is "active" in this context
  // LLM calls from agentA see agentSpan as parent
});
```

**Alternatives considered**:
- Manual span parentage tracking: error-prone, boilerplate-heavy, harder to maintain.
- Sequential-only execution: would lose parallelism benefits.

---

### Decision 3: Decoupled configuration via environment variables

**Choice**: All configuration driven by environment variables, loaded once at startup, validated with sensible defaults. No config files.

**Rationale**:
- Matches Node.js best practices and container/cloud platform expectations.
- No need to manage config files across environments.
- Can override at runtime (container orchestration, CI/CD) without rebuilding image.
- Enables "change level for single component" workflow: `OBS_LOG_agents_liquidity=trace npm run dev`
- Simple validation at startup prevents cascading errors later.

**Structure**: 
- Global settings: `OBS_ENABLED`, `OBS_LOG_LEVEL`, `OBS_TRACE_SAMPLE_RATE`, `OBS_LOG_FORMAT`
- Component overrides: `OBS_LOG_<component>=<level>` (e.g., `OBS_LOG_agents_liquidity=trace`)
- Signal toggles: `OBS_AGENT_TIMING`, `OBS_LLM_DETAILS`, `OBS_SESSION_TRACKING`, `OBS_ERROR_CONTEXT`, `OBS_REQUEST_CORRELATION`
- Exporter config (Phase 3 prep): `OBS_EXPORT_OTLP`, `OBS_OTLP_ENDPOINT`, `OBS_EXPORT_DATADOG`, `DATADOG_API_KEY`, etc.

**Alternatives considered**:
- YAML/JSON config files: more complex, harder to override per-environment.
- Env vars + optional config file: added complexity; env vars alone is sufficient.

---

### Decision 4: Graceful failure (observability doesn't break app)

**Choice**: If observability subsystem fails (logger can't write, tracer export fails), log a warning and continue. Never crash or block requests.

**Rationale**:
- Observability is operational (nice-to-have), not critical (unlike database or auth).
- A logging failure should not make the app unavailable.
- Users expect "something worked partially" not "everything broke."

**Implementation**:
- Logger wrapping catches write errors, emits warning to stderr.
- OTel batch span processor has built-in retry logic; export failures don't throw.
- Warning logged but request completes successfully.

**Alternatives considered**:
- Fail fast (crash if logger fails): too aggressive; observability isn't critical enough.
- Silent failure: no; operator needs to know something went wrong.

---

### Decision 5: Deferred redaction (Phase 3)

**Choice**: Configuration option for redaction list exists in Phase 1 (can be set), but active redaction logic deferred to Phase 3.

**Rationale**:
- Redaction is complex (regex matching, recursive object traversal, performance impact).
- Phase 1 goal is to get observability working and useful; redaction can follow.
- High-sensitivity data (API keys) never logged by design (we're careful about what we log).
- Security review can happen between Phase 1 and 3.

**Implementation**: Config accepts `redaction_fields: [...]` list, but code checks a flag like `if (config.applyRedaction) { ... }` that's false in Phase 1.

**Alternatives considered**:
- Full redaction in Phase 1: delays shipping; adds complexity to review.
- No redaction ever: risky, leaves sensitive data in logs.

---

### Decision 6: Phased instrumentation (3 phases)

**Choice**: Implement in three phases: (1) Config + Logging + HTTP middleware, (2) Agent tracing, (3) Metrics + session tracking + remote exporters + redaction.

**Rationale**:
- Phase 1 is small (~1 day), can ship fast, delivers immediate value (pretty logs + correlation).
- Each phase builds on previous without refactoring prior work.
- Smaller PRs easier to review and test.
- Allows feedback/changes between phases.

**Phase 1 (MVP)**:
- `backend/observability/config.ts` - configuration loading and validation
- `backend/observability/logger.ts` - Pino setup and exports
- `backend/observability/tracer.ts` - OTel SDK setup and exports
- `backend/api/fastifyApp.ts` - HTTP middleware to set correlation context and log requests
- Minimal instrumentation: only HTTP edges and orchestrator entry point

**Phase 2**:
- Wrap agent execution functions with spans
- Log agent start/completion with timing
- Capture agent inputs/outputs at debug level

**Phase 3**:
- Metrics collection (histograms, counters)
- Session operation tracing
- Remote exporter setup (OTLP, Datadog config)
- Redaction logic
- Tail sampling strategies

**Alternatives considered**:
- Monolithic implementation: longer to ship, harder to review, risky for bugs.
- Four+ phases: incremental improvements beyond "working" are diminishing returns.

---

### Decision 7: No code refactoring for observability

**Choice**: Observability is pure additive instrumentation; no function signatures change, no existing logic refactored.

**Rationale**:
- Minimizes risk of bugs.
- Makes review straightforward (instrument this thing, don't change this thing).
- Existing tests don't need updates.
- Easy to revert if needed.

**How it works**:
- Logger injection via module-level singleton, not dependency injection.
- Tracer context set at request boundary, not passed through function signatures.
- Existing agents and functions called unchanged; observability wraps them.

**Alternatives considered**:
- Dependency injection for logger/tracer: cleaner in theory, but requires refactoring every agent and function signature. Risk + complexity not worth it.

---

### Decision 8: Standalone TUI tool for configuration (Phase 1.5)

**Choice**: Create a separate CLI tool (`npm run config:tui`) using blessed that provides an interactive TUI for browsing and editing observability configuration without touching .env or env vars directly.

**Rationale**:
- Configuration has 17 env vars + hierarchical component overrides; manual management is error-prone.
- Developers need quick way to enable/disable signals (e.g., "show me LLM details" vs "show me session tracking").
- Standalone tool doesn't add complexity to the app itself; purely dev-time helper.
- Blessed is mature, proven TUI library; widely used in Node.js ecosystem.
- Phase 1.5 means it's optional; Phase 1 is complete without it.

**How it works**:
1. Tool reads current .env file (or env vars)
2. Shows interactive UI with all config options organized into sections
3. User toggles checkboxes, selects from dropdowns, adds component overrides
4. User saves to .env, exports as shell commands, or previews changes
5. Tool validates input, handles errors gracefully
6. Persists to .env with backup of original

**Alternatives considered**:
- Manual env var editing: tedious, error-prone, poor UX.
- Web-based admin panel (/admin/config): requires app to be running, adds security concerns, more complex.
- Hybrid (TUI + live mode): could be Phase 2 enhancement, but start simple.

**Dependencies**: `blessed` (TUI library), `dotenv` (parse .env files), both dev-only.

**Scope of Phase 1.5**: Just configuration UI; not live tracing, not real-time log display. Those can be Phase 2+ enhancements.

---

## Risks / Trade-offs

**[Risk] AsyncLocalStorage complexity in parallel agents**
- **Scenario**: Async context gets "lost" if agents don't properly bind span context.
- **Mitigation**: 
  - OTel handles this internally; test with multiple parallel agents.
  - Clear documentation/example in code for how to wrap async operations.
  - Phase 2 will catch issues during agent instrumentation.

**[Risk] Performance overhead with full tracing in development**
- **Scenario**: Dev environment becomes slow if all spans are captured.
- **Mitigation**:
  - Default to 100% sampling in dev, but override available.
  - Pino is fast; overhead should be <10%.
  - Can disable per-component if needed.
  - Benchmarking in Phase 1 will validate budget.

**[Risk] OTel API / SDK complexity**
- **Scenario**: OTel configuration has many knobs; subtle bugs in span/context handling.
- **Mitigation**:
  - Start simple (console exporter only in Phase 1).
  - Invest in clear abstractions (tracer module hides OTel details).
  - Comprehensive tests before Phase 3 remote exporters.

**[Risk] Logging to file without rotation**
- **Scenario**: Log files grow unbounded in production if file exporter enabled.
- **Mitigation**: File exporter deferred to Phase 3 with rotation built-in. Phase 1 uses stdout (picked up by container logs).

**[Trade-off] Pino + OTel means two frameworks**
- **Benefit**: Best performance and standards compliance.
- **Cost**: Slightly more dependencies, manual correlation ID passing between them.
- **Justification**: Worth it for streaming use case where performance matters.

**[Trade-off] Env vars only (no config files)**
- **Benefit**: Container-native, easy to override per-environment.
- **Cost**: Long env var names, less readable than YAML.
- **Justification**: Standard practice for cloud/container deployments; easier to reason about in CI/CD.

**[Trade-off] Deferred redaction**
- **Benefit**: Faster Phase 1 delivery, simpler code.
- **Cost**: Logs might contain sensitive data until Phase 3.
- **Mitigation**: Careful about what we log by design + security review before Phase 3.

**[Trade-off] Standalone TUI vs. web admin panel**
- **Benefit**: Simpler to build, no security concerns, no app dependency, works offline.
- **Cost**: Not live (requires app restart to see changes), separate process to run.
- **Justification**: Phase 1.5 is optional; live mode can be added as Phase 2 enhancement if needed. Standalone tool is low-risk and immediately useful.

---

## TUI Implementation Details (Phase 1.5)

The TUI tool provides interactive configuration management for all 27+ observability environment variables. It addresses the operational friction of manually editing long environment variable lists.

### TUI Architecture

**Technology**: `blessed` (mature Node.js TUI library) + `dotenv` (.env file parsing)

**Entry point**: `backend/observability/tui-config.ts` — standalone CLI tool, not embedded in app

**npm script**: `npm run config:tui` — launches TUI in isolated process

### TUI State Model

```typescript
interface ConfigState {
  // Global master switches
  OBS_ENABLED: boolean
  OBS_LOGGING_ENABLED: boolean
  OBS_TRACING_ENABLED: boolean
  
  // Global tuning
  OBS_LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  OBS_LOG_FORMAT: 'json' | 'pretty'
  OBS_TRACE_SAMPLE_RATE: number (0.0-1.0)
  
  // Signal toggles (each with ON/OFF + LEVEL)
  signals: {
    HTTP_REQUESTS: { enabled: boolean, level: string }
    TRACE_HTTP: { enabled: boolean }
    ORCHESTRATION: { enabled: boolean, level: string }
    TRACE_ORCHESTRATION: { enabled: boolean }
    LLM_DETAILS: { enabled: boolean, level: string }
    TRACE_LLM: { enabled: boolean }
    ERROR_CONTEXT: { enabled: boolean }
    REQUEST_CORRELATION: { enabled: boolean }
    SESSION_TRACKING: { enabled: boolean, level: string } (Phase 2)
    TRACE_SESSION_OPERATIONS: { enabled: boolean } (Phase 2)
    AGENT_TIMING: { enabled: boolean, level: string } (Phase 2)
    TRACE_AGENT_EXECUTION: { enabled: boolean } (Phase 2)
  }
  
  // Component overrides
  components: {
    [componentName]: { enabled: boolean, level: string }
  }
  
  // Metadata
  modifiedFields: Set<string> (tracks unsaved changes)
  errors: Map<string, string> (field validation errors)
}
```

### TUI UI Layout

```
┌─ OBSERVABILITY CONFIGURATION ──────────────────────────────────────┐
│                                                                     │
│ GLOBAL MASTER SWITCHES                                              │
│  [x] OBS_ENABLED                                                   │
│  [x] OBS_LOGGING_ENABLED                                           │
│  [x] OBS_TRACING_ENABLED                                           │
│                                                                     │
│ GLOBAL TUNING                                                       │
│      OBS_LOG_LEVEL: [debug▼]   OBS_LOG_FORMAT: [pretty▼]          │
│      OBS_TRACE_SAMPLE_RATE: [1.0]                                  │
│                                                                     │
│ SIGNAL TOGGLES — HTTP REQUESTS                                      │
│  [x] OBS_HTTP_REQUESTS_ENABLED        Level: [debug▼]              │
│  [x] OBS_TRACE_HTTP_ENABLED                                         │
│  [x] OBS_REQUEST_CORRELATION_ENABLED                               │
│                                                                     │
│ SIGNAL TOGGLES — ORCHESTRATION                                      │
│  [x] OBS_ORCHESTRATION_ENABLED        Level: [debug▼]              │
│  [x] OBS_TRACE_ORCHESTRATION_ENABLED                               │
│  ...                                                                │
│                                                                     │
│ COMPONENT OVERRIDES                                                 │
│  [x] agents.liquidity                 Level: [trace▼]  [×]         │
│  [ ] agents.news                      Level: [info▼]   [×]         │
│  ...                                                                │
│                                                                     │
│ [Save]  [Preview]  [Export]  [Quit]                                │
│                                                                     │
│ ▲▼ Navigate  Tab: Next Section  Space: Toggle  H: Help  Ctrl+S: Save│
└─────────────────────────────────────────────────────────────────────┘
```

### Key TUI Features

**1. ON/OFF + Level design**
- Every logging signal shows: checkbox (enabled?) + dropdown (level)
- When checkbox is OFF, level dropdown appears greyed out
- Prevents operational confusion: "Is this ON?" comes first

**2. Component override management**
- Auto-complete suggestions for known component names
- Visual indication: [x] component_name [level] [×]
- Can add/remove overrides before saving

**3. Persistence options**
- **Save to .env**: Reads current .env, updates OBS_* vars, creates backup, writes back
- **Export commands**: Generates shell export statements for copy-paste
- **Preview**: Shows final state without persisting

**4. Validation**
- Sampling rate: 0.0-1.0 with error message if invalid
- Log levels: whitelist [trace, debug, info, warn, error]
- Component names: accept any name (allows future agents)

**5. Navigation**
- Keyboard-only (no mouse required, but optional mouse support)
- Arrow keys: move within section
- Tab / Shift+Tab: move to next/previous section
- Space/Enter: toggle checkbox or edit field
- Ctrl+S: save, Ctrl+E: export, Ctrl+P: preview, Q/Ctrl+Q: quit

**6. Error recovery**
- Invalid .env write (permissions, disk full): show error, offer export as fallback
- Terminal resize: re-render UI
- Ctrl+C: ask for confirmation before exit

### Operational Use Cases Enabled

**Use Case 1**: Debug orchestrator without noisy HTTP/LLM logs
```
1. Launch TUI: npm run config:tui
2. Set OBS_ORCHESTRATION_ENABLED = [x], OBS_ORCHESTRATION_LEVEL = [debug]
3. Set OBS_HTTP_REQUESTS_ENABLED = [ ]  (disable)
4. Set OBS_LLM_DETAILS_ENABLED = [ ]  (disable)
5. Save to .env
6. npm run dev  (picks up new .env)
```

**Use Case 2**: Temporarily trace only liquidity agent
```
1. Launch TUI
2. Component Overrides: Add "agents.liquidity", set level to [trace]
3. Export commands
4. Copy-paste into terminal: export OBS_LOG_AGENTS_LIQUIDITY_ENABLED=true && export OBS_LOG_AGENTS_LIQUIDITY_LEVEL=trace
5. npm run dev
```

**Use Case 3**: Production incident troubleshooting
```
1. SSH to prod pod
2. npm run config:tui
3. Increase OBS_TRACE_SAMPLE_RATE = [0.5]  (from [0.1])
4. Save to .env
5. App restarts (or manual restart): higher sampling active
6. Collect traces for 5 minutes
7. Revert OBS_TRACE_SAMPLE_RATE back to [0.1]
```

### Non-Features (Phase 1.5)

- **No live reload**: Changes require app restart. Live mode is Phase 2+.
- **No remote backend**: TUI works offline, no API calls.
- **No user accounts**: Single developer tool, not multi-user.
- **No saved profiles**: Each run loads current .env; no "presets" feature yet.

## Migration Plan

**Phase 1 (1 day)**:
1. Add dependencies: Pino, OTel SDK, auto-instrumentations
2. Create `backend/observability/` module with config, logger, tracer
3. Integrate into `backend/api/fastifyApp.ts` - HTTP middleware for correlation
4. Add basic orchestrator entry point logging
5. Test locally with pretty-printed output; validate <10% overhead in dev
6. Merge to main

**Phase 1.5 (Optional companion, ~4-6 hours)**:
1. Add blessed + dotenv to devDependencies
2. Create `backend/observability/tui-config.ts` - interactive TUI tool
3. Add npm script: `"config:tui": "node --import tsx backend/observability/tui-config.ts"`
4. Implement configuration UI with sections: globals, toggles, component overrides
5. Implement save/export functionality (.env file, shell commands)
6. Test navigation, input validation, error handling
7. Merge to main (or keep separate for later addition)

**Phase 2 (1-2 days)**:
1. Identify agent runner functions (where agents are invoked from orchestrator)
2. Wrap each with `tracer.startSpan()` and structured logging
3. Test parallel execution preserves trace context
4. Merge to main

**Phase 3 (1-2 days)**:
1. Add metrics collection (histogram for agent duration, counter for tokens)
2. Session operation tracing
3. Remote exporter config (OTLP, Datadog, Honeycomb)
4. Redaction logic
5. Tail sampling (if errors/slow requests, always export)
6. Merge to main

**Rollback strategy**:
- Set `OBS_ENABLED=false` to disable all observability with zero overhead.
- If a phase introduces regressions, can revert that phase's commits without affecting prior phases.
- Each phase is independent; rolling back Phase 2 doesn't affect Phase 1.

## Open Questions

1. **Component naming convention**: Should agents use `agents.liquidity` or `agents/liquidity` in logs? (Recommend dot-notation for consistency with env var naming.)

2. **Trace ID header name**: Should it be `X-Trace-ID` or `traceparent` (W3C standard)? (Recommend `X-Trace-ID` for simplicity; can support `traceparent` in Phase 3.)

3. **Metrics buckets for agent duration**: What latency buckets make sense? (Recommend [10, 50, 100, 500, 1000, 5000] ms, but can be tuned in Phase 3.)

4. **Default sampling rate in production**: 10%, 5%, or 1%? (Recommend 10% as starting point; can adjust based on cost/visibility tradeoff.)

5. **Per-component enable/disable**: Should we support `OBS_ENABLE_agents_liquidity=false` (turn off all signals for one agent) or just log level overrides? (Recommend just log levels for Phase 1; can add per-component toggles in Phase 3 if needed.)
