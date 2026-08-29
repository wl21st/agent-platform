## Why

The frontend agent catalog has drifted from the agents that actually exist at runtime: it exposes the fictional `calculator`, `translator`, and `scheduler` agents and uses `getweather` instead of the canonical `weather` ID. A shared catalog contract is needed now so the frontend, streaming payloads, and backend routing cannot silently diverge as agents are added.

## What Changes

- Introduce a shared agent catalog containing canonical IDs and user-facing metadata for every supported agent.
- Remove ghost agents from the frontend catalog.
- Align the weather catalog ID with the runtime ID `weather`.
- Derive shared agent summary types and values from the canonical catalog where practical.
- Make backend tool metadata reference canonical agent identities while keeping executable handlers backend-only.
- Preserve workflow-only routes and internal pipeline agents as separate backend concepts rather than treating them as frontend catalog entries.

## Capabilities

### New Capabilities

- `agent-catalog`: Provides one canonical set of supported agent identities and metadata for frontend presentation and backend event contracts.

### Modified Capabilities

<!-- No existing OpenSpec capabilities are defined in this repository. -->

## Impact

- Affected code: `src/app/data/agents.ts`, `src/lib/agent-chat.ts`, `backend/agents/toolAgents.ts`, and frontend agent components that consume the catalog.
- The serialized agent identity in stream events becomes consistently based on the canonical IDs; `getweather` is removed in favor of `weather`.
- No new dependencies, API endpoints, or backend execution handlers are required.
- Static mock job labels and unrelated styling cleanup remain outside this change.
