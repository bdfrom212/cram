'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Brief } from '@/lib/agents/store'

interface Anniversary {
  id: string
  title: string | null
  date: string
  anniversary_date: string
  client_names: string | null
  venue_name: string | null
}

interface Commitment {
  id: string
  body: string
  source: string
  due_date: string | null
  created_at: string
  contact?: { name: string } | null
  event?: { title: string; date: string } | null
}

function formatContent(content: string) {
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

function ageDays(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

export default function GracePage() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([])
  const [loading, setLoading] = useState(false)
  const [briefLoading, setBriefLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newCommitment, setNewCommitment] = useState('')
  const [adding, setAdding] = useState(false)
  const [draftingFor, setDraftingFor] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const loadCommitments = useCallback(async () => {
    const res = await fetch('/api/commitments')
    if (res.ok) {
      const data = await res.json()
      setCommitments(data.commitments ?? [])
    }
  }, [])

  useEffect(() => {
    fetch('/api/agents/grace')
      .then(r => r.json())
      .then(({ brief }) => { setBrief(brief); setBriefLoading(false) })
      .catch(() => setBriefLoading(false))
    loadCommitments()
    fetch('/api/anniversaries')
      .then(r => r.json())
      .then(data => setAnniversaries(data.anniversaries ?? []))
      .catch(() => {})
  }, [loadCommitments])

  async function runStandup(force = false) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agents/grace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const { brief: newBrief } = await res.json()
      setBrief(newBrief)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function completeCommitment(id: string) {
    await fetch('/api/agents/grace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', commitmentId: id }),
    })
    setCommitments(prev => prev.filter(c => c.id !== id))
  }

  async function draftAnniversaryPost(anniversary: Anniversary) {
    setDraftingFor(anniversary.id)
    try {
      const res = await fetch('/api/agents/publicist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: anniversary.id, force: true, type: 'anniversary' }),
      })
      const data = await res.json()
      const text = data.brief?.content ?? data.content ?? 'Draft unavailable'
      setDrafts(prev => ({ ...prev, [anniversary.id]: text }))
    } catch {
      setDrafts(prev => ({ ...prev, [anniversary.id]: 'Error generating draft.' }))
    } finally {
      setDraftingFor(null)
    }
  }

  async function addCommitment() {
    if (!newCommitment.trim()) return
    setAdding(true)
    await fetch('/api/agents/grace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', body: newCommitment.trim() }),
    })
    setNewCommitment('')
    setAdding(false)
    await loadCommitments()
  }

  const briefAge = brief ? Date.now() - new Date(brief.created_at).getTime() : null
  const briefAgeLabel = briefAge === null ? null
    : briefAge < 60_000 ? 'just now'
    : briefAge < 3_600_000 ? `${Math.floor(briefAge / 60_000)}m ago`
    : briefAge < 86_400_000 ? `${Math.floor(briefAge / 3_600_000)}h ago`
    : new Date(brief!.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Grace</h1>
        <span className="text-xs text-gray-400">Chief of Staff</span>
      </div>

      {/* Standup Brief */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Daily Standup</p>
          <div className="flex items-center gap-3">
            {briefAgeLabel && <span className="text-xs text-gray-300">{briefAgeLabel}</span>}
            <button
              onClick={() => runStandup(true)}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
            >
              {loading ? 'Running…' : 'Refresh'}
            </button>
          </div>
        </div>

        {briefLoading ? (
          <div className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</div>
        ) : brief ? (
          <div className="px-5 py-4 text-sm text-gray-700 leading-relaxed space-y-3">
            {brief.content.split(/\n{2,}/).map((block, i) => (
              <p key={i}>{formatContent(block)}</p>
            ))}
          </div>
        ) : (
          <div className="px-5 py-6">
            <p className="text-sm text-gray-500 mb-4">No standup yet today. Run Grace to see what needs your attention.</p>
            <button
              onClick={() => runStandup(false)}
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 text-white px-4 py-3 text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Grace is running her standup…' : 'Run Daily Standup'}
            </button>
          </div>
        )}
        {error && <p className="px-5 pb-4 text-xs text-red-500">{error}</p>}
      </div>

      {/* Anniversaries — Sophia's queue */}
      {anniversaries.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Upcoming Anniversaries — Sophia
            </p>
          </div>
          <ul className="divide-y divide-gray-50">
            {anniversaries.map(a => {
              const yearsAgo = new Date().getFullYear() - new Date(a.date).getFullYear()
              const annivDate = new Date(a.anniversary_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const names = a.client_names || a.title || 'Unnamed couple'
              return (
                <li key={a.id} className="px-5 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{names}</p>
                      <p className="text-xs text-gray-400">
                        {yearsAgo}-year anniversary · {annivDate}
                        {a.venue_name && ` · ${a.venue_name}`}
                      </p>
                    </div>
                    {!drafts[a.id] && (
                      <button
                        onClick={() => draftAnniversaryPost(a)}
                        disabled={draftingFor === a.id}
                        className="flex-shrink-0 text-xs bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
                      >
                        {draftingFor === a.id ? 'Drafting…' : 'Draft post'}
                      </button>
                    )}
                  </div>
                  {drafts[a.id] && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs font-semibold text-gray-400 mb-1.5">Draft — Sophia</p>
                      <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{drafts[a.id]}</p>
                      <button
                        onClick={() => setDrafts(prev => { const n = { ...prev }; delete n[a.id]; return n })}
                        className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Commitments */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Open Commitments {commitments.length > 0 && `(${commitments.length})`}
          </p>
        </div>

        {commitments.length === 0 ? (
          <div className="px-5 py-4 text-sm text-gray-400">No open commitments. You're clear.</div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {commitments.map(c => {
              const days = ageDays(c.created_at)
              const who = c.contact?.name ?? c.event?.title ?? null
              return (
                <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                  <button
                    onClick={() => completeCommitment(c.id)}
                    className="mt-0.5 w-4 h-4 rounded-full border-2 border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 flex-shrink-0 transition-colors"
                    title="Mark done"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{c.body}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {who && <span>{who} · </span>}
                      {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}
                      {c.due_date && <span className={` · due ${new Date(c.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${new Date(c.due_date) < new Date() ? ' ⚠' : ''}`} />}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Add commitment */}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <input
            type="text"
            value={newCommitment}
            onChange={e => setNewCommitment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCommitment()}
            placeholder="Add a commitment…"
            className="flex-1 text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-gray-300 placeholder-gray-400"
          />
          <button
            onClick={addCommitment}
            disabled={adding || !newCommitment.trim()}
            className="text-sm px-3 py-2 rounded-lg bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
