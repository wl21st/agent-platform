import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abortableDelay, cancelChatState, isAbortError, throwIfAborted, withTimeoutSignal } from './cancellation';

test('abort helpers distinguish cancellation from ordinary errors', () => {
  const controller = new AbortController();
  assert.equal(isAbortError(new Error('ordinary failure')), false);
  throwIfAborted(controller.signal);

  controller.abort();
  assert.equal(isAbortError(new Error('wrapped failure'), controller.signal), true);
  assert.throws(() => throwIfAborted(controller.signal), (error: unknown) => isAbortError(error));
});

test('abortableDelay rejects promptly when the signal is cancelled', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = abortableDelay(10_000, controller.signal);
  controller.abort();

  await assert.rejects(pending, (error: unknown) => isAbortError(error, controller.signal));
  assert.ok(Date.now() - startedAt < 1_000);
});

test('withTimeoutSignal forwards caller cancellation and cleans up', async () => {
  const caller = new AbortController();
  const composed = withTimeoutSignal(caller.signal, 10_000);
  caller.abort();

  assert.equal(composed.signal.aborted, true);
  composed.cleanup();
});

test('cancelChatState preserves partial content and cancels active tasks', () => {
  const state = cancelChatState(
    [
      { id: 'assistant-1', role: 'assistant', content: 'partial answer', timestamp: 'now', status: 'streaming' },
      { id: 'assistant-2', role: 'assistant', content: 'done answer', timestamp: 'now', status: 'done' },
    ],
    [
      { id: 'running', description: 'running', status: 'running' },
      { id: 'pending', description: 'pending', status: 'pending' },
      { id: 'completed', description: 'completed', status: 'completed' },
    ],
    'assistant-1',
  );

  assert.equal(state.messages[0]?.content, 'partial answer');
  assert.equal(state.messages[0]?.status, 'cancelled');
  assert.equal(state.messages[1]?.status, 'done');
  assert.deepEqual(state.tasks.map((task) => task.status), ['cancelled', 'cancelled', 'completed']);
});
