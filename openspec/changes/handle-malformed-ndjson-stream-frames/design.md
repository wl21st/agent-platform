## Context

See `proposal.md` for the motivation and scope. The current client owns the complete NDJSON read loop in `ChatInterface.tsx`: it decodes byte chunks, accumulates newline-delimited frames, and dispatches parsed events. The backend emits JSON followed by `\n`, but the client currently treats the TypeScript `StreamEvent` assertion as runtime validation and has no per-frame failure boundary.

The stream contains both intermediate progress events and a terminal `done` or `error` event. A malformed intermediate frame should not discard later valid events, while an EOF without a terminal event must not look like a successful completion.

## Goals / Non-Goals

**Goals:**

- Make byte-chunk and line-buffer handling reusable and independently testable.
- Tolerate blank lines, split frames, malformed JSON, and invalid event envelopes.
- Continue after recoverable frame errors and preserve later valid events.
- Flush the `TextDecoder` at EOF so a final partial UTF-8 sequence is handled explicitly.
- Distinguish recovered frame issues from network failures and incomplete streams.

**Non-Goals:**

- Changing the `/api/chat` or Fastify wire format.
- Retrying requests or reconnecting to an interrupted stream.
- Adding cancellation support; that is covered by TD-02.
- Refactoring the rest of `ChatInterface` or changing message/task state modeling.
- Introducing a streaming library or a new runtime dependency.

## Decisions

### 1. Isolate the read loop in a small client utility

Add a focused utility under `src/lib` that accepts a response body and an event callback, owns `ReadableStreamDefaultReader`/`TextDecoder` buffering, and returns stream diagnostics such as whether a terminal event was observed. Keep UI state changes and `handleStreamEvent` in `ChatInterface`.

This keeps byte handling and malformed-frame policy out of the component without coupling the parser to React. An inline fix is smaller, but it leaves two parse sites (normal lines and the final buffer) easy to diverge and is harder to unit test. A third-party NDJSON/SSE library is unnecessary because the existing protocol is simple newline-delimited JSON and the backend contract is not changing.

### 2. Parse and validate each frame independently

For every non-blank complete line, the utility will:

1. Parse JSON inside its own `try/catch`.
2. Verify that the result is a non-null object with a recognized `type` discriminator and the required fields for that event type.
3. Invoke the event callback only for a valid `StreamEvent`.
4. Report a safe diagnostic containing the frame number and error reason, without logging the full payload.

Malformed frames will be skipped and processing will continue. A manual type guard is preferred over a new schema dependency because the event union is small and already defined in `src/lib/agent-chat.ts`. The guard prevents syntactically valid values such as `null`, `{}`, or an unknown event type from reaching `handleStreamEvent`.

### 3. Treat terminal events as an explicit completion invariant

The consumer will track whether a valid `done` or `error` event was dispatched. After the reader ends, a non-empty buffered line will be processed through the same frame path, then the decoder will be flushed. If no terminal event was observed, the caller will surface an incomplete-stream error through the existing connection/task/message error state.

Malformed intermediate frames followed by a valid terminal event are recoverable: the response completes and the issue remains a diagnostic. A malformed final frame or truncated stream without a terminal event is treated as incomplete so the UI does not leave the placeholder in an apparent streaming state.

### 4. Preserve the existing outer failure boundary

The component will continue using its outer `try/catch` for request failures, unavailable response bodies, reader failures, and explicit incomplete-stream errors. Per-frame parse failures will be handled by the utility and will not reject the loop. The existing `handleStreamEvent` callback remains the single place that applies session, task, message, done, and server-error events to React state.

### 5. Test the utility with the existing Node test runner

Add focused tests using Node's built-in `node:test` support already used by `backend/llm/openai.test.ts`. Tests will feed synthetic `ReadableStream<Uint8Array>` chunks and assert callback events, diagnostics, and terminal status. This avoids introducing Vitest or React Testing Library as part of TD-01; broader frontend test infrastructure remains TD-13.

## Risks / Trade-offs

- [A malformed frame may contain meaningful progress or content] → Skip only the invalid frame, continue when possible, and mark EOF without `done`/`error` as incomplete.
- [Strict envelope validation may reject a future event type] → Centralize the type guard beside the `StreamEvent` contract and require a deliberate contract/test update for new event types.
- [Diagnostics could expose streamed user or agent content] → Log frame number and sanitized error metadata only; do not include the raw frame.
- [The component may still receive many valid events during a stream] → Keep this change limited to correctness and recovery; rendering throttling remains TD-10.
- [No terminal event can be recovered after a network disconnect] → Surface the existing connection error state rather than claiming success; reconnect behavior is out of scope.

## Migration Plan

1. Add the utility and its tests.
2. Replace the direct parsing loop in `ChatInterface.tsx` with the utility callback integration.
3. Run the focused tests, lint, and the production build; distinguish pre-existing lint failures from TD-01 failures.
4. Roll back by reverting the utility and the small `ChatInterface` integration; no persisted data or server protocol migration is required.
