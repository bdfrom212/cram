'use client'

import { useState } from 'react'

interface SourceEvent {
  raw_co: string
  couple: string
  date: string
}

interface Cluster {
  id: string
  raw_strings: string[]
  event_count: number
  proposed_name: string
  canonical_name: string | null
  instagram: string | null
  individuals: string[]
  source_events: SourceEvent[]
  status: 'pending' | 'approved' | 'split' | 'skip'
  notes: string | null
}

interface Props {
  cluster: Cluster
  onDecision: (id: string, decision: Partial<Cluster>) => Promise<void>
}

function formatYear(dateStr: string) {
  if (!dateStr) return ''
  return dateStr.slice(0, 4)
}

function formatCouple(couple: string) {
  // Strip common prefixes like "inq: " and clean up
  return couple.replace(/^inq:\s*/i, '').trim()
}

export default function PlannerClusterCard({ cluster, onDecision }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cluster.canonical_name ?? cluster.proposed_name)
  const [instagram, setInstagram] = useState(cluster.instagram ?? '')
  const [individuals, setIndividuals] = useState(cluster.individuals.join(', '))
  const [saving, setSaving] = useState(false)
  const [showAllEvents, setShowAllEvents] = useState(false)

  // Guard: Supabase may return a single object instead of array for 1-event clusters
  const rawEvents = cluster.source_events ?? []
  const events = Array.isArray(rawEvents) ? rawEvents : [rawEvents]
  const visibleEvents = showAllEvents ? events : events.slice(0, 5)
  const hasMoreEvents = events.length > 5

  async function handleApprove() {
    setSaving(true)
    await onDecision(cluster.id, {
      canonical_name: name,
      instagram: instagram || null,
      individuals: individuals ? individuals.split(',').map(s => s.trim()).filter(Boolean) : [],
      status: 'approved',
    })
    setSaving(false)
  }

  async function handleSkip() {
    setSaving(true)
    await onDecision(cluster.id, { status: 'skip' })
    setSaving(false)
  }

  async function handleSplit() {
    setSaving(true)
    await onDecision(cluster.id, { status: 'split', notes: 'Flagged for manual split' })
    setSaving(false)
  }

  const isDone = cluster.status !== 'pending'

  return (
    <div className={`border rounded-xl p-4 mb-4 ${isDone ? 'bg-gray-50 opacity-60' : 'bg-white shadow-sm'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1">
          {editing ? (
            <input
              className="text-lg font-semibold w-full border-b border-gray-300 focus:outline-none focus:border-gray-600 pb-1"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          ) : (
            <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            {cluster.event_count} event{cluster.event_count !== 1 ? 's' : ''}
            {cluster.instagram && !editing && (
              <span className="ml-2 text-blue-500">@{cluster.instagram}</span>
            )}
          </p>
        </div>
        {isDone && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
            cluster.status === 'approved' ? 'bg-green-100 text-green-700' :
            cluster.status === 'skip' ? 'bg-gray-200 text-gray-500' :
            'bg-yellow-100 text-yellow-700'
          }`}>
            {cluster.status === 'approved' ? '✓ Approved' : cluster.status === 'skip' ? 'Skipped' : '✂ Split'}
          </span>
        )}
      </div>

      {/* Edit fields */}
      {editing && (
        <div className="space-y-2 mb-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Instagram handle</label>
            <input
              className="text-sm w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400"
              placeholder="handle (no @)"
              value={instagram}
              onChange={e => setInstagram(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Individual contacts (comma-separated)</label>
            <input
              className="text-sm w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400"
              placeholder="e.g. Erin Reddy, Meaghan Walsh"
              value={individuals}
              onChange={e => setIndividuals(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Individuals (non-editing) */}
      {cluster.individuals.length > 0 && !editing && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1">People</p>
          <div className="flex flex-wrap gap-1">
            {cluster.individuals.map(person => (
              <span key={person} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                {person}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Source events — the key context for recognition */}
      {events.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1.5">Weddings you shot with them</p>
          <div className="space-y-1">
            {visibleEvents.map((ev, i) => (
              <div key={i} className="flex items-baseline gap-2 text-sm">
                <span className="text-gray-400 text-xs tabular-nums flex-shrink-0 w-8">
                  {formatYear(ev.date)}
                </span>
                <span className="text-gray-700">{formatCouple(ev.couple)}</span>
              </div>
            ))}
          </div>
          {hasMoreEvents && (
            <button
              onClick={() => setShowAllEvents(!showAllEvents)}
              className="text-xs text-gray-400 hover:text-gray-600 mt-1.5"
            >
              {showAllEvents ? 'Show less' : `+${events.length - 5} more`}
            </button>
          )}
        </div>
      )}

      {/* Raw strings (collapsed) */}
      <details className="mb-3">
        <summary className="text-xs text-gray-400 cursor-pointer select-none">
          Raw strings ({cluster.raw_strings.length})
        </summary>
        <ul className="mt-2 space-y-1">
          {cluster.raw_strings.map((s, i) => (
            <li key={i} className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded">
              {s}
            </li>
          ))}
        </ul>
      </details>

      {/* Actions */}
      {!isDone && (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={saving}
            className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
          >
            {saving ? '...' : '✓ Approve'}
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="px-4 py-2.5 border border-gray-300 text-sm rounded-lg text-gray-700"
          >
            ✏️
          </button>
          <button
            onClick={handleSplit}
            disabled={saving}
            className="px-4 py-2.5 border border-gray-300 text-sm rounded-lg text-gray-700 disabled:opacity-50"
            title="Flag to split into separate firms"
          >
            ✂️
          </button>
          <button
            onClick={handleSkip}
            disabled={saving}
            className="px-4 py-2.5 border border-gray-300 text-sm rounded-lg text-gray-500 disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  )
}
