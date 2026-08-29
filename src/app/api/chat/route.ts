import type { ChatRequestBody, StreamEvent } from '@/lib/agent-chat';
import { isAbortError } from '@/lib/cancellation';
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
  const routeController = new AbortController();
  const abortRoute = () => {
    if (!routeController.signal.aborted) {
      routeController.abort(request.signal.reason);
    }
  };

  if (request.signal.aborted) {
    abortRoute();
  } else {
    request.signal.addEventListener('abort', abortRoute, { once: true });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      try {
        for await (const event of streamOrchestratorSession({
          sessionId: body.sessionId,
          input: message,
          signal: routeController.signal,
        })) {
          if (routeController.signal.aborted) {
            break;
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        if (isAbortError(error, routeController.signal)) {
          return;
        }
        const payload: StreamEvent = {
          type: 'error',
          message: error instanceof Error ? error.message : 'Unexpected orchestration error.',
        };
        if (!routeController.signal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        }
      } finally {
        request.signal.removeEventListener('abort', abortRoute);
        if (!routeController.signal.aborted && !closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel(reason) {
      if (!routeController.signal.aborted) {
        routeController.abort(reason);
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
