import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAbortError } from '@/lib/cancellation';

test('orchestrator stops at a cancellation checkpoint without a terminal event', async () => {
  const previousExaApiKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = previousExaApiKey || 'test-api-key';
  const { streamOrchestratorSession } = await import('./agentOrchestrator');
  const controller = new AbortController();
  const stream = streamOrchestratorSession({
    input: 'hello',
    signal: controller.signal,
  });

  assert.equal((await stream.next()).value?.type, 'session');
  assert.equal((await stream.next()).value?.type, 'tasks');
  controller.abort();

  await assert.rejects(stream.next(), (error: unknown) => isAbortError(error, controller.signal));

  if (previousExaApiKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = previousExaApiKey;
});
