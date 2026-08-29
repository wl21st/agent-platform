## Why

The chat frontend keeps `/api/chat` requests open until the orchestrator finishes, even when the user no longer wants the response. There is no Stop action, and disconnecting the browser alone does not propagate cancellation to the server-side orchestration, allowing avoidable LLM, API, and tool work to continue.

## What Changes

- Add a user-visible Stop action for an active chat generation.
- Create and retain one `AbortController` per active chat request and pass its signal to `/api/chat`.
- Abort active work when the user stops generation, starts or clears a conversation, or unmounts the chat interface.
- Distinguish intentional cancellation from request failures and preserve any partial response with an explicit cancelled state.
- Prevent events from an aborted or superseded request from mutating the current conversation.
- Propagate the request signal through the Next.js chat route and orchestrator workflow checkpoints.
- Pass cancellation signals to direct OpenAI requests and abort-aware external fetches where supported.
- Treat cancellation of non-abortable integrations, such as some Yahoo Finance or Puppeteer operations, as best-effort and ensure resources are cleaned up.

## Capabilities

### New Capabilities

- `chat-stream-cancellation`: Allows users to stop an in-progress chat generation while keeping the UI and server-side orchestration from continuing unnecessary work where cancellation is supported.

### Modified Capabilities

None.

## Impact

- Frontend: `src/app/components/ChatInterface.tsx` and the chat generation UI state.
- API boundary: `src/app/api/chat/route.ts` request and stream lifecycle.
- Backend: `backend/orchestrator/agentOrchestrator.ts`, LLM request helpers, tool execution context, and abort-aware integrations.
- Tests: focused cancellation coverage using the existing TypeScript/Node test setup; broader frontend test infrastructure remains outside this change.
- No new runtime dependency or wire-format change is required.
