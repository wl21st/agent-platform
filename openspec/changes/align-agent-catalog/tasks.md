## 1. Shared Catalog

- [ ] 1.1 Create the browser-safe canonical agent registry with the 15 supported identities and complete presentation metadata, and verify every record has a unique ID.
- [ ] 1.2 Derive or validate `AgentId` and `AgentSummary` values from the canonical registry while preserving the existing streamed `{ id, name, icon }` shape, and verify `npx tsc --noEmit` passes.

## 2. Frontend Integration

- [ ] 2.1 Replace the duplicated frontend agent objects with a registry adapter or re-export, and verify the rendered catalog contains each supported agent exactly once.
- [ ] 2.2 Remove `calculator`, `translator`, `scheduler`, and `getweather` from frontend-facing catalog data and use `weather` as the canonical weather ID, and verify a repository search finds no TD-07 catalog references to those IDs.

## 3. Backend Integration

- [ ] 3.1 Update backend tool metadata to reference canonical agent identities and resolve display names from the shared registry while keeping executable handlers backend-only, and verify all tool definitions resolve to known agent IDs.
- [ ] 3.2 Preserve the distinction between workflow routes and agent identities, including `stock-analysis` and the internal investment pipeline, and verify no new `stock-analysis` frontend catalog entry is introduced.

## 4. Consistency Verification

- [ ] 4.1 Add focused consistency coverage for unique catalog IDs, deprecated ghost-agent absence, weather ID normalization, and unknown backend references, and verify the focused checks pass.
- [ ] 4.2 Run the TypeScript check and relevant lint or test commands, inspect the final diff for scope, and verify only the shared catalog, frontend adapter, backend metadata references, and focused checks changed.
