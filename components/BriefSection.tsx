'use client'

import { useState } from 'react'
import type { Brief } from '@/lib/agents/store'

interface Props {
  eventId: string
  initialBrief: Brief | null
}

function formatBriefContent(content: string) {
  // Render **bold** markdown and preserve line breaks
  return content.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/)
    return (
      <span key={i}>
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j}>{part.slice(2, -2)}</strong>
            : part
        )}
        {i < content.split('\n').length - 1 && <br />}
      </span>
    )
  })
}

export default function BriefSection({ eventId, initialBrief }: Props) {
  const [brief, setBrief] = useState<Brief | null>(initialBrief)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(force = false) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agents/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, force }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }
      const { brief: newBrief } = await res.json()
      setBrief(newBrief)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!brief) {
    return (
      <div className="border-t border-gray-100 px-5 py-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Morning Brief</p>
        <button
          onClick={() => generate(false)}
          disabled={loading}
          className="w-full rounded-xl bg-gray-900 text-white px-4 py-3 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Claire is preparing your brief…' : 'Get Brief from Claire'}
        </button>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  const age = Date.now() - new Date(brief.created_at).getTime()
  const ageLabel = age < 60_000
    ? 'just now'
    : age < 3_600_000
      ? `${Math.floor(age / 60_000)}m ago`
      : age < 86_400_000
        ? `${Math.floor(age / 3_600_000)}h ago`
        : new Date(brief.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="border-t border-gray-100 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Morning Brief</p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-300">{ageLabel}</span>
          <button
            onClick={() => generate(true)}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="text-sm text-gray-700 leading-relaxed space-y-3">
        {brief.content.split(/\n{2,}/).map((block, i) => (
          <p key={i}>{formatBriefContent(block)}</p>
        ))}
      </div>
      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
    </div>
  )
}
