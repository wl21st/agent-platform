## Purpose

The agent catalog gives frontend presentation, backend orchestration, and streamed agent messages one stable identity contract so unsupported or mismatched agents cannot appear as available functionality.

## ADDED Requirements

### Requirement: The platform SHALL expose one canonical catalog of supported agents

The canonical catalog MUST contain exactly one record for each supported agent identity and MUST provide the stable ID, display name, icon, description, and capabilities used by the product. The supported identities are `orchestrator`, `weather`, `search`, `webpage-summarize`, `cosmetic-safe-check`, `ingredients-scrape`, `stock-data`, `news-scrape`, `news-summary`, `technical-analysis`, `risk-assessment`, `stock-decision`, `liquidity-filter`, `screen-hit`, and `final-select`.

#### Scenario: The frontend lists supported agents

- **WHEN** the frontend renders the agent catalog
- **THEN** every supported identity is present exactly once
- **AND** `calculator`, `translator`, `scheduler`, and `getweather` are absent

#### Scenario: The weather agent is represented in a stream event

- **WHEN** a weather result or task is surfaced to a client
- **THEN** its agent identity is `weather`
- **AND** the client does not receive `getweather` as an agent ID

### Requirement: Cross-layer agent metadata SHALL remain consistent

Frontend catalog entries, streamed agent summaries, and backend tool metadata MUST resolve identity, display name, and icon from the canonical catalog. A backend route or event that references an unknown agent identity MUST fail validation before it can be treated as supported functionality.

#### Scenario: Shared metadata is used by frontend and backend consumers

- **WHEN** a supported agent's display metadata is read by the frontend and backend
- **THEN** both consumers resolve the same ID, name, and icon
- **AND** neither consumer maintains a conflicting duplicate record

#### Scenario: An unknown agent identity is introduced

- **WHEN** a frontend catalog entry, stream summary, or backend tool definition references an ID outside the canonical catalog
- **THEN** the consistency validation fails
- **AND** the unknown identity is not presented as a supported agent

### Requirement: Workflow routes and internal pipeline agents SHALL remain distinct from the catalog contract

Backend-only workflow routes and internal pipeline steps MAY reference canonical agent identities, but a route or implementation detail MUST NOT create an additional phantom frontend agent. The `stock-analysis` workflow route remains distinct from the `stock-decision` agent identity.

#### Scenario: A full stock analysis workflow is executed

- **WHEN** the backend runs the `stock-analysis` workflow
- **THEN** its task and message events use the canonical identities of the participating agents
- **AND** the frontend catalog does not gain a separate `stock-analysis` agent entry
