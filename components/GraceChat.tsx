'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import MergePreview from './MergePreview'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface MergePreviewData {
  id_a: string
  id_b: string
  contact_a: Record<string, unknown>
  contact_b: Record<string, unknown>
  merged: Record<string, unknown>
}

interface Position {
  x: number
  y: number
}

export default function GraceChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // Merge preview
  const [mergePreviewData, setMergePreviewData] = useState<MergePreviewData | null>(null)
  const [showMergePreview, setShowMergePreview] = useState(false)

  // Undo
  const [undoToken, setUndoToken] = useState<string | null>(null)
  const [undoExpiresAt, setUndoExpiresAt] = useState<Date | null>(null)
  const [undoCountdown, setUndoCountdown] = useState(0)

  // Rate limit
  const [rateLimitedUntil, setRateLimitedUntil] = useState<Date | null>(null)
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('grace-chat-position')
    if (saved) {
      try { setPosition(JSON.parse(saved)) } catch {}
    } else {
      setPosition({ x: window.innerWidth - 400, y: window.innerHeight - 560 })
    }
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Persist position
  useEffect(() => {
    localStorage.setItem('grace-chat-position', JSON.stringify(position))
  }, [position])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  // ── Undo countdown ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!undoExpiresAt) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((undoExpiresAt.getTime() - Date.now()) / 1000))
      setUndoCountdown(remaining)
      if (remaining === 0) {
        setUndoToken(null)
        setUndoExpiresAt(null)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [undoExpiresAt])

  // ── Rate limit countdown ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!rateLimitedUntil) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((rateLimitedUntil.getTime() - Date.now()) / 1000))
      setRateLimitCountdown(remaining)
      if (remaining === 0) setRateLimitedUntil(null)
    }, 1000)
    return () => clearInterval(interval)
  }, [rateLimitedUntil])

  // ── Drag ────────────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragOffset || isMobile) return
    setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y })
  }, [dragOffset, isMobile])

  const handleMouseUp = () => setDragOffset(null)

  useEffect(() => {
    if (!dragOffset) return
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragOffset, handleMouseMove])

  // ── Send message ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || loading) return
    if (rateLimitedUntil && rateLimitedUntil > new Date()) return

    const userMessage: Message = { role: 'user', content: input.trim() }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    // Add empty assistant message we'll stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, session_id: sessionId }),
      })

      // Handle rate limit
      if (response.status === 429) {
        const data = await response.json()
        const retryDate = new Date(data.retry_after)
        setRateLimitedUntil(retryDate)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: data.message || 'Rate limit reached. Grace will be available shortly.',
          }
          return updated
        })
        return
      }

      if (!response.ok || !response.body) throw new Error('Request failed')

      // Parse NDJSON stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)

            if (event.t === 'tx') {
              // Append text to the last (assistant) message
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: updated[updated.length - 1].content + (event.v as string),
                }
                return updated
              })
            } else if (event.t === 'mp') {
              // Merge preview data — show the confirmation card
              setMergePreviewData(event.v as MergePreviewData)
              setShowMergePreview(true)
            } else if (event.t === 'done') {
              if (event.session_id) setSessionId(event.session_id as string)
            } else if (event.t === 'err') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: 'Something went wrong. Please try again.',
                }
                return updated
              })
            }
          } catch {
            // Partial or malformed line — skip
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Something went wrong connecting to Grace. Please try again.',
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  // ── Confirm merge ────────────────────────────────────────────────────────────
  const handleConfirmMerge = async (overrides: Record<string, unknown>) => {
    if (!mergePreviewData) return
    try {
      const res = await fetch('/api/assistant/confirm-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_keep: mergePreviewData.id_a,
          id_delete: mergePreviewData.id_b,
          field_overrides: overrides,
          session_id: sessionId,
        }),
      })
      const data = await res.json()
      setShowMergePreview(false)
      setMergePreviewData(null)
      if (data.undo_token) {
        setUndoToken(data.undo_token as string)
        setUndoExpiresAt(new Date(data.undo_expires_at as string))
        setUndoCountdown(60)
      }
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Done — contacts merged. You have 60 seconds to undo if you need to.' },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Merge failed. Please try again.' },
      ])
    }
  }

  // ── Undo ─────────────────────────────────────────────────────────────────────
  const handleUndo = async () => {
    if (!undoToken) return
    try {
      await fetch('/api/assistant/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_id: undoToken }),
      })
      setUndoToken(null)
      setUndoExpiresAt(null)
      setUndoCountdown(0)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Done — the merge has been undone.' },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Undo failed. Please try again.' },
      ])
    }
  }

  // ── Floating button ──────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-amber-400 hover:bg-amber-500 text-white font-semibold shadow-lg transition-colors flex items-center justify-center z-40"
        title="Grace — Chief of Staff"
        aria-label="Open Grace chat"
      >
        G
      </button>
    )
  }

  // ── Panel ────────────────────────────────────────────────────────────────────
  const panelClasses = isMobile
    ? 'fixed inset-x-0 bottom-0 h-2/3 rounded-t-2xl bg-white shadow-2xl flex flex-col z-50'
    : 'fixed bg-white rounded-xl shadow-2xl flex flex-col border border-gray-200 z-50'

  const panelStyle = isMobile
    ? {}
    : { left: `${position.x}px`, top: `${position.y}px`, width: '380px', height: '520px' }

  return (
    <div ref={panelRef} className={panelClasses} style={panelStyle}>

      {/* Header / drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-amber-400 to-amber-500 rounded-t-xl select-none ${
          isMobile ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white opacity-80" />
          <div>
            <p className="text-sm font-semibold text-white leading-tight">Grace</p>
            <p className="text-xs text-amber-100 leading-tight">Chief of Staff</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-white hover:bg-amber-600 rounded-lg p-1.5 transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center pt-8 space-y-1">
            <p className="text-sm text-gray-500">Hi Brian, I'm Grace.</p>
            <p className="text-xs text-gray-400">Ask me about contacts, events, or anything in CRAM.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.content || (loading && i === messages.length - 1 ? (
                <span className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                </span>
              ) : '')}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Undo toast */}
      {undoToken && undoCountdown > 0 && (
        <div className="mx-4 mb-1 px-3 py-2 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <span className="text-xs text-green-800">Merge done · undo in {undoCountdown}s</span>
          <button
            onClick={handleUndo}
            className="text-xs font-medium text-green-700 hover:text-green-900"
          >
            Undo
          </button>
        </div>
      )}

      {/* Rate limit notice */}
      {rateLimitedUntil && rateLimitCountdown > 0 && (
        <div className="mx-4 mb-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-800">
            Hourly limit reached. Grace resumes in {Math.floor(rateLimitCountdown / 60)}m {rateLimitCountdown % 60}s.
          </p>
        </div>
      )}

      {/* Merge preview overlay */}
      {showMergePreview && mergePreviewData && (
        <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center p-3 z-50">
          <MergePreview
            contactA={mergePreviewData.contact_a as Parameters<typeof MergePreview>[0]['contactA']}
            contactB={mergePreviewData.contact_b as Parameters<typeof MergePreview>[0]['contactB']}
            onConfirm={handleConfirmMerge}
            onCancel={() => {
              setShowMergePreview(false)
              setMergePreviewData(null)
            }}
            onClose={() => {
              setShowMergePreview(false)
              setMergePreviewData(null)
            }}
          />
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={rateLimitedUntil ? 'Rate limit — try again shortly…' : 'Ask Grace anything…'}
            disabled={loading || !!rateLimitedUntil}
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200 disabled:bg-gray-50 disabled:text-gray-400 placeholder-gray-400"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim() || !!rateLimitedUntil}
            className="px-3 py-2 bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
