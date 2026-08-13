## Why

The project currently has only one unit-test file and no repository-level test or coverage command. A recent baseline run passed one test but measured only 11.34% backend line coverage, while no automated eval suite exists to detect regressions in routing, orchestration, agent outputs, or failure handling.

This change establishes repeatable quality signals now, before the agent surface grows further: focused unit tests should protect deterministic code paths, and evals should exercise representative user scenarios with explicit pass criteria.

## What Changes

- Add a first-class test command that discovers the repository's Node tests and produces machine-readable and human-readable coverage reports.
- Add focused unit tests for high-value deterministic modules, including routing/tool selection, session state, orchestration decisions, and pure agent/data transformations.
- Define coverage scope and thresholds that can be increased deliberately as coverage improves, without counting generated files, dependencies, or external-service-only paths as meaningful coverage.
- Add a versioned eval dataset and runner for representative English and Chinese user requests across supported agent workflows.
- Add deterministic graders for routing/tool selection, response structure, required fields, error/fallback behavior, and workflow completion; isolate live-LLM or market-data checks from the default deterministic eval command.
- Report test coverage and eval results in CI-friendly output so regressions are visible in development and pull requests.

## Capabilities

### New Capabilities

- `unit-test-coverage`: Repeatable unit-test discovery, coverage measurement, scoped thresholds, and developer/CI reporting for the TypeScript backend and shared logic.
- `agent-evals`: Versioned scenario-based evaluation data, deterministic grading, and reproducible result reporting for routing and agent behavior.

### Modified Capabilities

None.

## Impact

- Affected code includes `backend/agents/`, `backend/orchestrator/`, `backend/memory/`, `backend/llm/`, `backend/api/`, and shared helpers under `src/lib/`.
- New test and eval directories, runner scripts, fixtures, and package scripts will be added; existing runtime APIs should remain unchanged.
- CI or pull-request validation will gain test, coverage, and deterministic eval commands. External API credentials and network-dependent workflows remain optional and must not be required for the default checks.
- The change introduces test/eval tooling dependencies only where the existing Node test runner and TypeScript toolchain cannot provide the required reporting or isolation.
