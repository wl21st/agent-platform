import assert from 'node:assert/strict';
import { test } from 'node:test';

test('chat route cancels the orchestrator when its response stream is cancelled', async () => {
  const previousExaApiKey = process.env.EXA_API_KEY;
  const previousLlmApiKey = process.env.LLM_API_KEY;
  process.env.EXA_API_KEY = previousExaApiKey || 'test-api-key';
  delete process.env.LLM_API_KEY;

  const { POST } = await import('./route');
  const requestController = new AbortController();
  const request = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
    signal: requestController.signal,
  });

  const response = await POST(request);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  const reader = response.body?.getReader();
  assert.ok(reader);

  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  assert.match(new TextDecoder().decode(firstChunk.value), /"type":"session"/);

  requestController.abort();
  await reader.cancel('client cancelled');

  if (previousExaApiKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = previousExaApiKey;
  if (previousLlmApiKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = previousLlmApiKey;
});
