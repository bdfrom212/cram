'use client'

import { useEffect, useState, useCallback } from 'react'
import PlannerClusterCard from '@/components/import/PlannerClusterCard'
import Link from 'next/link'

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

export default function PlannerNormalizationPage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [filter, setFilter] = useState<'pending' | 'approved' | 'all'>('pending')
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState({ pending: 0, approved: 0, split: 0, skip: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    const url = filter === 'all' ? '/api/import/clusters' : `/api/import/clusters?status=${filter}`
    const res = await fetch(url)
    const data = await res.json()
    setClusters(data)
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/import/clusters').then(r => r.json()).then((all: Cluster[]) => {
      const c = { pending: 0, approved: 0, split: 0, skip: 0 }
      all.forEach(cl => { c[cl.status] = (c[cl.status] || 0) + 1 })
      setCounts(c)
    })
  }, [clusters])

  async function handleDecision(id: string, decision: Partial<Cluster>) {
    await fetch(`/api/import/clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    })
    setClusters(prev => prev.map(c => c.id === id ? { ...c, ...decision } : c))
  }

  const total = counts.pending + counts.approved + counts.split + counts.skip
  const done = counts.approved + counts.split + counts.skip
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Link href="/import" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
          ← Import
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Planner Normalization</h1>
        <p className="text-gray-500 text-sm mt-1">
          Review each planner firm, confirm the name, and identify individual contacts.
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{done} of {total} reviewed</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-gray-900 h-2 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-500">
          <span className="text-green-600 font-medium">{counts.approved} approved</span>
          <span className="text-yellow-600 font-medium">{counts.split} to split</span>
          <span>{counts.skip} skipped</span>
          <span className="font-medium">{counts.pending} pending</span>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(['pending', 'approved', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg capitalize ${
              filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {f === 'all' ? 'All' : f === 'pending' ? `Pending (${counts.pending})` : `Approved (${counts.approved})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : clusters.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">
            {filter === 'pending' ? '🎉 All planners reviewed!' : 'Nothing here yet.'}
          </p>
          {filter === 'pending' && (
            <Link href="/import" className="mt-4 inline-block text-sm text-gray-600 underline">
              Back to import overview
            </Link>
          )}
        </div>
      ) : (
        clusters.map(cluster => (
          <PlannerClusterCard
            key={cluster.id}
            cluster={cluster}
            onDecision={handleDecision}
          />
        ))
      )}
    </div>
  )
}
