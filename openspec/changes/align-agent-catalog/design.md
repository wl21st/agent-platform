## Context

See `proposal.md` for the motivation and scope. The current repository has three overlapping concepts:

- `src/app/data/agents.ts` owns a frontend-only, richly described catalog, including unsupported agents and the `getweather` typo.
- `src/lib/agent-chat.ts` owns the runtime `AgentId` union and lightweight `AgentSummary` constants consumed by both frontend and backend code.
- `backend/agents/toolAgents.ts` owns backend route matching and executable handlers, including workflow routes that are not themselves agent identities.

The shared layer must remain importable by the browser. Backend handlers and route matching must not move into it.

## Goals / Non-Goals

**Goals:**

- Establish one browser-safe source of truth for supported agent identity and presentation metadata.
- Make `AgentId` and streamed summaries derive from, or be checked against, that source.
- Make backend tool metadata reference canonical agent IDs without coupling the shared catalog to backend execution code.
- Remove the three ghost agents and normalize weather to `weather`.

**Non-Goals:**

- Implementing calculator, translator, or scheduler agents.
- Reworking the Jobs view's mock data; that remains TD-06.
- Refactoring card themes or name-based styling; that remains TD-08/TD-14.
- Converting workflow routes such as `stock-analysis` into frontend agents.

## Decisions

### Use a dedicated shared registry

Create a browser-safe module such as `src/lib/agent-registry.ts` containing the full agent records and a keyed lookup. Derive the agent ID type from the registry where TypeScript permits it, and expose a small summary projection for stream payloads.

This is preferred over extending `src/app/data/agents.ts` because backend code already imports shared runtime contracts from `src/lib`, and it avoids making the frontend directory the source of backend identities. It is preferred over putting all metadata into `toolAgents.ts` because that would pull backend handlers and routing concerns toward the browser.

### Preserve the existing stream summary shape

Keep `AgentSummary` as the serialized `{ id, name, icon }` contract so existing chat messages and NDJSON events remain compatible. The existing named constants can become projections of the shared records, or consumers can use a typed summary lookup.

### Separate identity metadata from executable routing

Keep `TOOL_REGISTRY` backend-only. Add a canonical agent identity reference to tool definitions where useful, and derive display names from the shared registry rather than duplicating them. The `stock-analysis` route should continue to identify the orchestrator as its public agent while its internal pipeline emits the participating canonical agent identities.

### Use the canonical list for frontend presentation

Replace the object literals in `src/app/data/agents.ts` with a thin adapter or re-export from the shared registry. Existing component props can remain stable during the migration, minimizing changes to `page.tsx`, `AgentsList`, and `AgentDetails`.

### Validate the inventory at the boundary

Add focused consistency coverage that checks uniqueness, absence of deprecated IDs, weather normalization, and that backend-referenced agent IDs exist in the shared registry. Run TypeScript validation and the focused checks as part of the change; no new runtime dependency is required.

## Risks / Trade-offs

- [Risk] Moving metadata changes import paths or inferred types in frontend components. -> Mitigation: retain a compatibility adapter from `src/app/data/agents.ts` during the migration and run the existing TypeScript check.
- [Risk] Historical data could contain `getweather`. -> Mitigation: runtime-generated records currently use in-memory sessions; preserve a defensive display fallback only if repository inspection finds persisted historical payloads, without reintroducing `getweather` as a supported ID.
- [Risk] The catalog may be mistaken for the complete route registry. -> Mitigation: document and type the distinction between canonical agent identities, backend routes, and internal workflow steps.
- [Risk] Future additions can still bypass the registry. -> Mitigation: require backend and frontend references to use the shared `AgentId`/lookup and keep the consistency check close to the catalog.

## Migration Plan

1. Add the shared registry with the current 15 supported identities and canonical weather ID.
2. Convert shared summaries/types and the frontend catalog to consume it.
3. Update backend tool metadata and compile-time/runtime consistency checks.
4. Search for stale `getweather`, `calculator`, `translator`, and `scheduler` references within the TD-07 scope.
5. Run focused checks and `npx tsc --noEmit`.

Rollback is a source revert: the change introduces no database migration, endpoint, or external dependency.
