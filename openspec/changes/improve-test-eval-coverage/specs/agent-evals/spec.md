## Purpose

Provides reproducible scenario-based evaluation of routing and agent behavior, including multilingual requests, structured outputs, and failure or fallback paths.

## ADDED Requirements

### Requirement: Evaluation scenarios are versioned and self-describing

The project SHALL maintain a versioned evaluation dataset in which each scenario declares its input, intended workflow or behavior, expected observable properties, language where relevant, and whether it requires external services.

#### Scenario: A scenario is added
- **WHEN** a new evaluation case is added to the dataset
- **THEN** it includes enough metadata to identify the behavior under test and can be run without relying on undocumented setup

#### Scenario: The default evaluation run is selected
- **WHEN** a developer runs the default eval command
- **THEN** scenarios requiring live LLM, market-data, browser, or other external services are excluded or explicitly reported as unavailable rather than causing an implicit network-dependent run

### Requirement: Evaluation runner produces deterministic results for offline cases

The project SHALL provide a runner that executes all eligible offline scenarios with controlled inputs and produces a stable result for each scenario.

#### Scenario: Offline scenarios pass
- **WHEN** all offline scenarios satisfy their expected observable properties
- **THEN** the runner exits successfully and reports per-scenario results plus aggregate pass, fail, and skipped counts

#### Scenario: An offline scenario fails
- **WHEN** a scenario does not satisfy an expected property
- **THEN** the runner exits unsuccessfully and reports the scenario identifier, failed property, and observed result

### Requirement: Graders check behavior rather than exact prose

The evaluation system SHALL grade routing or tool selection, required structured fields, response shape, error and fallback behavior, and workflow completion using observable criteria that do not require exact natural-language matching unless a scenario explicitly declares an exact value.

#### Scenario: Equivalent wording is returned
- **WHEN** an agent response expresses the expected result with different wording but satisfies the declared behavioral properties
- **THEN** the scenario passes

#### Scenario: Required behavior is missing
- **WHEN** the output omits a required field, selects an incompatible workflow, or fails to produce a declared fallback
- **THEN** the scenario fails with the corresponding grading reason

### Requirement: Evaluation output is CI-friendly

The project SHALL provide machine-readable evaluation output and a human-readable summary suitable for local development and pull-request validation.

#### Scenario: Evaluation completes
- **WHEN** the eval runner finishes
- **THEN** it writes a structured result containing dataset version, scenario results, aggregate counts, and execution status, and prints a concise summary

#### Scenario: Evaluation infrastructure cannot run
- **WHEN** a required optional dependency or external service is unavailable
- **THEN** the result distinguishes skipped or unavailable scenarios from passed and failed scenarios and uses the documented exit behavior

