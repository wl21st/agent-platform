## 1. Unit-test and coverage foundation

- [ ] 1.1 Add standard package scripts for test discovery, coverage execution, and coverage threshold enforcement using the supported TypeScript runtime.
- [ ] 1.2 Add coverage configuration that measures line, branch, and function coverage for in-scope first-party backend and shared logic, includes unimported source files, and excludes dependencies, generated output, fixtures, UI assets, and designated external-service-only modules.
- [ ] 1.3 Configure human-readable, JSON, and lcov-compatible coverage outputs with explicit versioned initial thresholds derived from the current baseline.

## 2. Deterministic unit-test expansion

- [ ] 2.1 Add focused tests for tool/routing classification, including representative English and Chinese inputs, ambiguous requests, and fallback behavior.
- [ ] 2.2 Add focused tests for session-store creation, message appending, preference updates, retrieval, and deletion behavior.
- [ ] 2.3 Add focused tests for orchestration planning and task-state transitions using deterministic agent results and failure paths.
- [ ] 2.4 Add focused tests for pure data transformations and normalization in selected agents, including valid, missing, malformed, and boundary inputs.
- [ ] 2.5 Run the coverage command, record the measured baseline by metric, and raise or adjust thresholds only when the configured source scope and exclusions are verified.

## 3. Offline eval contract and dataset

- [ ] 3.1 Define the versioned eval scenario schema with identifiers, language, input, expected behavior, service requirements, and grader properties.
- [ ] 3.2 Add deterministic fixtures and adapters for routing, orchestration, structured agent results, errors, and fallback responses without requiring credentials or network access.
- [ ] 3.3 Add initial English and Chinese scenarios covering supported routing/tool selection, required output fields, response structure, workflow completion, and failure/fallback behavior.

## 4. Eval runner and grading

- [ ] 4.1 Implement the offline eval runner that loads the versioned dataset, filters or reports external-service scenarios, executes eligible cases, and aggregates pass, fail, skipped, and unavailable counts.
- [ ] 4.2 Implement behavior-oriented graders for tool selection, required fields, response shape, fallback behavior, and workflow completion without exact prose matching by default.
- [ ] 4.3 Emit a human-readable summary and machine-readable result containing dataset version, scenario results, grading reasons, counts, and execution status.
- [ ] 4.4 Make failed offline evals return a non-zero exit status while distinguishing skipped or unavailable optional scenarios according to the documented command contract.

## 5. Documentation and quality-gate verification

- [ ] 5.1 Document test, coverage, and offline eval commands, source scope, exclusions, thresholds, fixture policy, and opt-in external-service behavior.
- [ ] 5.2 Add or update CI/pull-request validation to run the deterministic test, coverage, and eval commands and retain structured result artifacts.
- [ ] 5.3 Verify the commands from a clean install, including a passing run, a deliberately failing threshold/eval case, and restoration of the passing configuration.
- [ ] 5.4 Report final test counts, coverage metrics, eval counts, skipped external scenarios, and exact validation commands.
