export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export const CHAT_STORAGE_KEY = 'chat_history'

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

    return parsed.filter(
      (msg): msg is ChatMessage =>
        typeof msg === 'object' &&
        msg !== null &&
        (msg.role === 'user' || msg.role === 'assistant') &&
        typeof msg.content === 'string' &&
        msg.content.trim().length > 0,
    )
  } catch (err) {
    console.error('Failed to load cached chat history:', err)
    return []
  }
}

/**
 * Saves chat messages to localStorage.
 * Excludes pending/empty assistant messages so interrupted streams aren't cached blank.
 */
export function saveCachedMessages(messages: ChatMessage[]): void {
  try {
    const validMessages = messages.filter(
      (msg) =>
        (msg.role === 'user' || msg.role === 'assistant') &&
        (msg.role !== 'assistant' || msg.content.length > 0),
    )

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
