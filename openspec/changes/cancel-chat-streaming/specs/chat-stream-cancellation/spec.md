## Purpose

Allow users to stop an active chat generation while preserving the current conversation and cancelling server-side work wherever the runtime supports cancellation.

## ADDED Requirements

### Requirement: The chat client SHALL expose an explicit cancellation action for active generations

While a chat request is active, the client SHALL expose a Stop action and SHALL retain the partial assistant response when the user cancels generation. Cancellation SHALL be represented separately from an unexpected request failure.

#### Scenario: The user stops an active generation

- **WHEN** the user activates Stop while a chat response is streaming
- **THEN** the client aborts the active request
- **AND** the partial assistant response remains visible
- **AND** the conversation records the generation as cancelled rather than failed

#### Scenario: No generation is active

- **WHEN** the chat interface is idle
- **THEN** it does not present Stop as an active-generation action

### Requirement: Cancellation SHALL propagate through the chat request boundary

The client SHALL associate one `AbortController` with each active chat request and pass its signal to `/api/chat`. The API route and orchestrator SHALL observe that signal at workflow checkpoints and pass it to abort-aware LLM and external fetch operations.

#### Scenario: The user cancels a request with abort-aware work

- **WHEN** the active chat request is cancelled
- **THEN** the route and orchestrator observe the aborted signal
- **AND** abort-aware LLM or fetch operations receive the same cancellation signal
- **AND** no new work is started after an observed cancellation checkpoint

#### Scenario: A non-abortable integration is active

- **WHEN** cancellation occurs during an integration that cannot stop immediately
- **THEN** the integration is allowed to finish on a best-effort basis
- **AND** its resources are cleaned up
- **AND** its result is not applied to the cancelled current conversation

### Requirement: Cancellation SHALL invalidate superseded request events

The client SHALL prevent events from an aborted or superseded request from mutating the current conversation after the user starts or clears another conversation, or after the chat interface unmounts.

#### Scenario: A new conversation supersedes an active request

- **WHEN** the user starts or clears a conversation while a previous response is active
- **THEN** the previous request is aborted
- **AND** events that arrive from that request do not update the new conversation

#### Scenario: The chat interface unmounts during generation

- **WHEN** the chat interface unmounts while a request is active
- **THEN** the active request is aborted
- **AND** later stream events do not update unmounted chat state

### Requirement: Intentional cancellation SHALL remain distinct from transport failures

The client SHALL treat an intentional abort as cancellation, while HTTP failures, reader failures, and other unexpected request errors SHALL continue through the existing error handling path.

#### Scenario: An intentional abort is reported by the request

- **WHEN** the active request ends because its controller was intentionally aborted
- **THEN** the client does not present the abort as a generic connection failure
- **AND** it preserves any response content received before cancellation

#### Scenario: The request fails unexpectedly

- **WHEN** the request ends because of an HTTP, network, or reader failure without intentional cancellation
- **THEN** the client reports the failure through the existing connection, task, and assistant-message error state
