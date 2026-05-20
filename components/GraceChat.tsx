'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import MergePreview from './MergePreview'

interface Message {
  role: 'user' | 'assistant'
  content: string
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
  const [sessionId] = useState<string | null>(null)
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [undoToken, setUndoToken] = useState<string | null>(null)
  const [showMergePreview, setShowMergePreview] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Initialize position from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('grace-chat-position')
    if (saved) {
      setPosition(JSON.parse(saved))
    } else {
      // Default: bottom-right
      setPosition({ x: window.innerWidth - 380, y: window.innerHeight - 500 })
    }

    // Check if mobile
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Persist position to localStorage
  useEffect(() => {
    localStorage.setItem('grace-chat-position', JSON.stringify(position))
  }, [position])

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return // No dragging on mobile
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragOffset || isMobile) return
      const newX = e.clientX - dragOffset.x
      const newY = e.clientY - dragOffset.y
      setPosition({ x: newX, y: newY })
    },
    [dragOffset, isMobile]
  )

  const handleMouseUp = () => {
    setDragOffset(null)
  }

  useEffect(() => {
    if (dragOffset) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragOffset, handleMouseMove])

  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      let assistantText = ''
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        assistantText += decoder.decode(value, { stream: true })
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }])

      // Check if response contains merge preview or undo token
      if (assistantText.includes('[preview_merge]')) {
        setShowMergePreview(true)
      }
      if (assistantText.includes('[undo_token:')) {
        const match = assistantText.match(/\[undo_token:([^\]]+)\]/)
        if (match) setUndoToken(match[1])
      }
    } catch (error) {
      console.error('Error:', error)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-amber-400 hover:bg-amber-500 text-white font-semibold shadow-lg transition-colors flex items-center justify-center z-40"
        title="Grace — Chief of Staff"
      >
        G
      </button>
    )
  }

  const panelClasses = isMobile
    ? 'fixed inset-0 bottom-0 w-full h-2/3 rounded-t-2xl bg-white shadow-2xl flex flex-col z-50'
    : 'fixed bg-white rounded-xl shadow-2xl flex flex-col border border-gray-200 z-50'

  const panelStyle = isMobile
    ? {}
    : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '360px',
        height: '500px',
      }

  return (
    <div ref={panelRef} className={panelClasses} style={panelStyle}>
      {/* Header */}
      <div
        onMouseDown={handleMouseDown}
        className={`p-4 border-b border-gray-200 flex items-center justify-between ${
          isMobile ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        } bg-gradient-to-r from-amber-400 to-amber-500 rounded-t-xl`}
      >
        <div>
          <h3 className="font-semibold text-white">Grace</h3>
          <p className="text-xs text-amber-100">Chief of Staff</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-white hover:bg-amber-600 rounded-lg p-1.5 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center pt-8">
            <p className="text-gray-400 text-sm">Hi! I'm Grace, your Chief of Staff.</p>
            <p className="text-gray-400 text-sm mt-2">Ask me about contacts, merge duplicates, or get recent updates.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                msg.role === 'user'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg text-sm">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Undo Toast */}
      {undoToken && (
        <div className="mx-4 mb-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-green-800">Merge completed (undo in 60s)</span>
          <button
            onClick={() => {
              // Undo implementation would call /api/assistant with undo request
              setUndoToken(null)
            }}
            className="text-xs text-green-600 hover:text-green-700 font-medium"
          >
            Undo
          </button>
        </div>
      )}

      {/* Merge Preview Modal */}
      {showMergePreview && (
        <div className="absolute inset-0 bg-black bg-opacity-50 rounded-xl flex items-center justify-center p-4 z-50">
          <MergePreview onClose={() => setShowMergePreview(false)} />
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-200 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Ask me anything..."
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 text-white font-medium text-sm rounded-lg transition-colors"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-400">Shift+Enter for newline</p>
      </div>
    </div>
  )
}
