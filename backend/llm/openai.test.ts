import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

const originalApiKey = process.env.LLM_API_KEY;
const originalApiBaseUrl = process.env.LLM_API_BASE_URL;
const originalModel = process.env.LLM_BASE_MODEL;

let server: ReturnType<typeof createServer>;
let serverUrl: string;
const requests: Array<{ authorization: string | undefined; model: string }> = [];

before(async () => {
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body) as { model: string };
    requests.push({
      authorization: request.headers.authorization,
      model: payload.model,
    });

    if (requests.length === 3) {
      setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { content: 'late response' } }] })), 500);
      return;
    }

    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: requests.length === 1
            ? '{"tool":"none","isFollowUp":false}'
            : 'mock assistant response',
        },
      }],
    }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address !== 'string');
      serverUrl = `http://127.0.0.1:${address.port}/v1`;
      resolve();
    });
  });

  process.env.LLM_API_KEY = 'test-api-key';
  process.env.LLM_API_BASE_URL = serverUrl;
  process.env.LLM_BASE_MODEL = 'test-model';
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  if (originalApiKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = originalApiKey;
  if (originalApiBaseUrl === undefined) delete process.env.LLM_API_BASE_URL;
  else process.env.LLM_API_BASE_URL = originalApiBaseUrl;
  if (originalModel === undefined) delete process.env.LLM_BASE_MODEL;
  else process.env.LLM_BASE_MODEL = originalModel;
});

test('LLM calls use the configured API key, base URL, and model', async () => {
  const { classifyUserIntent, generateAssistantResponse } = await import('./openai');
  const preferences = {} as Parameters<typeof classifyUserIntent>[0]['preferences'];

  const intent = await classifyUserIntent({ input: 'hello', history: [], preferences });
  const response = await generateAssistantResponse({ input: 'hello', toolResult: null, history: [], preferences });

  assert.equal(intent?.tool, 'none');
  assert.equal(response, 'mock assistant response');
  assert.deepEqual(requests, [
    { authorization: 'Bearer test-api-key', model: 'test-model' },
    { authorization: 'Bearer test-api-key', model: 'test-model' },
  ]);
});

test('LLM response generation rethrows an intentional abort', async () => {
  const { generateAssistantResponse } = await import('./openai');
  const controller = new AbortController();
  const preferences = { recentSearchTopics: [] };
  const pending = generateAssistantResponse({
    input: 'hello',
    toolResult: null,
    history: [],
    preferences,
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, (error: unknown) => controller.signal.aborted && error instanceof Error);
});
