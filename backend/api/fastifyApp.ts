import Fastify from 'fastify';
import cors from '@fastify/cors';

import type { ChatRequestBody } from '@/lib/agent-chat';
import { deleteSession, getOrCreateSession } from '@backend/memory/sessionStore';
import { streamOrchestratorSession } from '@backend/orchestrator/agentOrchestrator';

export async function createFastifyApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/session/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return getOrCreateSession(sessionId);
  });

  app.delete('/session/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    deleteSession(sessionId);
    return { success: true };
  });

  app.post('/chat', async (request, reply) => {
    const body = (request.body ?? {}) as Partial<ChatRequestBody>;

    if (!body.message?.trim()) {
      reply.code(400);
      return { error: 'Message is required.' };
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });

    for await (const event of streamOrchestratorSession({
      sessionId: body.sessionId,
      input: body.message.trim(),
    })) {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    }

    reply.raw.end();
  });

  return app;
}
