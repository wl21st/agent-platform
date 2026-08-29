## Context

See `proposal.md` for the motivation and scope. The browser currently owns an
NDJSON read loop in `ChatInterface`, but the request has no `AbortSignal`. The
Next.js route creates a `ReadableStream` around `streamOrchestratorSession`
without observing request or downstream-stream cancellation. The orchestrator
then dispatches several workflow shapes, including parallel tool execution,
without a shared cancellation context.

The existing `ChatMessage` and `TaskStatus` models distinguish streaming,
completed, and failed work, but do not represent intentional cancellation. The
session store appends completed agent messages and final responses; it is not a
durable generation journal.

## Goals / Non-Goals

**Goals:**

- Make cancellation a cooperative signal that crosses the client, Next.js
  route, orchestrator, LLM helpers, and abort-aware integrations.
- Keep the partial assistant content visible in the current client conversation
  and mark it as cancelled rather than failed.
- Prevent stale events and late workflow results from changing a superseding
  conversation.
- Stop starting new workflow work after an observed cancellation checkpoint and
  clean up resources for integrations that cannot abort immediately.
- Preserve the existing NDJSON event format and avoid adding a cancellation
  round trip that may not reach a disconnected client.

**Non-Goals:**

- Durable storage or cross-device recovery of a partially cancelled final
  response; the existing in-memory session-store design remains unchanged.
- Retrying, reconnecting, or resuming an interrupted generation.
- Guaranteeing immediate interruption for SDKs or browser automation APIs that
  do not accept an external signal.
- Refactoring the full `ChatInterface` component or introducing frontend test
  infrastructure.

## Decisions

### 1. Use one client request record for cancellation and stale-event protection

`ChatInterface` will keep the active request record in a ref containing the
`AbortController`, a request identity, and the assistant placeholder identity.
Starting a generation creates a new record. Stop, New Chat, Clear History, and
unmount all abort the controller and invalidate the record before changing
conversation state.

Every stream event handler will verify that its request identity is still the
active one. The `finally` block will clear `isStreaming` only when it belongs to
the active request, preventing an older request from changing state after a
new conversation has started.

Alternative considered: relying on `isStreaming` or the assistant message ID
alone. That does not protect a newly reset conversation because an old stream
can still call its captured callback after the message list has been replaced.

### 2. Treat intentional aborts as a local terminal UI transition

The Stop action will call `abort()` and immediately update the active
placeholder to `status: 'cancelled'`, retaining its accumulated content. Active
client tasks will also be represented as cancelled rather than failed. The
request catch path will ignore an `AbortError` when the controller was
intentionally aborted; HTTP, reader, and unexpected errors will continue
through the existing failure path.

The shared message/task types will gain explicit cancelled values. No new
stream event is required: once the request is aborted, a terminal server event
may be impossible to deliver, so the client owns the immediate cancellation
state. Partial final-response content is retained in the current React
conversation but is not newly appended to the server session store during this
change.

Alternative considered: adding a server-emitted `cancelled` event. That event
would be useful only when the connection remains usable, while the primary
case is a disconnected or aborted response. Local state is deterministic and
keeps the wire contract stable.

### 3. Bridge request and response-stream cancellation at the API boundary

The Next.js route will create a route-level controller and bridge both
`request.signal` and the `ReadableStream` underlying-source `cancel` callback
to it. The controller signal will be passed to
`streamOrchestratorSession({ signal })`.

The route will not enqueue an error event or close an already-cancelled
controller after abort. Non-abort failures will retain the existing NDJSON
`error` event behavior. Event-listener cleanup will happen when the stream
finishes or is cancelled.

Alternative considered: passing `request.signal` directly and omitting the
underlying-source cancellation hook. That depends on framework-specific
disconnect propagation and does not cover cancellation of the returned
response body reliably.

### 4. Make orchestration checkpoints explicit and shared

`streamOrchestratorSession` and each delegated workflow will accept an optional
`AbortSignal`. A small `throwIfAborted` helper will run before session-side
mutations, before each workflow stage, after awaited operations, and before
each streamed delta. The artificial streaming delay will become abort-aware
so cancellation does not wait for the next fixed timer.

Parallel workflows will pass the same signal to all already-started operations,
check it while consuming completion-order results, and avoid applying results
or preferences after cancellation. Promise rejection handlers will remain
attached to already-started work so best-effort background completion does not
become an unhandled rejection.

Alternative considered: cancelling only the top-level async generator. That
stops future yields but leaves awaited LLM/tool work running and can still
allow side effects before the generator is resumed.

### 5. Thread the signal through LLM and tool boundaries

The LLM helper parameter types will accept an optional signal and pass it to
the OpenAI request options. Catch blocks that currently fall back on any error
will rethrow abort-related errors so cancellation cannot silently become a
fallback response. The same signal will be added to `ToolExecutionContext`
and forwarded by every orchestrator tool invocation.

Native `fetch` calls will use the caller signal composed with their existing
timeouts. For Yahoo Finance, Exa, and other SDK calls that do not expose a
compatible signal, the implementation will check cancellation before starting
work, between batches/steps, and before applying results. Puppeteer work will
retain its `finally` browser cleanup and may close the active browser on
abort where the API permits.

Alternative considered: changing every integration to a new cancellation
library. This adds unnecessary runtime surface and cannot make third-party
SDKs abortable; cooperative checkpoints plus native signal support are the
appropriate boundary.

### 6. Keep the browser-facing route as the cancellation scope

The current browser calls `/api/chat`, so the Next.js route is the required API
boundary for this change. `backend/api/fastifyApp.ts` remains a separate adapter
and will not receive an unrelated protocol change; it should adopt the same
orchestrator signal contract if it becomes a caller of the cancellable chat
flow in a later change.

## Risks / Trade-offs

- [A non-abortable SDK can continue consuming resources after Stop] -> Check
  the signal at every boundary, do not start later stages, suppress its result,
  and preserve cleanup in `finally` blocks.
- [An abort may occur after a workflow has already persisted an intermediate
  agent message] -> Treat already-persisted completed agent messages as valid
  history and prevent only subsequent cancelled results from being applied.
- [A request can abort between a checkpoint and an external call] -> Pass the
  signal to native abort-aware calls and accept best-effort semantics for the
  remaining race window.
- [A stale request's `finally` can reset current UI state] -> Guard all state
  completion and cleanup by request identity.
- [Adding cancelled statuses affects rendering and runtime validation] -> Keep
  the status additions explicit in the shared types and cover both intentional
  abort and unexpected failure paths with focused tests.

## Migration Plan

1. Extend shared cancellation status/types and add small abort helpers.
2. Add the client request record, Stop action, abort cleanup, stale-event
   guard, and intentional-abort UI transition.
3. Bridge cancellation in the Next.js route and pass the signal into the
   orchestrator.
4. Thread the signal through workflow parameters, LLM helpers, tool context,
   native fetches, and best-effort integration checkpoints.
5. Add focused Node/TypeScript tests for signal forwarding, intentional abort
   handling, stale-event suppression, and non-abortable cleanup; run lint and
   the production build.

Rollback is a code-only revert of the client, route, orchestrator, and helper
changes. No persisted schema, wire-format migration, or data backfill is
required.

## Open Questions

None that change the selected approach or the requirements. Durable persistence
of cancelled partial responses is explicitly deferred with the existing session
storage work.
