export type ChatMessage = {
  id?: string
  role: 'user' | 'assistant'
  content: string
}

export const CHAT_STORAGE_KEY = 'chat_history'

// Persisted history is capped so localStorage usage stays bounded over long sessions.
export const MAX_STORED_MESSAGES = 50

/**
 * Loads cached chat messages from localStorage.
 * Filters out invalid entries and empty placeholder messages.
 */
export function loadCachedMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(
        (msg): msg is ChatMessage =>
          typeof msg === 'object' &&
          msg !== null &&
          (msg.role === 'user' || msg.role === 'assistant') &&
          typeof msg.content === 'string' &&
          msg.content.trim().length > 0,
      )
      .map((msg) => ({
        ...(typeof msg.id === 'string' ? { id: msg.id } : {}),
        role: msg.role,
        content: msg.content,
      }))
  } catch (err) {
    console.error('Failed to load cached chat history:', err)
    return []
  }
}

/**
 * Saves chat messages to localStorage.
 * Keeps at most MAX_STORED_MESSAGES and excludes empty/whitespace messages
 * so pending or interrupted streams aren't cached blank.
 */
export function saveCachedMessages(messages: ChatMessage[]): void {
  try {
    const validMessages = messages
      .slice(-MAX_STORED_MESSAGES)
      .filter(
        (msg) =>
          (msg.role === 'user' || msg.role === 'assistant') && msg.content.trim().length > 0,
      )
      .map((msg) => ({
        ...(typeof msg.id === 'string' ? { id: msg.id } : {}),
        role: msg.role,
        content: msg.content,
      }))

    if (validMessages.length > 0) {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(validMessages))
    } else {
      localStorage.removeItem(CHAT_STORAGE_KEY)
    }
  } catch (err) {
    console.error('Failed to save chat history to cache:', err)
  }
}

/**
 * Clears cached chat history from localStorage.
 */
export function clearCachedMessages(): void {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY)
  } catch (err) {
    console.error('Failed to clear cached chat history:', err)
  }
}
