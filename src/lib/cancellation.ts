import type { ChatMessage, TaskStatus } from './agent-chat';

/** Return true when an error represents cancellation rather than a failure. */
export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; code?: unknown };
    return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR' || candidate.code === 20;
  }

  return false;
}

/** Throw the signal's reason (or a standard AbortError) at a workflow checkpoint. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const error = new DOMException('The operation was aborted.', 'AbortError');
  throw error;
}

/** Sleep without keeping an aborted workflow alive until the next timer fires. */
export async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);

    const onAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

/** Compose a caller signal with a timeout while cleaning up both listeners. */
export function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMilliseconds: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeoutMilliseconds);

  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener('abort', abort, { once: true });
  }

  const cleanup = () => {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  };

  return { signal: controller.signal, cleanup };
}

/** Preserve streamed content while moving the active client state to cancelled. */
export function cancelChatState(
  messages: ChatMessage[],
  tasks: TaskStatus[],
  assistantMessageId: string,
) {
  return {
    messages: messages.map((message) => (
      message.id === assistantMessageId ? { ...message, status: 'cancelled' as const } : message
    )),
    tasks: tasks.map((task) => (
      task.status === 'running' || task.status === 'pending'
        ? { ...task, status: 'cancelled' as const }
        : task
    )),
  };
}
