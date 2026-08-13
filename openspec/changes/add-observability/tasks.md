## Phase 1: Observability Infrastructure - Tasks

### 1. Dependencies & Project Setup

- [ ] 1.1 Add Pino to package.json: `pino@^8.17.0`
- [ ] 1.2 Add pino-pretty to devDependencies: `pino-pretty@^10.3.0`
- [ ] 1.3 Add OTel SDK packages to package.json:
  - `@opentelemetry/api@^1.7.0`
  - `@opentelemetry/sdk-node@^0.45.0`
  - `@opentelemetry/sdk-trace-node@^0.45.0`
  - `@opentelemetry/resources@^0.45.0`
  - `@opentelemetry/exporter-trace-otlp-http@^0.45.0`
  - `@opentelemetry/auto-instrumentations-node@^0.41.0`
- [ ] 1.4 Run `npm install` and verify all packages installed
- [ ] 1.5 Create directory `backend/observability/` for new modules

### 2. Configuration Module

- [ ] 2.1 Create `backend/observability/config.ts` with type definitions:
  - Global settings interface (enabled, environment, serviceName, version)
  - Logging config interface (level, format, exporters, perComponent)
  - Tracing config interface (enabled, samplingRate, exporters, spans)
  - All signal toggles (HTTP_REQUESTS, AGENT_TIMING, LLM_DETAILS, SESSION_TRACKING, ERROR_CONTEXT, REQUEST_CORRELATION, and all TRACE_* toggles)
- [ ] 2.2 Implement environment variable parsing in config.ts:
  - Parse OBS_ENABLED (default: true)
  - Parse OBS_LOG_LEVEL (default: "debug" in dev, "info" in prod)
  - Parse OBS_LOG_FORMAT (default: "pretty" in dev, "json" in prod)
  - Parse OBS_TRACE_ENABLED (default: true)
  - Parse OBS_TRACE_SAMPLE_RATE (default: 1.0 in dev, 0.1 in prod)
  - Parse OBS_LOG_<component> overrides (e.g., OBS_LOG_agents_liquidity)
  - Parse all signal toggles with defaults
- [ ] 2.3 Implement component log level resolution logic:
  - Support hierarchical component names (e.g., agents.liquidity overrides agents overrides global)
  - Match component against OBS_LOG_<component> env vars
  - Return effective log level for any component
- [ ] 2.4 Create validation function in config.ts:
  - Validate log levels are in [trace, debug, info, warn, error]
  - Validate sampling rate is 0.0-1.0
  - Log warnings for invalid values, use defaults
  - Log active configuration at debug level on startup
- [ ] 2.5 Export singleton `getConfig()` function from config module
- [ ] 2.6 Add JSDoc documentation to all config interfaces and functions

### 3. Logger Module (Pino)

- [ ] 3.1 Create `backend/observability/logger.ts`:
  - Import Pino
  - Create logger factory function `createLogger(componentName: string)`
  - Accept component name, return logger with component field pre-populated
- [ ] 3.2 Implement logger initialization:
  - Read config (format, level, environment)
  - If format is "pretty": use pino-pretty transport (dev only)
  - If format is "json": emit raw JSON to stdout
  - Set default log level based on config
  - If OBS_ENABLED=false: create no-op logger (all methods are no-ops)
- [ ] 3.3 Wrap logger to inject context fields automatically:
  - Every log should include: timestamp, level, component, trace_id, span_id, session_id (when available), message, contextFields
  - Trace ID / span ID should be read from OTel context (to be integrated in step 4)
  - Session ID should be passed explicitly or read from async context (if available)
- [ ] 3.4 Implement error handling in logger:
  - Catch write errors, emit warning to stderr
  - Never throw; logger failure doesn't crash app
  - Log "observability_logger_error" with error details
- [ ] 3.5 Add per-component log level filtering:
  - `createLogger(component)` should read component's effective log level from config
  - Only emit logs at or above that level
- [ ] 3.6 Create and export singleton `getLogger(component: string): Logger`
- [ ] 3.7 Add JSDoc and usage examples

### 4. Tracer Module (OpenTelemetry)

- [ ] 4.1 Create `backend/observability/tracer.ts`:
  - Import OTel SDK (@opentelemetry/sdk-node, @opentelemetry/sdk-trace-node, etc.)
  - Create tracer initialization function
- [ ] 4.2 Implement OTel SDK initialization:
  - Read config (enabled, samplingRate, environment, serviceName, version)
  - If OBS_ENABLED=false: initialize no-op tracer/provider
  - If enabled: create TracerProvider with:
    - Resource attributes (service.name, service.version, deployment.environment)
    - Sampling based on OBS_TRACE_SAMPLE_RATE
- [ ] 4.3 Implement console span exporter (dev only):
  - Console exporter that prints spans to stdout when span ends
  - Format: "SPAN [<span.name>] trace_id=<trace_id> span_id=<span_id> duration_ms=<duration> status=<status>"
  - Only active in development (NODE_ENV=development or OBS_LOG_FORMAT=pretty)
- [ ] 4.4 Set up span processor:
  - Use BatchSpanProcessor (or SimpleSpanProcessor in dev)
  - Span processor passes spans to console exporter
  - Phase 3: will add remote exporters here
- [ ] 4.5 Register tracer and provider globally:
  - Use OTel API to set global tracer provider
  - Export singleton `getTracer(name: string): Tracer`
- [ ] 4.6 Implement graceful failure handling:
  - If tracer initialization fails, log warning and continue with no-op tracer
  - If span emission fails, log warning but don't crash
- [ ] 4.7 Create AsyncLocalStorage context helper:
  - Export helper to wrap async operations with trace context: `withSpanContext(span, fn)`
  - This will be used for parallel agent execution in Phase 2

### 5. HTTP Middleware Integration

- [ ] 5.1 Create middleware in `backend/observability/http-middleware.ts`:
  - Implement Fastify middleware that:
    - Extracts or generates trace ID from request headers (X-Trace-ID or generates UUIDv4)
    - Creates root span for HTTP request with trace ID
    - Sets trace context in AsyncLocalStorage for this request
    - Logs "incoming_request" event (if OBS_HTTP_REQUESTS=true)
    - Stores span/trace ID in request object for later use
- [ ] 5.2 Implement request logging in middleware:
  - Log level: DEBUG
  - Fields: path, method, headers (sanitized: remove Authorization, etc.), trace_id, span_id
  - Only if OBS_HTTP_REQUESTS=true
- [ ] 5.3 Implement response/completion logging:
  - Hook into response end event
  - Log "request_complete" event (level: INFO)
  - Fields: path, method, status_code, total_duration_ms, trace_id, span_id
  - Only if OBS_HTTP_REQUESTS=true
- [ ] 5.4 Implement error handling in middleware:
  - Catch any errors in request handler
  - Log "request_error" event (level: ERROR)
  - Mark root span as error
  - Fields: error message, error type, stack trace (if OBS_ERROR_CONTEXT=true), trace_id
  - Always log errors (not subject to sampling)
- [ ] 5.5 Export middleware: `createHttpMiddleware(): FastifyPlugin`
- [ ] 5.6 Add JSDoc

### 6. Fastify Integration

- [ ] 6.1 Update `backend/api/fastifyApp.ts`:
  - Import `createHttpMiddleware` from observability module
  - Import config module
  - Register HTTP middleware in app.register() before routes
  - Middleware should be registered after CORS but before routes
- [ ] 6.2 Initialize observability at app startup:
  - Call `getConfig()` to load configuration
  - Initialize logger with app-level component name
  - Initialize tracer
  - Log "app_starting" at INFO level with config summary

### 7. Basic Instrumentation: Orchestrator

- [ ] 7.1 Update `backend/orchestrator/agentOrchestrator.ts`:
  - Import logger: `const logger = getLogger('orchestrator')`
  - Import tracer: `const tracer = getTracer('orchestrator')`
- [ ] 7.2 Add logging at orchestrator entry point (streamOrchestratorSession):
  - Log "orchestration_started" (level: DEBUG) with: session_id, input_length, trace_id (from context)
  - Log "orchestration_complete" (level: DEBUG) when finished with: session_id, status, agents_run_count
  - On error: log "orchestration_error" (level: ERROR) with error details
  - Only log if OBS_ORCHESTRATION=true
- [ ] 7.3 Add span for orchestrator:
  - Create root span "orchestrate_session" at start of streamOrchestratorSession
  - Add attributes: session_id, input_length
  - End span when orchestration completes
  - Record exception if error occurs
  - Only create span if OBS_TRACE_AGENT_EXECUTION=true
  - Use `withSpanContext()` helper to propagate context through async operations

### 8. Basic Instrumentation: LLM Calls

- [ ] 8.1 Update `backend/llm/openai.ts`:
  - Import logger: `const logger = getLogger('llm.openai')`
  - Import tracer: `const tracer = getTracer('llm')`
- [ ] 8.2 Add logging to LLM call functions:
  - Replace existing `console.error` calls with `logger.error()`
  - For successful LLM calls: add "llm_call_succeeded" log (level: INFO)
    - Fields: model, total_tokens, prompt_tokens, completion_tokens, latency_ms, finish_reason
    - Only if OBS_LLM_DETAILS=true
  - For failed LLM calls: log "llm_call_failed" (level: ERROR)
    - Fields: model, error message, error type, latency_ms
    - Always log errors
- [ ] 8.3 Add span for LLM calls:
  - Create span "llm_call" at start of each LLM call
  - Add attributes: model, prompt_tokens (if available)
  - End span after call completes
  - Record completion tokens, latency_ms as span attributes
  - Record exception if error
  - Only create span if OBS_TRACE_LLM_CALLS=true
  - Note: Do NOT try to integrate into agent orchestration context yet (Phase 2 will do this properly)

### 9. Error Handling & Context

- [ ] 9.1 Create error logger utility in `backend/observability/error-logger.ts`:
  - Export function `logError(error: Error, context?: Record<string, any>)`
  - Logs error details with configurable stack trace
  - If OBS_ERROR_CONTEXT=true: include full stack trace and context
  - If false: only error message and type
  - Always emits error (not subject to sampling)
- [ ] 9.2 Replace console.error calls in agent files:
  - In Phase 1, update only a few key agents to use structured logger
  - Recommended: `stockDataAgent.ts`, `newsScrapeAgent.ts`, `technicalAnalysisAgent.ts`
  - Change `console.error()` → `logger.error()`
  - Test that errors still propagate correctly
- [ ] 9.3 Test error logging with and without OBS_ERROR_CONTEXT

### 10. Testing & Validation

- [ ] 10.1 Create integration test: `backend/observability/observability.test.ts`
  - Test 1: Config loading with environment variables
    - Verify OBS_ENABLED=false disables everything
    - Verify log level overrides work
    - Verify sampling rate is parsed correctly
  - Test 2: Logger creation and no-op behavior
    - Create logger, log message, verify it doesn't crash when disabled
    - Create logger in enabled mode, verify output structure
  - Test 3: Tracer initialization
    - Verify tracer creates spans
    - Verify spans don't crash when tracing disabled
  - Test 4: HTTP middleware
    - Simulate HTTP request, verify trace ID generated and context set
    - Verify incoming_request/request_complete logs appear
- [ ] 10.2 Manual testing checklist:
  - [ ] Dev mode: `OBS_ENABLED=true npm run dev` → pretty-printed logs appear
  - [ ] Dev mode: `OBS_LOG_agents_liquidity=trace npm run dev` → liquidity agent at trace level
  - [ ] Disabled: `OBS_ENABLED=false npm run dev` → no logs, no observability overhead
  - [ ] Prod mode: `OBS_LOG_FORMAT=json npm run build && npm run start` → JSON logs to stdout
  - [ ] Send test request to /chat → verify trace ID in logs, request_complete shows correct timing
  - [ ] Trigger an error → verify error logged with stack trace
- [ ] 10.3 Verify no regressions:
   - [ ] Run existing tests: `npm run build` (should pass)
   - [ ] Verify all agents still work (no broken imports, no changes to function signatures)
   - [ ] Verify no performance regression with OBS_ENABLED=false

### 11. Phase 1.5: TUI Configuration Tool (Optional)

**Purpose**: Interactive terminal UI for browsing and editing all 27+ observability configuration variables. Reduces friction of manual .env editing and makes ON/OFF + LEVEL settings immediately clear.

**Dependencies**: Completes after Phase 1 (config, logger, tracer all working)

#### 11.1 Dependencies & Setup

- [ ] 11.1.1 Add blessed to devDependencies: `blessed@^0.1.81`
- [ ] 11.1.2 Add dotenv to dependencies: `dotenv@^16.4.0` (for .env file parsing)
- [ ] 11.1.3 Verify both packages install: `npm install`

#### 11.2 Project Structure

- [ ] 11.2.1 Create `backend/observability/tui-config.ts`:
  - Main entry point for TUI application (will be ~400-600 lines)
  - Initialize blessed Screen with full terminal UI
  - Set up keyboard event handlers
  - Set up signal handlers (SIGINT)
- [ ] 11.2.2 Create `backend/observability/tui-state.ts`:
  - ConfigState interface with all 27+ env var properties
  - Methods: loadFromEnv(), loadFromFile(), toEnvVars(), toShellExports()
  - Methods: getModifiedFields(), reset(), validate()
  - Field tracking: which values differ from defaults
- [ ] 11.2.3 Create `backend/observability/tui-ui.ts`:
  - Blessed UI component builders: createCheckbox(), createDropdown(), createTextInput()
  - Section builders: buildGlobalSection(), buildSignalSection(), buildComponentSection(), buildButtonBar()
  - Visual state: highlightField(), greyOutDisabledFields(), showError(), clearError()

#### 11.3 Configuration State Management

- [ ] 11.3.1 Implement state loading in tui-state.ts:
  - Load .env file from current directory (using dotenv)
  - Fall back to environment variables if .env not found
  - Initialize all OBS_ENABLED, OBS_LOGGING_ENABLED, OBS_TRACING_ENABLED flags
  - Initialize all OBS_LOG_LEVEL, OBS_LOG_FORMAT, OBS_TRACE_SAMPLE_RATE values
  - Load all signal toggles (HTTP_REQUESTS, ORCHESTRATION, LLM_DETAILS, ERROR_CONTEXT, SESSION_TRACKING, AGENT_TIMING)
  - Load all component overrides from OBS_LOG_<COMPONENT>_ENABLED and OBS_LOG_<COMPONENT>_LEVEL
  - Apply defaults for unset vars (reference configuration-items.md)
- [ ] 11.3.2 Implement change tracking:
  - Track which fields have been modified from loaded values
  - modifiedFields Set<string> updated on every change
  - Provide isModified() method (returns boolean)
  - Provide getModifiedOnly() method (returns subset of state with only modified fields)

#### 11.4 Global Master Switches Section

- [ ] 11.4.1 Render Global Master Switches:
  - Section header: "GLOBAL MASTER SWITCHES" (bold, colored)
  - OBS_ENABLED (checkbox)
  - OBS_LOGGING_ENABLED (checkbox)
  - OBS_TRACING_ENABLED (checkbox)
  - Current values shown next to checkbox
  - Focused field highlighted (inverse video)
- [ ] 11.4.2 Implement keyboard interaction:
  - Up/Down arrow: move to previous/next checkbox within section
  - Space/Enter: toggle checkbox
  - Tab: move to next section

#### 11.5 Global Tuning Parameters Section

- [ ] 11.5.1 Render Global Tuning:
  - Section header: "GLOBAL TUNING PARAMETERS" (bold, colored)
  - OBS_LOG_LEVEL (dropdown: trace, debug, info, warn, error)
  - OBS_LOG_FORMAT (dropdown: json, pretty)
  - OBS_TRACE_SAMPLE_RATE (text input with validation)
  - Current values shown
- [ ] 11.5.2 Implement dropdown behavior:
  - Enter on dropdown: show options in dropdown menu
  - Arrow keys: select option
  - Enter: confirm selection
  - Escape: cancel
- [ ] 11.5.3 Implement numeric input:
  - Enter on SAMPLE_RATE field: activate text input mode
  - User types numeric value (0.0 to 1.0)
  - Real-time validation: if > 1.0 or < 0.0, show error in red
  - Enter: confirm, Escape: cancel
  - When invalid, keep field in edit mode, allow retry

#### 11.6 Signal Toggles Section (ON/OFF + LEVEL Pattern)

- [ ] 11.6.1 Render Signal Toggles organized by category:
  - Section header: "SIGNAL TOGGLES" (bold, colored)
  - Subsection: "HTTP Requests"
    - [x] OBS_HTTP_REQUESTS_ENABLED          Level: [debug▼]
    - [x] OBS_TRACE_HTTP_ENABLED
    - [x] OBS_REQUEST_CORRELATION_ENABLED
  - Subsection: "Orchestration"
    - [x] OBS_ORCHESTRATION_ENABLED          Level: [debug▼]
    - [x] OBS_TRACE_ORCHESTRATION_ENABLED
  - Subsection: "LLM Details"
    - [x] OBS_LLM_DETAILS_ENABLED            Level: [info▼]
    - [x] OBS_TRACE_LLM_ENABLED
  - Subsection: "Error Context"
    - [x] OBS_ERROR_CONTEXT_ENABLED
  - Subsection: "Session Tracking (Phase 2)" (greyed out)
  - Subsection: "Agent Timing (Phase 2)" (greyed out)
  - Scrollable if doesn't fit terminal
- [ ] 11.6.2 Implement ON/OFF + LEVEL interaction:
  - Each logging signal has: checkbox + level dropdown on same row
  - When checkbox is [x] (enabled): level dropdown appears active (normal color)
  - When checkbox is [ ] (disabled): level dropdown appears greyed out
  - Up/Down arrow: move through signal rows
  - Space on checkbox: toggle enable/disable
  - Enter on level dropdown: open level selector
  - Visual feedback: when toggling checkbox, level immediately becomes grey/active
- [ ] 11.6.3 Implement dropdown for signal levels:
  - Enter on any level dropdown: show [trace, debug, info, warn, error] menu
  - Arrow keys: navigate menu
  - Enter: select and close menu
  - Escape: cancel without changing
- [ ] 11.6.4 Handle signal dependencies:
  - OBS_LOGGING_ENABLED controls availability of all logging signals (HTTP_REQUESTS, ORCHESTRATION, LLM_DETAILS, etc.)
  - If OBS_LOGGING_ENABLED=false: all logging signals appear greyed out
  - If OBS_LOGGING_ENABLED=true: all logging signals become active
  - Similar for OBS_TRACING_ENABLED and tracing signals

#### 11.7 Component Overrides Section

- [ ] 11.7.1 Render Component Overrides section:
  - Section header: "COMPONENT OVERRIDES" (bold, colored)
  - Display list of existing overrides:
    ```
    [x] agents.liquidity              Level: [trace▼]  [×]
    [ ] agents.news                   Level: [info▼]   [×]
    [x] llm.openai                    Level: [debug▼]  [×]
    ```
  - Button: "+ Add Component Override"
  - List is scrollable if many components
- [ ] 11.7.2 Implement component add functionality:
  - User selects "+ Add Component Override"
  - Text input appears with autocomplete:
    - Known components: api, orchestrator, agents, agents.liquidity, agents.*, llm, llm.openai, memory, memory.sessionStore
    - User types: suggestions appear
    - User selects from suggestions or types custom name
    - Press Enter to confirm, Escape to cancel
  - Once component entered: new row added to list with:
    - Checkbox (default: unchecked)
    - Component name
    - Level dropdown (default: "info")
    - Delete button [×]
- [ ] 11.7.3 Implement component edit functionality:
  - User selects checkbox or level dropdown for existing component
  - Up/Down to navigate, Space to toggle enable/disable, Enter to select level
  - Visual feedback: grey out level when component is disabled
- [ ] 11.7.4 Implement component delete functionality:
  - User selects [×] button or presses Delete key on component row
  - Row is removed from list (marked for deletion in state)
  - Changes not persisted until Save is pressed

#### 11.8 UI Layout & Navigation

- [ ] 11.8.1 Implement blessed layout:
  - Use blessed Box/List containers to organize sections
  - Full-screen terminal UI
  - Header bar (top, fixed): "OBSERVABILITY CONFIGURATION" (bold, colored)
  - Main content area (scrollable): all sections stacked vertically
  - Footer bar (bottom, fixed): keybindings and status
- [ ] 11.8.2 Implement keybindings and help:
  - Footer displays: "↑↓ Move  Tab Next Section  SPC/Enter Toggle  Ctrl+S Save  Ctrl+P Preview  Ctrl+E Export  Q Quit  H Help"
  - Pressing H: toggle between condensed/detailed help
  - Visual indicators: current focused field in bright/inverse, modified in green, errors in red
- [ ] 11.8.3 Implement Tab section navigation:
  - Tab: move to next section (Global → Tuning → Signals → Components → Buttons)
  - Shift+Tab: move to previous section
  - Arrow keys within section: move between fields
  - Seamless wrap-around (last button → back to Global)
- [ ] 11.8.4 Implement visual feedback:
  - Current field: inverse video or bright color
  - Modified fields: displayed in green vs. default color
  - Greyed-out disabled fields: dim color
  - Error messages: red text below field
  - Buttons: underlined or inverse
  - Section headers: bold, colored (e.g., blue)

#### 11.9 Action Buttons

- [ ] 11.9.1 Implement button bar at bottom:
  - [Save]    — save configuration to .env
  - [Preview] — preview final configuration
  - [Export]  — display shell export commands
  - [Quit]    — exit TUI
  - Buttons navigable via arrow keys (left/right) or Tab
  - Enter: activate button
  - Visual feedback: current button highlighted/underlined
- [ ] 11.9.2 Implement button keyboard shortcuts:
  - Ctrl+S: activate [Save]
  - Ctrl+P: activate [Preview]
  - Ctrl+E: activate [Export]
  - Q: activate [Quit]
  - (Also via arrow keys + Enter)

#### 11.10 Save Functionality

- [ ] 11.10.1 Implement Save button logic:
  - Validate all user input (sampling rate range, log levels, etc.)
  - If validation errors: show errors, return to editing (don't save)
  - If validation passes: read current .env file (if exists)
- [ ] 11.10.2 Implement .env file merging:
  - Parse existing .env (preserve all non-OBS_* vars)
  - Update only OBS_* variables in the map
  - Add new OBS_* vars not in existing .env
  - Create timestamp: YYYY-MM-DD-HHMMSS format
  - Create backup: `cp .env .env.backup-TIMESTAMP` before writing
- [ ] 11.10.3 Implement file write:
  - Write merged configuration back to .env
  - Each var on one line: KEY=VALUE (no quotes needed for simple values)
  - Handle write errors (permissions, disk full):
    - Show error message: "Error: Could not write to .env (Permission denied)"
    - Show backup info: "Original .env backed up to .env.backup-TIMESTAMP"
    - Offer alternative: "Try 'Export Commands' to save as shell script instead"
    - Return to TUI (don't crash)
- [ ] 11.10.4 Implement success feedback:
  - Show success message: "✓ Configuration saved to .env (backup: .env.backup-20260813-143022)"
  - Mark all fields as unmodified (clear green highlighting)
  - Ask user: "Continue editing?" [Yes] [No]
    - Yes: return to editing
    - No: exit TUI
- [ ] 11.10.5 Handle unsaved changes:
  - Track modifiedFields Set after successful save
  - Clear on successful save
  - If user tries to quit with modified fields: show confirmation

#### 11.11 Preview Functionality

- [ ] 11.11.1 Implement Preview button logic:
  - Validate all current input
  - If errors: show errors, don't preview
  - If valid: display what final configuration would look like
- [ ] 11.11.2 Display preview in modal/overlay:
  - Show all OBS_* environment variables that would be set:
    ```
    PREVIEW: Final Configuration
    
    OBS_ENABLED=true                           (modified)
    OBS_LOGGING_ENABLED=true
    OBS_LOG_LEVEL=debug                        (modified)
    OBS_LOG_FORMAT=pretty
    OBS_TRACING_ENABLED=true
    OBS_TRACE_SAMPLE_RATE=1.0
    OBS_HTTP_REQUESTS_ENABLED=true
    OBS_HTTP_REQUESTS_LEVEL=debug              (modified)
    OBS_ORCHESTRATION_ENABLED=true
    ...
    
    [Close] or press Escape
    ```
  - Mark modified values with "(modified)" suffix
  - Show count: "27 variables configured, 3 modified from .env"
  - Press Escape or click [Close]: return to editing

#### 11.12 Export Commands Functionality

- [ ] 11.12.1 Implement Export button logic:
  - Validate all current input
  - If errors: show errors, don't export
  - If valid: generate shell export commands
- [ ] 11.12.2 Display export output in modal:
  - Show all OBS_* vars as shell export statements:
    ```
    EXPORT COMMANDS: Save or Copy-Paste

    export OBS_ENABLED=true
    export OBS_LOGGING_ENABLED=true
    export OBS_LOG_LEVEL=debug
    export OBS_LOG_FORMAT=pretty
    export OBS_TRACING_ENABLED=true
    export OBS_TRACE_SAMPLE_RATE=1.0
    export OBS_HTTP_REQUESTS_ENABLED=true
    export OBS_HTTP_REQUESTS_LEVEL=debug
    ... (all 27+ vars)

    Options:
    [Copy to Clipboard] [Save to File] [Close]

    Hint: Run in terminal: source exported_vars.sh
    ```
- [ ] 11.12.3 Implement copy-to-clipboard:
  - Use xclip (Linux), pbcopy (macOS), or fallback to displaying text
  - User clicks [Copy to Clipboard]: copy all export commands
  - Show confirmation: "✓ Copied to clipboard"
- [ ] 11.12.4 Implement save-to-file:
  - Prompt user for filename (default: observability-config-TIMESTAMP.sh)
  - Write export commands to file
  - Make executable: `chmod +x filename`
  - Show confirmation: "✓ Saved to observability-config-TIMESTAMP.sh"
  - Show hint: "Run in terminal: source observability-config-TIMESTAMP.sh"

#### 11.13 Input Validation

- [ ] 11.13.1 Validate sampling rate:
  - OBS_TRACE_SAMPLE_RATE must be 0.0-1.0 (inclusive)
  - On user input: check value immediately
  - If < 0.0 or > 1.0: show red error "Value must be between 0.0 and 1.0"
  - Only allow Save/Export/Preview if valid
- [ ] 11.13.2 Validate log levels:
  - Dropdown: only allows valid values [trace, debug, info, warn, error]
  - No validation needed (dropdown restricts choices)
- [ ] 11.13.3 Validate component names:
  - Accept any non-empty string (allows future agents)
  - Autocomplete from known list but allow custom names
  - No format restrictions (user can enter "my.custom.component")
- [ ] 11.13.4 Field-level error display:
  - Errors shown in red below the field
  - Auto-clear when user corrects the value
  - Prevent Save/Export if any field has error

#### 11.14 Error Handling & Recovery

- [ ] 11.14.1 Handle .env read errors:
  - If .env file doesn't exist: show info "No .env found, starting with defaults"
  - If .env unreadable (permissions): show warning "Could not read .env (permission denied), using environment vars as fallback"
  - Continue TUI operation (don't crash)
- [ ] 11.14.2 Handle .env write errors:
  - Try to write to .env
  - If fails (permissions, disk full): catch error
  - Show error message in modal with suggestion to use Export instead
  - Offer [Export Commands] button for alternative
- [ ] 11.14.3 Handle terminal resize:
  - blessed automatically reflows UI on SIGWINCH
  - Ensure all sections remain readable
  - Scrollable sections (Signals, Components) adapt to new height
- [ ] 11.14.4 Handle SIGINT (Ctrl+C):
  - Trap Ctrl+C signal
  - Ask for confirmation: "Quit TUI? (unsaved changes will be lost) [Yes] [No]"
  - Yes: gracefully exit, restore terminal
  - No: return to TUI
- [ ] 11.14.5 Handle other errors gracefully:
  - All errors caught and displayed in UI (not crashes)
  - User can continue editing or quit
  - Restoration of terminal state on exit (blessed cleanup)

#### 11.15 Unsaved Changes Detection

- [ ] 11.15.1 Track modifications:
  - Compare current state with initial loaded state
  - modifiedFields Set<string> updated on every change
  - isModified() returns boolean
- [ ] 11.15.2 Confirmation on quit:
  - If isModified() = true and user presses Q/Ctrl+Q/[Quit]:
    ```
    You have unsaved changes. Save before quitting?
    [Yes]  [No]  [Cancel]
    ```
  - Yes: save then quit
  - No: discard and quit
  - Cancel: return to TUI
- [ ] 11.15.3 No confirmation if no changes:
  - If isModified() = false: quit immediately without confirmation

#### 11.16 npm Script & Documentation

- [ ] 11.16.1 Add npm script to package.json:
  - `"config:tui": "node --import tsx backend/observability/tui-config.ts"`
- [ ] 11.16.2 Update backend/observability/README.md:
  - Add section: "Interactive Configuration Tool"
  - Document: "Run `npm run config:tui` to launch the TUI"
  - Show example screenshots or ASCII diagrams
- [ ] 11.16.3 Update main README.md:
  - Add bullet: "Run `npm run config:tui` for interactive observability configuration (Phase 1.5)"
  - Link to observability README

#### 11.17 Testing Phase 1.5

- [ ] 11.17.1 Functional testing:
  - [ ] Launch TUI: `npm run config:tui` (should display without errors)
  - [ ] Navigate with arrow keys (all sections reachable)
  - [ ] Navigate with Tab (sections navigate in order)
  - [ ] Toggle checkbox with Space/Enter (state updates immediately)
  - [ ] Select dropdown with Enter (shows options, selection works)
  - [ ] Enter numeric value (validation works, errors show)
  - [ ] Add component (input appears, autocomplete works, component added to list)
  - [ ] Delete component (component removed)
  - [ ] Toggle component enabled/disabled (level greyed out when disabled)
- [ ] 11.17.2 Persistence testing:
  - [ ] Save to .env (file updated, backup created)
  - [ ] .env.backup-TIMESTAMP file exists
  - [ ] Non-OBS_* vars preserved in .env
  - [ ] Export commands (displayed in readable format)
  - [ ] Copy to clipboard works (if supported)
  - [ ] Save to file works
  - [ ] Preview shows correct values
- [ ] 11.17.3 Error handling testing:
  - [ ] Invalid sampling rate (> 1.0) shows error
  - [ ] Save with invalid values: prevented, error shown
  - [ ] .env write failure (simulate via permissions): error shown, export offered
  - [ ] Terminal resize: UI reflows, still readable
  - [ ] Ctrl+C: confirmation shown, quit works
- [ ] 11.17.4 UX testing:
  - [ ] UI is readable (colors visible, text not overlapping)
  - [ ] Focus highlights clearly show which field is selected
  - [ ] Modified values visually distinct (green or different color)
  - [ ] Keybindings in footer match implementation
  - [ ] Help text (H key) shows and makes sense
- [ ] 11.17.5 Integration testing:
  - [ ] Save config to .env
  - [ ] Exit TUI
  - [ ] Start app: `npm run dev`
  - [ ] Verify app uses saved configuration (check logs/spans match config)
  - [ ] Change one setting in TUI, save, restart app, verify change took effect

#### 11.18 Phase 1.5 Completion Criteria

- [ ] 11.18.1 TUI launches without errors: `npm run config:tui`
- [ ] 11.18.2 All configuration sections render correctly with proper organization
- [ ] 11.18.3 Keyboard navigation works (arrow keys, Tab, Space/Enter, shortcuts)
- [ ] 11.18.4 ON/OFF checkboxes + LEVEL dropdowns paired correctly
- [ ] 11.18.5 Disabled fields (greyed out) update dynamically based on master switches
- [ ] 11.18.6 Component override add/remove/enable/disable works
- [ ] 11.18.7 Save to .env works, preserves non-OBS_* vars, creates backup
- [ ] 11.18.8 Export commands generated correctly (all 27+ vars)
- [ ] 11.18.9 Preview shows accurate configuration
- [ ] 11.18.10 Unsaved changes detection works (confirmation on quit)
- [ ] 11.18.11 Error handling works (invalid input, file errors, terminal issues)
- [ ] 11.18.12 Terminal resize handled gracefully
- [ ] 11.18.13 Quit confirmation works (Ctrl+C, Q)
- [ ] 11.18.14 No TypeScript errors: `npx tsc --noEmit`
- [ ] 11.18.15 Saved config actually works with app (integration test in 11.17.5)

### 12. Documentation & Finalization

- [ ] 12.1 Create `backend/observability/README.md`:
   - Overview of observability system
   - Configuration guide (all flags and defaults)
   - Usage examples (how to create logger in a new module)
   - Troubleshooting (common issues, how to debug observability itself)
   - Optional: TUI tool guide (`npm run config:tui`)
- [ ] 12.2 Update main `README.md`:
   - Add section on observability
   - Document environment variables for dev/prod
   - Link to `backend/observability/README.md`
   - If Phase 1.5 done: add note about TUI tool
- [ ] 12.3 Create `.env.example` or update existing with observability defaults:
   - OBS_ENABLED=true
   - OBS_LOG_LEVEL=debug (for dev)
   - OBS_TRACE_SAMPLE_RATE=1.0 (for dev)
   - Comments explaining each variable
- [ ] 12.4 Lint and format:
   - [ ] Run `npm run lint` and fix any issues
   - [ ] Verify no TypeScript errors: `npx tsc --noEmit`
- [ ] 12.5 Final check:
   - [ ] All Phase 1 tasks completed
   - [ ] No console.log/error remain in observability code (only logger calls)
   - [ ] No breaking changes to existing APIs
   - [ ] Tests pass
   - [ ] Manual testing checklist complete
- [ ] 12.6 Create pull request summary:
   - Link to proposal.md, design.md, specs
   - List validation commands from section 10.2
   - Document Phase 1 completion
   - Note whether Phase 1.5 TUI is included
   - Document remaining Phases 2-3 work

### 13. Phase 1 Completion Criteria

- [ ] 13.1 All Phase 1 tasks completed and validated
- [ ] 13.2 Configuration system works (flags parsed, validated, logged at startup)
- [ ] 13.3 Logger produces structured JSON or pretty-printed output (environment-dependent)
- [ ] 13.4 Tracer initializes and can create spans (no-op when disabled)
- [ ] 13.5 HTTP middleware sets up request correlation (trace IDs propagate through context)
- [ ] 13.6 Orchestrator logs lifecycle events (started, completed, error)
- [ ] 13.7 LLM calls log details and timing (tokens, latency, model)
- [ ] 13.8 Errors are logged with context (stack traces when enabled)
- [ ] 13.9 Performance budget met: <10% overhead in dev with full sampling, <3% in prod with 10% sampling when disabled
- [ ] 13.10 No regressions: existing tests pass, agents function unchanged
- [ ] 13.11 Ready for Phase 2: agent execution tracing can be added without refactoring Phase 1 code

### 14. Phase 1.5 Completion Criteria (Optional)

- [ ] 14.1 TUI tool launches without errors: `npm run config:tui`
- [ ] 14.2 All configuration sections render correctly (globals, toggles, components)
- [ ] 14.3 Keyboard navigation works (arrow keys, Tab, Space/Enter)
- [ ] 14.4 All input types work (checkboxes, dropdowns, text input)
- [ ] 14.5 Component override add/remove works
- [ ] 14.6 Save to .env file works and preserves non-OBS_* vars
- [ ] 14.7 .env.backup created before saving
- [ ] 14.8 Export commands generated correctly
- [ ] 14.9 Preview shows accurate configuration
- [ ] 14.10 Unsaved changes detection works (confirmation prompt)
- [ ] 14.11 Error handling works (invalid input, file errors, terminal issues)
- [ ] 14.12 Terminal resize handled gracefully
- [ ] 14.13 Quit confirmation works (Ctrl+C, Q)
- [ ] 14.14 No TypeScript errors
- [ ] 14.15 TUI tool is tested and ready for use

---

## Notes for Implementation

**Dependencies & Coupling:**
- Config module has no dependencies on other observability modules (pure config loading)
- Logger module depends only on config
- Tracer module depends only on config
- HTTP middleware depends on logger + tracer
- Orchestrator/LLM changes depend on logger + tracer
- **No circular dependencies.** Changes can be implemented in order above.

**Testing Strategy:**
- Test config loading independently (mocking env vars)
- Test logger/tracer as unit tests (no integration)
- Integration test HTTP middleware with mock Fastify app
- Manual testing with real requests to /chat endpoint

**Rollback Plan:**
- Each module can be disabled independently via `OBS_ENABLED=false`
- If Phase 1 breaks something, revert commits; existing code unaffected
- Phase 1 is additive only (no refactoring of existing code except logger calls)
