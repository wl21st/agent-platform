import {
  type ChatMessage,
  type SessionSnapshot,
  type UserPreferences,
} from '@/lib/agent-chat';

type SessionRecord = SessionSnapshot;
const globalForSessions = globalThis as typeof globalThis & {
  __agentPlatformSessions?: Map<string, SessionRecord>;
};

const sessions = globalForSessions.__agentPlatformSessions ?? new Map<string, SessionRecord>();

if (!globalForSessions.__agentPlatformSessions) {
  globalForSessions.__agentPlatformSessions = sessions;
}

function cloneSession(session: SessionRecord): SessionSnapshot {
  return {
    ...session,
    history: [...session.history],
    preferences: {
      ...session.preferences,
      recentSearchTopics: [...session.preferences.recentSearchTopics],
      lastWeatherResult: session.preferences.lastWeatherResult
        ? { ...session.preferences.lastWeatherResult }
        : undefined,
    },
  };
}

function createSession(sessionId: string): SessionRecord {
  const now = new Date().toISOString();
  return {
    sessionId,
    history: [],
    preferences: {
      recentSearchTopics: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function getOrCreateSession(sessionId: string) {
  const existing = sessions.get(sessionId);
  if (existing) {
    return cloneSession(existing);
  }

  const created = createSession(sessionId);
  sessions.set(sessionId, created);
  return cloneSession(created);
}

export function appendMessage(sessionId: string, message: ChatMessage) {
  const current = sessions.get(sessionId) ?? createSession(sessionId);
  current.history.push(message);
  current.updatedAt = new Date().toISOString();
  sessions.set(sessionId, current);
  return cloneSession(current);
}

export function updatePreferences(sessionId: string, updates: Partial<UserPreferences>) {
  const current = sessions.get(sessionId) ?? createSession(sessionId);

  current.preferences = {
    ...current.preferences,
    ...updates,
    lastWeatherResult: updates.lastWeatherResult ?? current.preferences.lastWeatherResult,
    recentSearchTopics: Array.from(
      new Set([
        ...(updates.recentSearchTopics ?? []),
        ...current.preferences.recentSearchTopics,
      ])
    ).slice(0, 10),
  };
  current.updatedAt = new Date().toISOString();
  sessions.set(sessionId, current);

  return cloneSession(current);
}

export function deleteSession(sessionId: string) {
  return sessions.delete(sessionId);
}
