import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import './App.css'

import {
  clearCachedMessages,
  loadCachedMessages,
  saveCachedMessages,
  type ChatMessage,
} from './chatStorage'

import { Analytics } from '@vercel/analytics/react';

type ModelStatus = 'loading' | 'ready' | 'error'

// Only the most recent messages are sent to the model on each turn, keeping
// prompts small and the context window manageable over long sessions.
const MAX_CONTEXT_MESSAGES = 20

// The worker (and its model download) is a page-lifetime singleton so that
// React StrictMode's mount/unmount/remount cycle in dev doesn't spawn a
// second worker and re-download the model.
let workerInstance: Worker | null = null
function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerInstance.postMessage({ type: 'load' })
  }
  return workerInstance
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadCachedMessages().map((m) => ({ ...m, id: m.id ?? crypto.randomUUID() })),
  )
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ModelStatus>('loading')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const workerRef = useRef<Worker | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)

  useEffect(() => {
    const worker = getWorker()
    workerRef.current = worker

    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      switch (data.type) {
        case 'progress':
          // progress_total aggregates downloaded bytes across all model
          // files (including weight shards), so the bar advances smoothly
          if (data.status === 'progress_total' && typeof data.progress === 'number') {
            setProgress(Math.floor(data.progress))
          }
          break
        case 'ready':
          setStatus('ready')
          setProgress(null)
          break
        case 'token':
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + data.text }
            }
            return next
          })
          break
        case 'done':
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: data.text }
            }
            return next
          })
          setGenerating(false)
          break
        case 'error':
          setError(data.message)
          setStatus((s) => (s === 'loading' ? 'error' : s))
          setGenerating(false)
          // Remove the pending assistant placeholder, if any
          setMessages((prev) =>
            prev[prev.length - 1]?.role === 'assistant' && prev[prev.length - 1]?.content === ''
              ? prev.slice(0, -1)
              : prev,
          )
          break
      }
    }

    const handleError = (event: ErrorEvent) => {
      console.error('Worker error:', event)
      const details =
        event.message ||
        (event.filename ? `${event.filename}:${event.lineno}` : '') ||
        'Worker failed to initialize.'
      setError(details)
      setStatus('error')
      setGenerating(false)
    }

    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)

    return () => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
    }
  }, [])

  // Cache chat history at message boundaries (not on every streamed token)
  useEffect(() => {
    if (!generating) saveCachedMessages(messages)
  }, [messages, generating])

  const handleScroll = useCallback(() => {
    const el = historyRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  // Keep the chat history scrolled to the bottom if the user is already near the bottom
  useEffect(() => {
    const el = historyRef.current
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // Focus the input once the model is ready and after each reply (guard against mobile keyboard popups)
  useEffect(() => {
    const isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    if (status === 'ready' && !generating && !isCoarse) {
      inputRef.current?.focus()
    }
  }, [status, generating])

  // Close the drop-down menu on pointerdown outside or Escape key
  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || generating || status !== 'ready') return
    const all = [...messages, { id: crypto.randomUUID(), role: 'user' as const, content: text }]
    // Trim only the payload sent to the model; the visible chat keeps everything.
    // Ensure history sent to the model starts on a user turn to maintain proper chat template alternation.
    let history = all.slice(-MAX_CONTEXT_MESSAGES)
    const firstUserIndex = history.findIndex((m) => m.role === 'user')
    if (firstUserIndex > 0) {
      history = history.slice(firstUserIndex)
    }
    setMessages([...all, { id: crypto.randomUUID(), role: 'assistant', content: '' }])
    setInput('')
    setError(null)
    setGenerating(true)
    isAtBottomRef.current = true
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
    workerRef.current?.postMessage({
      type: 'generate',
      messages: history.map(({ role, content }) => ({ role, content })),
    })
  }, [input, generating, status, messages])

  const handleStop = useCallback(() => {
    workerRef.current?.postMessage({ type: 'abort' })
  }, [])

  const handleClearChat = useCallback(() => {
    setMessages([])
    clearCachedMessages()
    setError(null)
    setIsMenuOpen(false)
    const isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    if (!isCoarse) {
      inputRef.current?.focus()
    }
  }, [])

  const chatting = messages.length > 0
  const canSend = status === 'ready' && !generating && input.trim().length > 0
  const canClearChat = messages.length > 0 && !generating

  const composer = (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={input}
        placeholder="Enter your prompt"
        onChange={(e) => setInput(e.target.value)}
        autoFocus
      />
      {generating ? (
        <button type="button" className="send" onClick={handleStop} aria-label="Stop generating">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        </button>
      ) : (
        <button type="submit" className="send" disabled={!canSend} aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 12h15M13 5.5 19.5 12 13 18.5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </form>
  )

  return (
    <div className={`app${chatting ? ' chatting' : ''}`}>
      <div className="menu-container" ref={menuRef}>
        <button
          type="button"
          className="menu-trigger"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((prev) => !prev)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        {isMenuOpen && (
          <div className="menu-dropdown" role="menu">
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={handleClearChat}
              disabled={!canClearChat}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              <span>Clear Chat</span>
            </button>
          </div>
        )}
      </div>

      {status === 'loading' && (
        <div className="status-banner">
          {progress === null ? 'Loading model…' : `Downloading model… ${progress}%`}
          <span className="status-hint">
            The model runs locally in your browser; downloaded once, then cached.
          </span>
        </div>
      )}
      {(status === 'error' || (error && status === 'ready')) && (
        <div className="status-banner error">Model error: {error}</div>
      )}

      {chatting ? (
        <>
          <div className="history" ref={historyRef} onScroll={handleScroll}>
            {messages.map((message, i) => (
              <div key={message.id ?? `msg-${i}`} className={`message ${message.role}`}>
                {message.role === 'assistant' &&
                message.content === '' &&
                generating &&
                i === messages.length - 1 ? (
                  <span className="typing-dot" aria-label="Assistant is typing" />
                ) : message.role === 'assistant' ? (
                  <div className="markdown-content">
                    <Markdown
                      components={{
                        a: ({ ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {message.content}
                    </Markdown>
                  </div>
                ) : (
                  message.content
                )}
              </div>
            ))}
          </div>
          <div className="composer-dock">{composer}</div>
        </>
      ) : (
        <div className="empty-state">
          <h1 className="empty-state-title">I am Ryan's AI portfolio. Ask me anything.</h1>
          {composer}
        </div>
      )}
      <Analytics />
    </div>
  )
}

export default App
