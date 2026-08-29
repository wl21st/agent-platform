## 1. Shared Cancellation Model

- [x] 1.1 Add explicit `cancelled` values to the shared `ChatMessage` and `TaskStatus` status types, and verify all existing status consumers still type-check.
- [x] 1.2 Add shared abort-detection and checkpoint helpers, and verify intentional abort errors remain distinguishable from ordinary errors.
- [x] 1.3 Extend `ToolExecutionContext` and LLM helper parameter types with an optional `AbortSignal`, and verify the full TypeScript project compiles.

## 2. Client Request Lifecycle

- [x] 2.1 Add an active-request ref in `ChatInterface` containing the controller, request identity, and assistant placeholder identity, and verify each generation creates exactly one controller.
- [x] 2.2 Pass the active controller signal to `/api/chat` and render an accessible Stop action only while a generation is active, verifying idle mode does not expose the active-generation action.
- [x] 2.3 Implement intentional-abort handling that preserves partial assistant content, marks the message and active tasks as cancelled, and avoids generic connection-error state; verify this behavior with focused cancellation tests or a deterministic mocked stream.
- [x] 2.4 Abort and invalidate the active request before New Chat and Clear History state changes, and verify late events from the superseded request do not mutate the replacement conversation.
- [x] 2.5 Abort the active request during component unmount and guard `finally` cleanup by request identity, verifying no post-unmount state update or stale `isStreaming` reset occurs.

## 3. Next.js API and Orchestrator Propagation

- [x] 3.1 Bridge incoming request aborts and response-stream cancellation to a route-level controller in `src/app/api/chat/route.ts`, verifying cancelled streams do not enqueue error events or close an already-cancelled controller.
- [x] 3.2 Pass the route signal into `streamOrchestratorSession` and add checkpoints before mutations, workflow stages, awaited-result application, and streamed deltas, verifying no new stage starts after cancellation.
- [x] 3.3 Make the orchestrator's artificial streaming delay abort-aware and propagate the signal through standard, news, ingredient, stock, scan, and parallel workflow branches, verifying cancellation exits each branch without a terminal success event.
- [x] 3.4 Update parallel completion handling to keep rejection handlers attached, suppress cancelled results and preference updates, and verify already-started best-effort promises do not produce unhandled rejections.

## 4. LLM and External Integration Boundaries

- [x] 4.1 Forward the shared signal to OpenAI chat-completion calls and rethrow abort-related errors from fallback-catching helpers, verifying an aborted LLM request cannot silently generate fallback output.
- [x] 4.2 Forward composed caller-plus-timeout signals to native external `fetch` calls, verifying caller cancellation interrupts abort-aware weather, webpage, and ingredient HTTP requests.
- [x] 4.3 Add cancellation checkpoints around Yahoo Finance, Exa, and other non-abortable SDK operations, verifying later stages do not apply results after cancellation.
- [x] 4.4 Preserve and, where supported, trigger Puppeteer cleanup on abort, verifying browser resources are closed in both success and cancellation paths.

## 5. Focused Cancellation Verification

- [x] 5.1 Add Node test-runner coverage for intentional client aborts, partial-content preservation, cancelled status, and distinction from unexpected request failures, verifying with `node --import tsx --test`.
- [x] 5.2 Add route/orchestrator coverage for request-signal propagation, checkpoint behavior, stream cancellation, and stale-result suppression, verifying the same signal reaches abort-aware work.
- [x] 5.3 Add LLM/tool boundary coverage for signal forwarding, abort rethrow behavior, best-effort non-abortable work, and resource cleanup, verifying no cancellation path is reported as a generic failure.

## 6. Final Validation

- [x] 6.1 Run focused cancellation tests and verify all Stop, supersession, unmount, propagation, and cleanup scenarios pass.
- [x] 6.2 Run targeted ESLint on changed files and verify cancellation changes introduce no new diagnostics beyond any documented baseline.
- [x] 6.3 Run `npm run build` and verify the production build completes, or document any environment-related failure separately from cancellation behavior. (Build compilation and TypeScript passed; page-data collection requires `EXA_API_KEY` because the existing Exa client is instantiated at module load.)
