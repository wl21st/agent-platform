import { deleteSession, getOrCreateSession } from '@backend/memory/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  return Response.json(getOrCreateSession(sessionId));
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  deleteSession(sessionId);
  return Response.json({ success: true });
}
