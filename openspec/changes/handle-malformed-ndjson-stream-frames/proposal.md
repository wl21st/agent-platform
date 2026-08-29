## Why

The chat client parses newline-delimited stream events without an error boundary. A malformed event currently aborts the entire response, discards any later valid events, and leaves the user with an opaque failed stream. The frontend needs resilient per-frame handling now because the backend and Fastify adapters both expose long-lived NDJSON streams.

## What Changes

- Add a focused NDJSON stream parsing boundary for the chat client.
- Ignore blank frames and handle malformed JSON frames without rejecting the complete stream.
- Validate the parsed event envelope before dispatching it as a `StreamEvent`.
- Log safe frame-level diagnostics and continue processing later valid events when recovery is possible.
- Detect end-of-stream without a terminal `done` or `error` event and surface an incomplete-stream failure.
- Add automated coverage for split frames, malformed frames, invalid event shapes, blank lines, and recovery after malformed input.

## Capabilities

### New Capabilities

- `robust-ndjson-streaming`: Resilient client-side consumption of chat NDJSON streams, including malformed-frame recovery and incomplete-stream reporting.

### Modified Capabilities

None.

## Impact

- `src/app/components/ChatInterface.tsx` stream consumption and error state handling.
- A small reusable parser/consumer module and focused tests.
- No wire-format change to `/api/chat` or the Fastify `/chat` endpoint.
- No new runtime dependency is required; the existing NDJSON contract remains newline-delimited JSON.
