## Purpose

Provides a repeatable, repository-wide signal for the correctness and exercised code surface of deterministic application logic.

## ADDED Requirements

### Requirement: Test command discovers and executes repository tests

The project SHALL provide a documented command that discovers all in-scope unit-test files and executes them using the repository's supported TypeScript runtime.

#### Scenario: All in-scope tests are discovered
- **WHEN** a developer runs the standard test command
- **THEN** every test file under the documented test scope is included exactly once and the command reports the number of tests passed, failed, skipped, and pending

#### Scenario: A test fails
- **WHEN** any discovered test fails
- **THEN** the command exits unsuccessfully and identifies the failing test and file

### Requirement: Coverage report uses an explicit source scope

The project SHALL measure line, branch, and function coverage for documented first-party source files while excluding dependencies, generated output, fixtures, and external-service implementation that is intentionally outside the default scope.

#### Scenario: Coverage is generated
- **WHEN** the standard coverage command completes successfully
- **THEN** it reports line, branch, and function percentages for the configured source scope and provides both human-readable and machine-readable output

#### Scenario: An untested source file is in scope
- **WHEN** a first-party source file in the configured scope is not imported by any test
- **THEN** the coverage report includes that file rather than silently omitting it

### Requirement: Coverage thresholds are enforceable and explicit

The project SHALL define versioned minimum coverage thresholds for each measured metric and SHALL fail the coverage command when any threshold is not met.

#### Scenario: Thresholds are met
- **WHEN** all measured coverage metrics meet or exceed their configured thresholds
- **THEN** the coverage command exits successfully and reports the thresholds used

#### Scenario: A threshold is missed
- **WHEN** any measured coverage metric falls below its configured threshold
- **THEN** the coverage command exits unsuccessfully and identifies the metric and observed value that failed

