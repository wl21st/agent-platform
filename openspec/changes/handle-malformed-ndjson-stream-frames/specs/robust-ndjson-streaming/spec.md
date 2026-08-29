## Purpose

Provide resilient client-side consumption of chat NDJSON streams so malformed or incomplete frames do not silently corrupt the user-visible response lifecycle.

## ADDED Requirements

### Requirement: The chat client SHALL preserve NDJSON frame boundaries across network chunks

The client SHALL combine partial data received across network reads until a newline-delimited frame is complete. Blank frames SHALL be ignored without affecting stream state.

#### Scenario: A JSON frame is split across network reads
- **WHEN** the first read ends in the middle of a JSON frame and a later read provides the remainder followed by a newline
- **THEN** the client dispatches one event for the reconstructed frame

#### Scenario: The stream contains blank lines
- **WHEN** a read contains empty or whitespace-only newline-delimited frames
- **THEN** the client ignores those frames and continues processing neighboring valid events

### Requirement: A malformed frame SHALL NOT abort the complete stream

When a complete frame is not valid JSON or does not match a recognized chat stream event, the client SHALL discard only that frame, record a diagnostic, and continue processing subsequent frames.

#### Scenario: A malformed frame occurs between valid events
- **WHEN** the stream contains a valid event, a malformed frame, and a later valid event
- **THEN** both valid events are dispatched and the malformed frame does not reject the stream reader

#### Scenario: A syntactically valid frame has an invalid event envelope
- **WHEN** the stream contains JSON with a null value, unknown type, or missing required event fields
- **THEN** the client treats it as a malformed frame, records a diagnostic, and does not dispatch it as a chat event

#### Scenario: A malformed frame is diagnosed
- **WHEN** the client records a parse or validation failure
- **THEN** the diagnostic identifies the frame and failure reason without including the raw frame payload

### Requirement: The client SHALL distinguish complete and incomplete stream termination

The client SHALL consider a response complete only after receiving a valid terminal `done` or `error` event. If the reader ends without a valid terminal event, the client SHALL surface an incomplete-stream failure through the existing chat error state rather than presenting the response as successfully completed.

#### Scenario: A valid terminal event follows a malformed frame
- **WHEN** one or more malformed frames occur but a valid `done` or `error` event is subsequently received
- **THEN** the client processes the terminal event and completes the response lifecycle

#### Scenario: The stream ends after a malformed or truncated final frame
- **WHEN** the reader ends without a valid terminal `done` or `error` event
- **THEN** the client marks the response as failed or incomplete and does not leave it appearing to stream indefinitely

### Requirement: The client SHALL handle final decoder data consistently

The client SHALL process any remaining decoded text at end-of-stream through the same frame validation and diagnostic rules used for frames received during normal reads.

#### Scenario: The final buffered text is a valid terminal frame
- **WHEN** the reader signals completion with a final buffered frame that is not followed by another newline
- **THEN** the client validates and dispatches that frame before determining stream completion

#### Scenario: The final buffered text is malformed
- **WHEN** the reader signals completion with a non-empty malformed final frame
- **THEN** the client records a diagnostic and reports an incomplete stream unless a valid terminal event was already received
