## Purpose

Defines how observability settings are configured and applied across the agent platform, enabling developers to control logging levels, trace sampling, and signal capture without code changes.

## ADDED Requirements

### Requirement: Observability master on/off switch

The system SHALL respect an `OBS_ENABLED` environment variable that acts as a master kill switch for all observability (logging, tracing, metrics) without requiring code changes.

#### Scenario: Observability enabled
- **WHEN** `OBS_ENABLED=true`
- **THEN** all observability subsystems (logger, tracer, metrics) are initialized and active

#### Scenario: Observability disabled
- **WHEN** `OBS_ENABLED=false` (or not set)
- **THEN** all observability is disabled; loggers/tracers are no-ops; zero overhead

#### Scenario: Default behavior
- **WHEN** `OBS_ENABLED` is not set
- **THEN** observability is enabled by default with sensible production defaults

### Requirement: Environment-driven configuration

The system SHALL load observability configuration from environment variables, with all settings having defaults that require no configuration for basic operation.

#### Scenario: Environment variables control all settings
- **WHEN** environment variables like `OBS_LOG_LEVEL`, `OBS_TRACE_SAMPLE_RATE` are set
- **THEN** configuration loads those values; unset variables use defaults

#### Scenario: Configuration loaded at startup
- **WHEN** the application starts
- **THEN** configuration is loaded from environment and made available to all modules

### Requirement: Global log level configuration

The system SHALL support a global log level (`OBS_LOG_LEVEL`) that applies to all components, with default `info` in production and `debug` in development.

#### Scenario: Global level set to info
- **WHEN** `OBS_LOG_LEVEL=info`
- **THEN** all components default to `info` level unless overridden

#### Scenario: Global level set to trace
- **WHEN** `OBS_LOG_LEVEL=trace`
- **THEN** all components log at `trace` level, capturing maximum detail

#### Scenario: Production default
- **WHEN** `OBS_LOG_LEVEL` is not set and `NODE_ENV=production`
- **THEN** global log level defaults to `info`

### Requirement: Per-component log level overrides

The system SHALL support component-specific log level overrides via environment variables (e.g., `OBS_LOG_agents_liquidity=trace` overrides global level for `agents.liquidity`).

#### Scenario: Override single component
- **WHEN** `OBS_LOG_LEVEL=info` and `OBS_LOG_agents_liquidity=trace`
- **THEN** `agents.liquidity` logs at `trace`; all other components at `info`

#### Scenario: Multiple component overrides
- **WHEN** `OBS_LOG_LEVEL=warn`, `OBS_LOG_llm=debug`, `OBS_LOG_orchestrator=debug`
- **THEN** LLM and orchestrator log at `debug`; all others at `warn`

#### Scenario: Hierarchical override
- **WHEN** `OBS_LOG_agents=debug` and `OBS_LOG_agents_liquidity=trace`
- **THEN** `agents.liquidity` logs at `trace`; other `agents.*` components at `debug`

### Requirement: Trace sampling rate configuration

The system SHALL support `OBS_TRACE_SAMPLE_RATE` to control the percentage of traces sampled, with production default 0.1 (10%) and development default 1.0 (100%).

#### Scenario: Production sampling rate
- **WHEN** `NODE_ENV=production` and `OBS_TRACE_SAMPLE_RATE` is not set
- **THEN** sampling rate defaults to 0.1 (10%)

#### Scenario: Development sampling rate
- **WHEN** `NODE_ENV=development` and `OBS_TRACE_SAMPLE_RATE` is not set
- **THEN** sampling rate defaults to 1.0 (100%)

#### Scenario: Custom sampling rate
- **WHEN** `OBS_TRACE_SAMPLE_RATE=0.05`
- **THEN** 5% of traces are sampled

### Requirement: Independent signal toggles

The system SHALL support independent boolean toggles for each observability signal (agent timing, LLM details, session tracking, error context, request correlation) via environment variables.

#### Scenario: Disable agent timing
- **WHEN** `OBS_AGENT_TIMING=false`
- **THEN** agent execution spans and timing logs are not emitted

#### Scenario: Disable LLM details
- **WHEN** `OBS_LLM_DETAILS=false`
- **THEN** LLM call spans with token counts and latency are not emitted

#### Scenario: Disable session tracking
- **WHEN** `OBS_SESSION_TRACKING=false`
- **THEN** session operation logs are not emitted

#### Scenario: Disable error context
- **WHEN** `OBS_ERROR_CONTEXT=false`
- **THEN** error logs omit full stack traces and request context (just error message)

#### Scenario: Request correlation always on
- **WHEN** any signal toggle is set
- **THEN** request correlation (trace ID, span ID propagation) remains active regardless of toggles

### Requirement: Format configuration (JSON vs. pretty-print)

The system SHALL automatically select log format based on environment (JSON in production, pretty-printed in development), with an optional override.

#### Scenario: Production format
- **WHEN** `NODE_ENV=production` and `OBS_LOG_FORMAT` is not set
- **THEN** logs are emitted as JSON (one object per line)

#### Scenario: Development format
- **WHEN** `NODE_ENV=development` and `OBS_LOG_FORMAT` is not set
- **THEN** logs are emitted as pretty-printed colorized text

#### Scenario: Format override
- **WHEN** `OBS_LOG_FORMAT=json` is explicitly set
- **THEN** logs are JSON regardless of environment

### Requirement: Exporter configuration (Phase 3 prep)

The system SHALL support configuring exporters (console, OTLP, Datadog, Honeycomb) via environment variables, enabling export destination changes without code changes.

#### Scenario: Console exporter configuration
- **WHEN** `OBS_EXPORT_CONSOLE=true`
- **THEN** console exporter is active

#### Scenario: OTLP exporter configuration
- **WHEN** `OBS_EXPORT_OTLP=true` and `OBS_OTLP_ENDPOINT=http://localhost:4317`
- **THEN** OTLP exporter is configured and active (Phase 3)

#### Scenario: Datadog exporter configuration
- **WHEN** `OBS_EXPORT_DATADOG=true` and `DATADOG_API_KEY=...` are set
- **THEN** Datadog exporter is configured and active (Phase 3)

### Requirement: Configuration validation and defaults

The system SHALL validate configuration at startup, apply sensible defaults for all settings, and log the active configuration at startup (at debug level).

#### Scenario: Configuration logged at startup
- **WHEN** application starts
- **THEN** active observability configuration is logged at debug level

#### Scenario: Invalid configuration detected
- **WHEN** an invalid configuration value is provided (e.g., `OBS_LOG_LEVEL=xyz`)
- **THEN** a warning is logged, and the nearest valid value is used or default is applied

### Requirement: Performance overhead budgets

The system SHALL respect performance budgets: <3% overhead in production (with sampling), <10% in development (full tracing).

#### Scenario: Production overhead
- **WHEN** observability is fully enabled with 10% sampling in production
- **THEN** request latency increases by <3%

#### Scenario: Development overhead
- **WHEN** observability is fully enabled with 100% sampling in development
- **THEN** request latency increases by <10%

#### Scenario: Disabled overhead
- **WHEN** `OBS_ENABLED=false`
- **THEN** no measurable observability overhead (<0.1%)
