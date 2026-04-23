'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  ORCHESTRATOR_AGENT,
  createId,
  createInitialMessages,
  type ChatMessage,
  type SessionSnapshot,
  type StreamEvent,
  type TaskStatus,
} from '@/lib/agent-chat';

interface DropdownMenuProps {
  onStartNewConversation: () => void;
  onClearHistory: () => void;
  onReloadHistory: () => void;
}

function DropdownMenu({
  onStartNewConversation,
  onClearHistory,
  onReloadHistory,
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen((current) => !current)}
        className="rounded p-2 hover:bg-gray-200 dark:hover:bg-gray-700"
        title="Chat options"
        type="button"
      >
        ⋮
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 mt-1 w-52 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={() => {
              onStartNewConversation();
              setIsOpen(false);
            }}
            className="w-full rounded-t-md px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            type="button"
          >
            Start New Conversation
          </button>
          <button
            onClick={() => {
              onReloadHistory();
              setIsOpen(false);
            }}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            type="button"
          >
            Reload Session History
          </button>
          <button
            onClick={() => {
              onClearHistory();
              setIsOpen(false);
            }}
            className="w-full rounded-b-md px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            type="button"
          >
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}

function createSessionId() {
  return crypto.randomUUID();
}

function getTaskClasses(status: TaskStatus['status']) {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200';
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

export default function ChatInterface() {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(createInitialMessages());
  const [tasks, setTasks] = useState<TaskStatus[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, []);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      const threshold = 100; // pixels from bottom
      const isNear = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
      isNearBottomRef.current = isNear;
      setIsNearBottom(isNear);
    }
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const loadSession = useCallback(async (nextSessionId: string) => {
    const response = await fetch(`/api/session/${nextSessionId}`);
    if (!response.ok) {
      throw new Error('Unable to load session state.');
    }

    const snapshot = (await response.json()) as SessionSnapshot;
    setMessages(snapshot.history.length > 0 ? snapshot.history : createInitialMessages());
    setTasks([]);
  }, []);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem('agents-platform-session-id') || createSessionId();
    window.localStorage.setItem('agents-platform-session-id', storedSessionId);
    setSessionId(storedSessionId);

    loadSession(storedSessionId).catch(() => {
      setMessages(createInitialMessages());
    });
  }, [loadSession]);

  const persistSession = useCallback((nextSessionId: string) => {
    setSessionId(nextSessionId);
    window.localStorage.setItem('agents-platform-session-id', nextSessionId);
  }, []);

  const resetConversation = useCallback((nextSessionId?: string) => {
    const session = nextSessionId || createSessionId();
    persistSession(session);
    setMessages(createInitialMessages());
    setTasks([]);
    setInputValue('');
    setConnectionError(null);
  }, [persistSession]);

  const handleReloadHistory = useCallback(() => {
    if (!sessionId) {
      return;
    }

    loadSession(sessionId).catch((error: unknown) => {
      setConnectionError(error instanceof Error ? error.message : 'Unable to reload session history.');
    });
  }, [loadSession, sessionId]);

  const handleClearHistory = useCallback(async () => {
    if (sessionId) {
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    }

    resetConversation();
  }, [resetConversation, sessionId]);

  const handleStartNewConversation = useCallback(() => {
    resetConversation();
  }, [resetConversation]);

  const activeTaskCount = useMemo(
    () => tasks.filter((task) => task.status === 'running' || task.status === 'pending').length,
    [tasks]
  );

  const handleStreamEvent = useCallback((event: StreamEvent, assistantMessageId: string) => {
    if (event.type === 'session') {
      persistSession(event.sessionId);
      return;
    }

    if (event.type === 'tasks') {
      setTasks(event.tasks);
      return;
    }

    if (event.type === 'message') {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: `${message.content}${event.delta}`,
                agent: event.agent ?? message.agent,
                status: 'streaming',
              }
            : message
        )
      );
      return;
    }

    if (event.type === 'agent-done') {
      // Insert a completed agent message before the streaming placeholder.
      // This allows multiple agents to show separate chat bubbles.
      setMessages((current) => {
        const placeholderIndex = current.findIndex((m) => m.id === assistantMessageId);
        const completedMessage: ChatMessage = {
          ...event.message,
          status: 'done',
        };

        if (placeholderIndex >= 0) {
          // Insert the agent's message before the placeholder and reset placeholder content
          const before = current.slice(0, placeholderIndex);
          const placeholder = current[placeholderIndex];
          const after = current.slice(placeholderIndex + 1);
          return [
            ...before,
            completedMessage,
            { ...placeholder, content: '', status: 'streaming' },
            ...after,
          ];
        }

        // Fallback: append at end
        return [...current, completedMessage];
      });
      return;
    }

    if (event.type === 'done') {
      setTasks(event.tasks);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...event.message,
                id: assistantMessageId,
                status: 'done',
              }
            : message
        )
      );
      return;
    }

    setConnectionError(event.message);
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: event.message,
              status: 'error',
              agent: ORCHESTRATOR_AGENT,
            }
          : message
      )
    );
  }, [persistSession]);

  const handleSendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();

    if (!trimmed || isStreaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    const assistantMessageId = createId('assistant');
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      agent: ORCHESTRATOR_AGENT,
      status: 'streaming',
    };

    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setMessages((current) => [...current, userMessage, assistantPlaceholder]);
    setInputValue('');
    setIsStreaming(true);
    setConnectionError(null);
    setTasks([
      {
        id: 'client-pending',
        description: 'Submitting request to backend orchestrator',
        status: 'running',
        agent: ORCHESTRATOR_AGENT.name,
      },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          message: trimmed,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Streaming request failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line) as StreamEvent;
          handleStreamEvent(event, assistantMessageId);
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as StreamEvent;
        handleStreamEvent(event, assistantMessageId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected request failure.';
      setConnectionError(message);
      setTasks([
        {
          id: 'request-error',
          description: message,
          status: 'failed',
          agent: ORCHESTRATOR_AGENT.name,
        },
      ]);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                content: message,
                status: 'error',
              }
            : item
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }, [handleStreamEvent, inputValue, isStreaming, sessionId]);

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-gray-900">
      <div className="fixed top-0 left-16 right-0 z-10 flex items-center justify-between border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={handleStartNewConversation}
            className="px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600"
            type="button"
          >
            New Chat
          </button>
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">Chat</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Session: <span className="font-mono">{sessionId || 'initializing'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              isStreaming
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200'
                : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
            }`}
          >
            {isStreaming ? 'Streaming response' : 'Idle'}
          </span>
          <DropdownMenu
            onStartNewConversation={handleStartNewConversation}
            onClearHistory={handleClearHistory}
            onReloadHistory={handleReloadHistory}
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 pt-16">
        {/* Active Tasks Column */}
        <div className={`${isCollapsed ? 'w-12' : 'w-72'} border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 transition-all duration-300 flex flex-col min-h-0`}>
          <div className="flex items-center justify-between p-5 pb-1 border-b border-gray-200 dark:border-gray-700">
            {!isCollapsed && <h3 className="font-semibold text-gray-800 dark:text-gray-200">Active Tasks</h3>}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              type="button"
            >
              {isCollapsed ? '▶' : '◀'}
            </button>
            {!isCollapsed && <span className="text-xs text-gray-500 dark:text-gray-400">{activeTaskCount} active</span>}
          </div>

          {!isCollapsed && (
            <div className="flex-1 pt-8 pb-4 px-4 overflow-y-auto">
              <div className="space-y-2">
                {tasks.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No active tasks. Submit a message to start orchestration.</p>
                ) : (
                  tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div>
                        <p className="text-sm text-gray-800 dark:text-gray-200">{task.description}</p>
                        {task.agent && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{task.agent}</p>
                        )}
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${getTaskClasses(task.status)}`}>
                        {task.status}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {connectionError && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{connectionError}</p>
              )}
            </div>
          )}
        </div>

        {/* Chat Column */}
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 min-h-0" ref={messagesContainerRef} onScroll={handleScroll}>
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'max-w-xs lg:max-w-2xl bg-blue-500 text-white'
                      : 'max-w-[90%] bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                  } overflow-hidden`}
                >
                  {message.role === 'assistant' && message.agent && (
                    <div className="mb-2 flex items-center gap-2 border-b border-gray-200 pb-2 dark:border-gray-600">
                      <span className="text-lg">{message.agent.icon}</span>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {message.agent.name}
                      </span>
                      {message.status && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-700 dark:bg-gray-600 dark:text-gray-100">
                          {message.status}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="text-sm break-words">
                    {message.role === 'user' ? (
                      <p className="break-all">{message.content}</p>
                    ) : (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => <h1 className="mb-2 text-lg font-bold">{children}</h1>,
                            h2: ({ children }) => <h2 className="mb-1 text-base font-semibold">{children}</h2>,
                            h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
                            p: ({ children }) => <p className="mb-2 break-words">{children}</p>,
                            ul: ({ children }) => <ul className="mb-2 list-inside list-disc">{children}</ul>,
                            ol: ({ children, start }) => <ol start={start} className="mb-2 list-inside list-decimal">{children}</ol>,
                            li: ({ children }) => <li className="mb-1 break-words">{children}</li>,
                            pre: ({ children }) => (
                              <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-200 p-2 text-xs dark:bg-gray-600">
                                {children}
                              </pre>
                            ),
                            code: ({ children }) => (
                              <code className="rounded bg-gray-200 px-1 py-0.5 text-xs break-words dark:bg-gray-600">
                                {children}
                              </code>
                            ),
                            table: ({ children }) => (
                              <div className="mb-3 overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
                                <table className="min-w-full text-xs">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <thead className="bg-gray-200 dark:bg-gray-600">{children}</thead>
                            ),
                            tbody: ({ children }) => <tbody>{children}</tbody>,
                            tr: ({ children }) => (
                              <tr className="border-b border-gray-200 dark:border-gray-600">{children}</tr>
                            ),
                            th: ({ children }) => (
                              <th className="whitespace-nowrap px-3 py-1.5 text-left font-semibold">{children}</th>
                            ),
                            td: ({ children }) => (
                              <td className="whitespace-nowrap px-3 py-1 font-mono">{children}</td>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="mb-2 border-l-4 border-yellow-400 bg-yellow-50 py-1 pl-3 text-xs italic text-gray-700 dark:border-yellow-600 dark:bg-yellow-900/30 dark:text-gray-300">
                                {children}
                              </blockquote>
                            ),
                            hr: () => <hr className="my-3 border-gray-300 dark:border-gray-600" />,
                          }}
                        >
                          {message.content || (message.status === 'streaming' ? '_Waiting for streamed output..._' : '')}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>

                  <p className="mt-2 text-xs opacity-70">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="sticky bottom-0 border-t border-gray-200 p-4 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSendMessage().catch(() => undefined);
                  }
                }}
                placeholder="Ask for weather, search, or a general task..."
                className="flex-1 rounded-full bg-gray-100 dark:bg-gray-700 px-4 py-3 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => {
                  handleSendMessage().catch(() => undefined);
                }}
                disabled={isStreaming}
                className="rounded-full bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ml-2"
                type="button"
              >
                {isStreaming ? 'Working...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
