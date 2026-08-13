## Purpose

Provides an interactive terminal UI (TUI) tool for developers to browse and modify observability configuration settings without manually editing .env files or environment variables. The tool makes configuration discovery and adjustment friction-free during development.

**Design principle**: Each observability feature presents an ON/OFF toggle first, then tuning parameters (level, rate) second. This makes it immediately clear to operators whether a signal is enabled or disabled.

## TUI Configuration Structure

The TUI organizes configuration into these sections:

### Section 1: Global Master Switches
- `OBS_ENABLED` (checkbox) — Master on/off for all observability
- `OBS_LOGGING_ENABLED` (checkbox) — Master on/off for logging
- `OBS_TRACING_ENABLED` (checkbox) — Master on/off for tracing

### Section 2: Global Tuning Parameters
- `OBS_LOG_LEVEL` (dropdown: trace/debug/info/warn/error) — Global log level
- `OBS_LOG_FORMAT` (dropdown: json/pretty) — Log output format
- `OBS_TRACE_SAMPLE_RATE` (numeric: 0.0-1.0) — Trace sampling rate

### Section 3: Signal Toggles (Logging + Tracing)
Each signal below has:
- `OBS_<SIGNAL>_ENABLED` (checkbox) — Enable/disable the signal
- `OBS_<SIGNAL>_LEVEL` (dropdown, if logging signal) — Verbosity level
- `OBS_TRACE_<SIGNAL>_ENABLED` (checkbox, if has tracing) — Enable/disable span creation

**HTTP Requests Signal**
- `OBS_HTTP_REQUESTS_ENABLED` (checkbox)
- `OBS_HTTP_REQUESTS_LEVEL` (dropdown)
- `OBS_TRACE_HTTP_ENABLED` (checkbox)
- `OBS_REQUEST_CORRELATION_ENABLED` (checkbox) — Independent flag for trace ID propagation

**Orchestration Signal**
- `OBS_ORCHESTRATION_ENABLED` (checkbox)
- `OBS_ORCHESTRATION_LEVEL` (dropdown)
- `OBS_TRACE_ORCHESTRATION_ENABLED` (checkbox)

**LLM Details Signal**
- `OBS_LLM_DETAILS_ENABLED` (checkbox)
- `OBS_LLM_DETAILS_LEVEL` (dropdown)
- `OBS_TRACE_LLM_ENABLED` (checkbox)

**Error Context Signal**
- `OBS_ERROR_CONTEXT_ENABLED` (checkbox) — Include full stack traces in error logs

**Session Tracking Signal (Phase 2)**
- `OBS_SESSION_TRACKING_ENABLED` (checkbox)
- `OBS_SESSION_TRACKING_LEVEL` (dropdown)
- `OBS_TRACE_SESSION_OPERATIONS_ENABLED` (checkbox)

**Agent Timing Signal (Phase 2)**
- `OBS_AGENT_TIMING_ENABLED` (checkbox)
- `OBS_AGENT_TIMING_LEVEL` (dropdown)
- `OBS_TRACE_AGENT_EXECUTION_ENABLED` (checkbox)

### Section 4: Component Overrides
List of per-component settings:
- `OBS_LOG_<COMPONENT>_ENABLED` (checkbox) — Enable/disable logging for component
- `OBS_LOG_<COMPONENT>_LEVEL` (dropdown) — Log level for component
- Examples: agents, agents.liquidity, llm.openai, orchestrator, api, memory

### Section 5: Action Buttons
- [Save] — Save to .env file
- [Preview] — Show what would be saved
- [Export] — Display shell export commands
- [Quit] — Exit TUI

## ADDED Requirements

### Requirement: Interactive TUI for observability configuration

The system SHALL provide a `npm run config:tui` command that launches an interactive terminal UI for viewing and modifying observability settings.

#### Scenario: User launches TUI
- **WHEN** user runs `npm run config:tui`
- **THEN** an interactive TUI application launches showing:
  - Global master switches: OBS_ENABLED, OBS_LOGGING_ENABLED, OBS_TRACING_ENABLED
  - Global tuning: OBS_LOG_LEVEL, OBS_LOG_FORMAT, OBS_TRACE_SAMPLE_RATE
  - Signal toggles organized by category (HTTP, Orchestration, LLM, Error, Session, Agent Timing)
    - Each signal: ON/OFF checkbox + LEVEL dropdown (for logging signals) or RATE (for tracing)
  - Component override section with list of per-component settings
  - Save/Export/Preview buttons

#### Scenario: Navigate and modify settings
- **WHEN** user navigates with arrow keys and modifies values (toggle checkboxes, change dropdowns)
- **THEN** the TUI updates display in real-time showing new values
  - No changes are persisted until user chooses to save

#### Scenario: TUI reflects current .env state
- **WHEN** TUI starts
- **THEN** it reads the current .env file and displays all current values
  - If .env doesn't exist, shows default values
  - If OBS_* vars set in shell environment, shows those as fallback

### Requirement: Configuration editing in TUI

The system SHALL allow users to edit all configuration values through the TUI interface with appropriate input methods (checkboxes, dropdowns, text input).

#### Scenario: Toggle boolean flag
- **WHEN** user navigates to OBS_LOGGING_ENABLED checkbox and presses Space/Enter
- **THEN** checkbox toggles between [ ] and [x]

#### Scenario: Change log level dropdown
- **WHEN** user navigates to OBS_LOG_LEVEL and presses Enter
- **THEN** dropdown shows options [trace, debug, info, warn, error], user selects one
- **THEN** value updates in TUI

#### Scenario: Enable/disable a signal and set its level
- **WHEN** user navigates to OBS_HTTP_REQUESTS_ENABLED and toggles it to [x]
- **THEN** OBS_HTTP_REQUESTS_LEVEL field becomes editable (appears highlighted)
- **WHEN** user navigates to OBS_HTTP_REQUESTS_LEVEL and presses Enter
- **THEN** dropdown shows [trace, debug, info, warn, error], user selects
- **THEN** both values update in TUI
- **WHEN** user navigates back and toggles OBS_HTTP_REQUESTS_ENABLED to [ ]
- **THEN** OBS_HTTP_REQUESTS_LEVEL field appears greyed out (disabled)

#### Scenario: Modify sampling rate
- **WHEN** user navigates to OBS_TRACE_SAMPLE_RATE field and presses Enter
- **THEN** TUI allows input of numeric value (0.0 to 1.0)
- **THEN** value updates and is validated

#### Scenario: Add component override
- **WHEN** user selects "Add Component Override" and enters component name (e.g., "agents.liquidity")
- **THEN** TUI adds new row with: [checkbox] component_name [dropdown level] [Edit] [Delete]
  - Checkbox: OBS_LOG_AGENTS_LIQUIDITY_ENABLED (ON/OFF)
  - Dropdown: OBS_LOG_AGENTS_LIQUIDITY_LEVEL (trace/debug/info/warn/error)
- **THEN** user can toggle enable and set level

#### Scenario: Remove component override
- **WHEN** user navigates to existing component override and selects Delete
- **THEN** the override is removed from the TUI display (not yet saved)

### Requirement: Configuration persistence

The system SHALL provide multiple options for persisting configuration changes: saving to .env file or exporting as shell commands.

#### Scenario: Save to .env file
- **WHEN** user presses [Save] button
- **THEN** TUI writes current configuration to .env file (or creates it)
  - Preserves existing non-observability vars in .env
  - Updates all OBS_* vars (both ENABLED flags and tuning parameters)
  - Creates backup of old .env before writing
- **THEN** confirmation message shown: "Configuration saved to .env (backup: .env.backup-20260813-143022)"
- **THEN** user can quit or continue editing

#### Scenario: Export as shell commands
- **WHEN** user presses [Export Commands] button
- **THEN** TUI displays copy-paste-able shell commands with all current settings:
  ```
  export OBS_ENABLED=true
  export OBS_LOGGING_ENABLED=true
  export OBS_LOG_LEVEL=debug
  export OBS_LOG_FORMAT=pretty
  export OBS_TRACING_ENABLED=true
  export OBS_TRACE_SAMPLE_RATE=1.0
  export OBS_HTTP_REQUESTS_ENABLED=true
  export OBS_HTTP_REQUESTS_LEVEL=debug
  export OBS_TRACE_HTTP_ENABLED=true
  export OBS_ORCHESTRATION_ENABLED=true
  export OBS_ORCHESTRATION_LEVEL=debug
  export OBS_TRACE_ORCHESTRATION_ENABLED=true
  export OBS_LLM_DETAILS_ENABLED=true
  export OBS_LLM_DETAILS_LEVEL=info
  export OBS_TRACE_LLM_ENABLED=true
  export OBS_ERROR_CONTEXT_ENABLED=true
  export OBS_LOG_AGENTS_LIQUIDITY_ENABLED=true
  export OBS_LOG_AGENTS_LIQUIDITY_LEVEL=trace
  ...
  ```
- **THEN** user can copy to clipboard or save to file

#### Scenario: Preview configuration
- **WHEN** user presses [Preview] button while editing
- **THEN** TUI displays what the final .env or export commands would be
  - No changes persisted, just preview
  - Shows both enabled flags and their tuning parameters

### Requirement: Component override selection

The system SHALL support discovering and selecting component names with autocomplete/search and validation. Each component override shall have both an on/off toggle and a level selector.

#### Scenario: Autocomplete component names
- **WHEN** user starts typing a component name in the Add Component field
- **THEN** TUI shows matching component names from known components:
  - api, orchestrator
  - agents, agents.liquidity, agents.news, agents.technical, agents.risk, agents.screening, agents.weather, agents.other
  - llm, llm.openai
  - memory, memory.sessionStore
- **THEN** user selects from suggestions or types custom name

#### Scenario: Validate component name
- **WHEN** user enters a component name
- **THEN** TUI accepts it even if not in known list (allows future agents)
- **THEN** user can proceed with custom component name

#### Scenario: Component override display
- **WHEN** user views list of component overrides
- **THEN** each override shows as a row:
  ```
  [x] agents.liquidity              [debug▼]  [Edit] [Delete]
  [ ] agents.news                   [info▼]   [Edit] [Delete]
  [x] llm.openai                    [trace▼]  [Edit] [Delete]
  ```
- **THEN** checkbox indicates if OBS_LOG_<COMPONENT>_ENABLED is true/false
- **THEN** dropdown shows current OBS_LOG_<COMPONENT>_LEVEL
- **THEN** greyed out if checkbox is unchecked (disabled component)

### Requirement: Navigation and usability

The system SHALL provide keyboard-driven navigation and clear visual feedback for current state and available actions.

#### Scenario: Navigate TUI with keyboard
- **WHEN** user presses arrow keys
- **THEN** selection moves through fields (up/down within section, left/right between columns)
- **WHEN** user presses Tab
- **THEN** selection moves to next section in order:
  1. Global master switches (OBS_ENABLED, OBS_LOGGING_ENABLED, OBS_TRACING_ENABLED)
  2. Global tuning (OBS_LOG_LEVEL, OBS_LOG_FORMAT, OBS_TRACE_SAMPLE_RATE)
  3. Signal toggles grouped by category
     - HTTP Requests (ENABLED checkbox, LEVEL dropdown, TRACE checkbox)
     - Orchestration (ENABLED, LEVEL, TRACE)
     - LLM Details (ENABLED, LEVEL, TRACE)
     - Error Context (ENABLED checkbox)
     - Other signals (SESSION_TRACKING, AGENT_TIMING, etc.)
  4. Component overrides (list of [enabled checkbox] component [level dropdown])
  5. Buttons ([Save] [Preview] [Export] [Quit])

#### Scenario: Visual feedback for disabled vs enabled fields
- **WHEN** a signal ENABLED checkbox is unchecked [ ]
- **THEN** its associated LEVEL dropdown appears greyed out / dimmed
- **WHEN** a signal ENABLED checkbox is checked [x]
- **THEN** its associated LEVEL dropdown appears active (highlighted when selected)

#### Scenario: Visual hierarchy
- **WHEN** TUI is displayed
- **THEN** section headers are bold and colored (e.g., blue)
- **THEN** current field is highlighted (e.g., reverse video or bright color)
- **THEN** modified values are shown in different color (e.g., green) compared to defaults
- **THEN** default values are shown in normal color
- **THEN** disabled/greyed fields shown in dim color
- **THEN** error messages are shown in red
- **THEN** buttons are highlighted (e.g., inverse, underline)

#### Scenario: Help text
- **WHEN** TUI is displayed
- **THEN** help text footer shows available keybindings:
  - Arrow keys: navigate within section
  - Tab / Shift+Tab: move to next / previous section
  - Space/Enter: toggle checkbox or edit field
  - Ctrl+S: save
  - Ctrl+P: preview
  - Ctrl+E: export
  - Ctrl+Q or Q: quit
  - H: show help (toggle detailed help)

### Requirement: Exit and save confirmation

The system SHALL confirm unsaved changes before exiting and offer options to save, discard, or continue editing.

#### Scenario: Quit with unsaved changes
- **WHEN** user attempts to quit (Ctrl+Q, Q, or [Quit] button) with unsaved changes
- **THEN** confirmation dialog appears:
  ```
  You have unsaved changes. Save before quitting?
  [Yes] [No] [Cancel]
  ```
- **WHEN** user selects Yes → save and quit
- **WHEN** user selects No → discard changes and quit
- **WHEN** user selects Cancel → return to TUI

#### Scenario: Quit with no changes
- **WHEN** user attempts to quit with no changes
- **THEN** app exits immediately with no confirmation

### Requirement: Error handling and validation

The system SHALL validate input and display errors clearly without crashing the TUI.

#### Scenario: Invalid input
- **WHEN** user enters invalid value (e.g., sampling rate > 1.0 or < 0.0)
- **THEN** TUI shows error message in red below the field
- **THEN** user can correct the value
- **THEN** error clears when corrected

#### Scenario: File write error
- **WHEN** TUI tries to save to .env but file write fails
- **THEN** error message displayed:
  ```
  Error: Could not write to .env (Permission denied)
  Original .env backed up to .env.backup-TIMESTAMP
  ```
- **THEN** TUI remains open, user can try saving again or export commands instead

#### Scenario: TUI receives signals
- **WHEN** user presses Ctrl+C or terminal receives SIGTERM
- **THEN** TUI asks for confirmation to quit (don't immediately exit)
- **THEN** if user confirms, gracefully cleanup and exit

### Requirement: Color and styling for readability

The system SHALL use colors and formatting to make the TUI readable and scannable, with clear visual hierarchy.

#### Scenario: No color fallback
- **WHEN** terminal doesn't support colors
- **THEN** TUI still works with ASCII-only styling (boxes, bold, reverse)
- **THEN** no color codes used, still readable
