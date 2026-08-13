# Repository Guidelines

TypeScript multi-agent platform using Next.js 16, React, Fastify-compatible backend modules, and OpenAI-compatible LLM clients.

## Project Structure

- `src/app/` contains the App Router UI, React components, and route handlers (`api/chat` and `api/session/[sessionId]`).
- `src/lib/` contains shared client types and helpers.
- `backend/agents/` contains specialized agents; `backend/orchestrator/` coordinates routing, workflows, and streaming.
- `backend/llm/` contains the LLM client and its tests; `backend/memory/` contains the in-memory session store.
- `backend/api/` contains the Fastify application entry point. `openspec/` contains spec-driven change configuration.

## Build, Test, and Development Commands

```bash
npm install                              # Install locked dependencies
npm run dev                              # Start the local Next.js server
npm run lint                             # Run ESLint
node --import tsx --test backend/llm/openai.test.ts  # Run the Node test
npm run build                            # Create a production build
npm run start                            # Serve a completed production build
npm run liquidity                        # Run the liquidity utility
```

Run `npm run build` before opening a PR for route, configuration, or shared-type changes. The liquidity command may make external market-data requests.

## Coding Style and Naming

Use strict TypeScript, two-space indentation, semicolons, and the existing single-quoted style. Use `PascalCase` for React components and `camelCase` for functions, variables, and agent modules. Keep App Router handlers in `route.ts` files and use the configured `@/*` and `@backend/*` aliases. Run `npm run lint` on every code change; do not edit generated `.next/` files.

## Testing Guidelines

Tests use Node’s built-in `node:test` and `node:assert/strict`; name files `*.test.ts` beside the relevant backend area. Extend focused tests for changed LLM, orchestration, or session behavior. There is currently no coverage threshold or aggregate test script, so report the exact commands and results in the PR.

## Configuration and Security

Keep credentials in ignored `.env*` files, never in commits or client code. The LLM integration reads `LLM_API_KEY`, `LLM_API_BASE_URL` or `LLM_API_URL`, and `LLM_BASE_MODEL`; optional integrations use `EXA_API_KEY`, `WEATHERAPI_API_KEY`, and OpenRouter metadata variables.

## Commits and Pull Requests

Recent commits use concise English or Chinese subjects without a strict Conventional Commits format. Use an imperative subject, for example `agents: add weather fallback`. PRs should explain behavior changes, link an issue when applicable, list validation commands, call out configuration changes, and include UI screenshots when relevant.

## Next.js Compatibility

This is not the Next.js version assumed by generic examples. Its APIs and conventions may differ. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and follow its deprecation notices.
