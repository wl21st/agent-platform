## 1. Streaming Parser Boundary

- [ ] 1.1 Add a focused client-side NDJSON utility and runtime `StreamEvent` envelope guard, verifying that the module type-checks and rejects null, unknown, and incomplete event values.
- [ ] 1.2 Implement byte-chunk buffering, newline frame extraction, blank-frame skipping, and final `TextDecoder` flushing, verifying that split and unterminated valid frames produce the expected events.
- [ ] 1.3 Add per-frame diagnostics that skip malformed JSON or invalid event envelopes without exposing raw payloads, verifying that parsing continues after an invalid frame and records only safe metadata.
- [ ] 1.4 Return or expose terminal-event status from the stream consumer and report EOF without a valid `done` or `error` event as incomplete, verifying that truncated streams cannot appear successfully complete.

## 2. Parser Test Coverage

- [ ] 2.1 Add Node test-runner coverage for valid frames, whitespace frames, frames split across reads, and UTF-8 data split across reads, verifying with `node --import tsx --test` against the focused test file.
- [ ] 2.2 Add Node test-runner coverage for malformed JSON, invalid event shapes, malformed intermediate frames followed by valid events, and malformed final frames, verifying recovery diagnostics and terminal status.
- [ ] 2.3 Assert that diagnostic output omits raw frame content, verifying the privacy constraint with a payload containing representative user text.

## 3. Chat Interface Integration

- [ ] 3.1 Replace the direct `JSON.parse` calls in `ChatInterface.tsx` with the streaming utility while preserving the existing `handleStreamEvent` state transitions, verifying that valid session, task, message, agent-done, done, and error events still update the UI state.
- [ ] 3.2 Integrate incomplete-stream failures with the existing connection, task, and assistant-message error state while preserving the outer handling for HTTP, reader, and network failures, verifying with the focused parser/integration tests.

## 4. Verification

- [ ] 4.1 Run the focused NDJSON tests and verify all malformed-frame, recovery, final-buffer, and incomplete-stream scenarios pass.
- [ ] 4.2 Run targeted ESLint on the changed files and verify TD-01 introduces no new diagnostics beyond the documented repository baseline.
- [ ] 4.3 Run `npm run build` and verify the production build completes, or document any environment-related failure separately from TD-01 behavior.
