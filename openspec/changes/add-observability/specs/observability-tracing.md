## Purpose

Provides distributed tracing via OpenTelemetry, enabling developers to track request flows through the agent platform, measure operation latencies (especially LLM calls), and propagate correlation IDs through async/parallel agent execution.

## ADDED Requirements

### Requirement: Request correlation via trace and span IDs

The system SHALL generate or extract a trace ID at the HTTP request boundary (from `X-Trace-ID` header or generated) and propagate it through all child operations, with each operation receiving a unique span ID.

#### Scenario: Trace ID extracted from request header
- **WHEN** an HTTP request arrives with `X-Trace-ID: abc123`
- **THEN** all downstream operations use `trace_id=abc123` in logs and spans

#### Scenario: Trace ID generated if missing
- **WHEN** an HTTP request arrives without `X-Trace-ID`
- **THEN** a new trace ID is generated and used for all child operations

#### Scenario: Span ID assigned to each operation
- **WHEN** an operation (agent execution, LLM call, session update) starts
- **THEN** it receives a unique span ID that is recorded in logs and trace context

### Requirement: OpenTelemetry tracer initialization

The system SHALL initialize an OpenTelemetry SDK at application startup with configurable sampling, exporters, and resource attributes (service name, version, environment).

#### Scenario: Tracer initialized with defaults
- **WHEN** the application starts with `OBS_ENABLED=true`
- **THEN** OTel SDK is initialized with default configuration (console exporter in dev, OTLP in prod)

#### Scenario: Sampling configuration respected
- **WHEN** `OBS_TRACE_SAMPLE_RATE=0.1` is set
- **THEN** only 10% of traces are sampled (in production); 100% in development by default

#### Scenario: Tracer disabled
- **WHEN** `OBS_ENABLED=false`
- **THEN** tracer is initialized but is a no-op (spans discarded); no errors

### Requirement: AsyncLocalStorage context propagation

The system SHALL use Node.js AsyncLocalStorage (integrated with OTel) to ensure that trace context is automatically propagated through asynchronous code, even when agents execute in parallel.

#### Scenario: Sequential agent execution
- **WHEN** agent A completes, then agent B starts
- **THEN** each has its own span, both linked to the root request span

#### Scenario: Parallel agent execution
- **WHEN** agent A and agent B start simultaneously (via Promise.all)
- **THEN** each has its own span in its own async context; LLM calls from each are correctly associated with their parent agent span

#### Scenario: Nested async operations
- **WHEN** an operation (e.g., LLM call) awaits a nested operation (e.g., retry logic)
- **THEN** the nested operation's span is a child of the parent operation's span

### Requirement: Configurable trace sampling in production and development

The system SHALL support different sampling rates for production and development modes, with production default <3% overhead and development default <10%.

#### Scenario: Production sampling
- **WHEN** `NODE_ENV=production` and sampling is not explicitly set
- **THEN** traces are sampled at a low rate (e.g., 10% by default or as configured via `OBS_TRACE_SAMPLE_RATE`)

#### Scenario: Development full tracing
- **WHEN** `NODE_ENV=development` and sampling is not explicitly set
- **THEN** all traces are captured (100% sampling)

#### Scenario: Explicit sampling override
- **WHEN** `OBS_TRACE_SAMPLE_RATE=0.05` is set
- **THEN** 5% of traces are sampled, regardless of environment

### Requirement: Console span output for development

The system SHALL emit human-readable span information to console in development mode, showing operation names, durations, and status.

#### Scenario: Console spans in development
- **WHEN** `NODE_ENV=development` and `OBS_TRACE_ENABLED=true`
- **THEN** span start/end events are printed to console with operation name, trace ID, span ID, and duration

#### Scenario: No console spans in production
- **WHEN** `NODE_ENV=production`
- **THEN** spans are exported to configured exporters (OTLP, Datadog, etc.) only, not printed to console

### Requirement: OpenTelemetry exporter support (Phase 3 prep)

The system SHALL support multiple exporters (console, OTLP, Datadog, Honeycomb, Jaeger) via configuration, to be fully implemented in Phase 3.

#### Scenario: Exporter configuration exists
- **WHEN** observability configuration is loaded
- **THEN** exporter options are available for console (Phase 1), OTLP, Datadog, Honeycomb (Phase 3)

#### Scenario: Console exporter active in development
- **WHEN** `NODE_ENV=development`
- **THEN** console exporter is active; no remote exporters are initialized

### Requirement: Graceful tracer failure handling

If tracer initialization or span emission fails (e.g., export endpoint unreachable), the system SHALL log a warning but not crash or block requests.

#### Scenario: Export endpoint unreachable
- **WHEN** OTel tries to export spans to an unreachable endpoint
- **THEN** a warning is logged, the span is discarded, and the request continues

### Requirement: Configurable span types (agent execution, LLM calls, session operations)

The system SHALL support independent toggles for which types of spans to capture (agent execution, LLM calls, session operations) via configuration.

#### Scenario: Agent execution spans enabled
- **WHEN** `OBS_TRACE_AGENT_EXECUTION=true`
- **THEN** spans are created for each agent run with agent name, status, duration

#### Scenario: Agent execution spans disabled
- **WHEN** `OBS_TRACE_AGENT_EXECUTION=false`
- **THEN** agent execution spans are not created; LLM call spans and session spans may still be created if enabled

#### Scenario: LLM call spans enabled
- **WHEN** `OBS_TRACE_LLM_CALLS=true`
- **THEN** spans are created for each LLM API call with model, token counts, latency
