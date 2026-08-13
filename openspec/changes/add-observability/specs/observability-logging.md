## Purpose

Provides structured JSON logging across the agent platform backend, enabling developers to track execution flow, debug issues, and audit operations with correlation IDs and component-specific log levels.

## ADDED Requirements

### Requirement: Structured JSON logging via Pino

The system SHALL emit structured JSON logs to stdout using Pino, with each log entry containing timestamp, level, component name, trace/span IDs, session ID, message, and contextual fields.

#### Scenario: Log entry with full context
- **WHEN** any backend component logs an event
- **THEN** the log entry includes: `{ timestamp, level, component, trace_id, span_id, session_id, message, ...contextFields }`

#### Scenario: Log level filtering
- **WHEN** a component's log level is configured to `info`
- **THEN** only log entries at `info`, `warn`, `error` levels are emitted; `debug` and `trace` are suppressed

### Requirement: Per-component log level configuration

The system SHALL support setting log levels independently per component via environment variables, with a global default and component-specific overrides (e.g., `OBS_LOG_LEVEL=info` with `OBS_LOG_agents_liquidity=trace`).

#### Scenario: Global log level
- **WHEN** `OBS_LOG_LEVEL=info` is set with no component overrides
- **THEN** all components log at `info` level or higher

#### Scenario: Component-level override
- **WHEN** `OBS_LOG_LEVEL=info` and `OBS_LOG_agents_liquidity=trace` are both set
- **THEN** the `agents.liquidity` component logs at `trace` level; all others at `info`

### Requirement: Pretty-printed console output in development

The system SHALL use pino-pretty in development mode to emit human-readable, colorized console logs instead of raw JSON.

#### Scenario: Development mode logging
- **WHEN** `NODE_ENV=development` and `OBS_ENABLED=true`
- **THEN** logs are formatted as colorized, pretty-printed text to console

#### Scenario: Production mode logging
- **WHEN** `NODE_ENV=production` and `OBS_ENABLED=true`
- **THEN** logs are emitted as structured JSON (one JSON object per line)

### Requirement: Logger initialization and availability

The system SHALL initialize a global logger instance at application startup and make it available to all backend modules without modification to function signatures.

#### Scenario: Logger available in modules
- **WHEN** a backend module imports the logger
- **THEN** it can call `logger.info()`, `logger.debug()`, `logger.error()`, etc. immediately

#### Scenario: Observability disabled
- **WHEN** `OBS_ENABLED=false`
- **THEN** logger exists but is a no-op (logs discarded); no errors or side effects

### Requirement: Graceful logger failure handling

If logger initialization or log emission fails (e.g., file write error), the system SHALL log a warning but not crash or block request processing.

#### Scenario: Logger write fails
- **WHEN** a logger tries to write to a file destination and the write fails
- **THEN** the system logs a warning to stderr and continues; the request does not fail

### Requirement: Sensitive data handling configuration

The system SHALL support a configurable redaction list of field names that should never be logged (e.g., `api_key`, `password`, `token`), to be implemented in Phase 3.

#### Scenario: Configuration exists for future redaction
- **WHEN** observability configuration is loaded
- **THEN** a `redaction_fields` configuration option exists (ignored in Phase 1, active in Phase 3)
