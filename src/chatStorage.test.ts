import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHAT_STORAGE_KEY,
  MAX_STORED_MESSAGES,
  clearCachedMessages,
  loadCachedMessages,
  saveCachedMessages,
  type ChatMessage,
} from './chatStorage'

describe('chatStorage', () => {
  let mockStore: Record<string, string> = {}

  beforeEach(() => {
    mockStore = {}
    const storageMock = {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStore[key] = value
      },
      removeItem: (key: string) => {
        delete mockStore[key]
      },
      clear: () => {
        mockStore = {}
      },
      get length() {
        return Object.keys(mockStore).length
      },
      key: (i: number) => Object.keys(mockStore)[i] ?? null,
    }

    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    mockStore = {}
  })

  it('returns an empty array when nothing is cached', () => {
    expect(loadCachedMessages()).toEqual([])
  })

  it('loads valid cached messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]
    mockStore[CHAT_STORAGE_KEY] = JSON.stringify(messages)

    expect(loadCachedMessages()).toEqual(messages)
  })

  it('filters out invalid or empty messages when loading', () => {
    const mixed = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '   ' },
      { role: 'unknown', content: 'Invalid role' },
      { role: 'user', content: '' },
      null,
      123,
    ]
    mockStore[CHAT_STORAGE_KEY] = JSON.stringify(mixed)

    expect(loadCachedMessages()).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('handles malformed JSON gracefully', () => {
    mockStore[CHAT_STORAGE_KEY] = '{not-valid-json'
    expect(loadCachedMessages()).toEqual([])
  })

  it('saves valid messages to localStorage', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
    ]
    saveCachedMessages(messages)

    expect(mockStore[CHAT_STORAGE_KEY]).toBeDefined()
    expect(JSON.parse(mockStore[CHAT_STORAGE_KEY])).toEqual(messages)
  })

  it('filters out pending empty assistant messages when saving', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '' },
    ]
    saveCachedMessages(messages)

    expect(JSON.parse(mockStore[CHAT_STORAGE_KEY])).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('filters out empty user messages when saving', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '   ' },
      { role: 'assistant', content: 'Hi there!' },
    ]
    saveCachedMessages(messages)

    expect(JSON.parse(mockStore[CHAT_STORAGE_KEY])).toEqual([
      { role: 'assistant', content: 'Hi there!' },
    ])
  })

  it('caps saved history at MAX_STORED_MESSAGES', () => {
    const messages: ChatMessage[] = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i}`,
    }))
    saveCachedMessages(messages)

    const saved = JSON.parse(mockStore[CHAT_STORAGE_KEY]) as ChatMessage[]
    expect(saved).toHaveLength(MAX_STORED_MESSAGES)
    expect(saved[0]).toEqual({ role: 'user', content: 'Message 10' })
  })

  it('removes storage key when saving empty messages', () => {
    mockStore[CHAT_STORAGE_KEY] = JSON.stringify([{ role: 'user', content: 'Hello' }])
    saveCachedMessages([])
    expect(mockStore[CHAT_STORAGE_KEY]).toBeUndefined()
  })

  it('clears cached messages', () => {
    mockStore[CHAT_STORAGE_KEY] = JSON.stringify([{ role: 'user', content: 'Hello' }])
    clearCachedMessages()
    expect(mockStore[CHAT_STORAGE_KEY]).toBeUndefined()
  })
})
