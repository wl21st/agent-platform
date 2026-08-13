## Context

The proposal and capability specs define two additions: measurable unit-test coverage and deterministic agent evals. The repository currently uses TypeScript with `tsx`, Node's built-in `node:test`, and no aggregate test, coverage, or eval command. Existing runtime code includes both pure transformations and integrations with LLMs, market-data APIs, scraping, and browser automation.

## Goals / Non-Goals

**Goals:**

- Make local and CI test execution discoverable through package scripts.
- Measure first-party backend and shared-library code with line, branch, and function coverage, including unimported in-scope files.
- Add focused tests around deterministic decision points and data transformations before expanding into costly integration tests.
- Define a versioned, offline-first eval contract with stable fixtures and behavior-oriented graders.
- Keep network, credentials, browser binaries, and live model calls out of the default quality gate.

**Non-Goals:**

- Replacing the existing application architecture or public runtime APIs.
- Claiming that unit coverage or deterministic evals validate the quality of live LLM prose, market data, or third-party availability.
- Adding a mandatory external observability or hosted evaluation service.
- Setting an aggressive final coverage target before the newly measured baseline is established.

## Decisions

### Use the existing Node test model and add a stable coverage adapter

Unit tests will remain Node `node:test` files executed through the repository's existing TypeScript runtime. Coverage reporting will be wrapped by a project command that emits terminal, JSON, and lcov-compatible results and applies thresholds consistently across supported developer and CI environments.

The coverage source scope will include first-party backend and shared logic, include files that are not imported by tests, and exclude `node_modules`, generated build output, UI assets, fixtures, and explicitly designated external-service-only modules. The initial thresholds will be based on the measured baseline and raised in follow-up work as test families land; the configuration will make the values visible and enforceable rather than hiding them in CI.

**Alternative considered:** relying only on Node's console coverage output. This avoids a dependency but does not provide a stable machine-readable contract and makes threshold enforcement and CI artifact publishing less portable.

### Organize tests by behavior and dependency boundary

New tests will live beside or near the relevant backend area and will prioritize pure functions, tool/routing classification, session state transitions, orchestration planning, and normalized agent results. External calls will be replaced with local HTTP fixtures, injected functions, or deterministic adapters where the current code permits it.

**Alternative considered:** broad end-to-end tests first. Those tests would provide useful confidence later, but they would require credentials, network access, and fragile third-party behavior and would not efficiently raise deterministic coverage.

### Represent evals as versioned scenario data plus a small runner

Eval cases will be stored as versioned JSON or TypeScript data with stable identifiers, language, input, expected behavior, and service requirements. The runner will execute offline scenarios through deterministic routing/orchestration seams and fixture-backed agent inputs. Each grader will return structured pass/fail reasons rather than comparing complete response strings.

The default command will skip live-service scenarios and report them distinctly. A separate opt-in mode may run those cases when credentials and external dependencies are available, but it will not be part of the default quality gate.

**Alternative considered:** sending every eval prompt to a live model. This would measure production-like behavior but would make results nondeterministic, incur cost, expose credentials, and prevent reliable pull-request validation.

### Publish one result contract for automation

Both coverage and eval commands will return non-zero status on a failed test, threshold, or offline eval. They will also write structured result files containing command metadata, counts, thresholds or dataset version, and per-item failures. Human-readable summaries remain the primary local output; machine-readable files support CI annotations and later trend tracking.

## Risks / Trade-offs

- [Risk] Initial thresholds can encode a low baseline and create false confidence → Report the baseline explicitly, scope metrics narrowly, and raise thresholds as each deterministic module gains tests.
- [Risk] Coverage percentage can reward testing lines without validating behavior → Pair coverage with behavior-focused unit tests and eval scenarios; do not use percentage as the only acceptance signal.
- [Risk] Fixture-backed evals can diverge from live integrations → Label offline scenarios and service requirements clearly, and add opt-in integration cases for critical external boundaries.
- [Risk] Graders may overfit to current response shapes → Grade declared properties and required fields, avoid exact prose matching, and version the scenario contract.
- [Risk] Additional tooling may drift from the supported Node/TypeScript versions → Keep scripts thin, pin dependencies when added, and validate the commands from a clean install in CI.

## Migration Plan

1. Add the test and coverage scripts, configuration, and initial deterministic test families; record the resulting baseline and verify the default command locally.
2. Add the eval data contract, offline fixtures, runner, graders, and initial multilingual scenarios; verify pass/fail and skipped-service behavior.
3. Add CI or pull-request invocation after both commands are stable, publishing structured artifacts on failure and success.
4. To roll back, remove the new quality-gate invocation while retaining the test/eval files; runtime application behavior is unchanged.

