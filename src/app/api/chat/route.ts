import type { ChatRequestBody, StreamEvent } from '@/lib/agent-chat';
import { streamOrchestratorSession } from '@backend/orchestrator/agentOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ChatRequestBody>;
  const message = body.message?.trim();

  if (!message) {
    return Response.json({ error: 'Message is required.' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamOrchestratorSession({
          sessionId: body.sessionId,
          input: message,
        })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        const payload: StreamEvent = {
          type: 'error',
          message: error instanceof Error ? error.message : 'Unexpected orchestration error.',
        };
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
