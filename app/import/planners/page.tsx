'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import PlannerClusterCard from '@/components/import/PlannerClusterCard'
import Link from 'next/link'

export interface SourceEvent {
  raw_co: string
  couple: string
  date: string
  venue?: string
  source?: 'vsco' | 'tave'
  field?: 'planners_co' | 'planner_contact'
}

export interface Cluster {
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
  const [allClusters, setAllClusters] = useState<Cluster[]>([])
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

  // Always keep a full snapshot for lookup purposes (person→firm map, similar firms)
  const refreshAll = useCallback(() => {
    fetch('/api/import/clusters').then(r => r.json()).then((all: Cluster[]) => {
      setAllClusters(all)
      const c = { pending: 0, approved: 0, split: 0, skip: 0 }
      all.forEach(cl => { c[cl.status] = (c[cl.status] || 0) + 1 })
      setCounts(c)
    })
  }, [])

  useEffect(() => { refreshAll() }, [refreshAll, clusters])

  // Build person → firm lookup from all clusters
  const personToFirm = useMemo(() => {
    const map: Record<string, { id: string; name: string }> = {}
    allClusters.forEach(c => {
      const firmName = c.canonical_name ?? c.proposed_name
      c.individuals.forEach(person => {
        map[person.toLowerCase().trim()] = { id: c.id, name: firmName }
      })
    })
    return map
  }, [allClusters])

  async function patch(id: string, fields: Partial<Cluster>) {
    await fetch(`/api/import/clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  }

  async function handleDecision(id: string, decision: Partial<Cluster>) {
    await patch(id, decision)
    setClusters(prev => prev.map(c => c.id === id ? { ...c, ...decision } : c))
  }

  // Absorb a person cluster into a parent firm's individuals
  async function handleAbsorb(personClusterId: string, parentClusterId: string) {
    const personCluster = allClusters.find(c => c.id === personClusterId)!
    const parentCluster = allClusters.find(c => c.id === parentClusterId)!
    const personName = personCluster.canonical_name ?? personCluster.proposed_name
    const parentName = parentCluster.canonical_name ?? parentCluster.proposed_name

    const existingInds = parentCluster.individuals.map(i => i.toLowerCase())
    const newInds = existingInds.includes(personName.toLowerCase())
      ? parentCluster.individuals
      : [...parentCluster.individuals, personName]

    const newRawStrings = Array.from(new Set([...parentCluster.raw_strings, ...personCluster.raw_strings]))

    await patch(parentClusterId, { individuals: newInds, raw_strings: newRawStrings })
    await handleDecision(personClusterId, { status: 'skip', notes: `Person absorbed into ${parentName}` })
    refreshAll()
  }

  // Merge a duplicate firm cluster into a canonical parent
  async function handleMerge(duplicateId: string, parentId: string) {
    const dup = allClusters.find(c => c.id === duplicateId)!
    const parent = allClusters.find(c => c.id === parentId)!
    const parentName = parent.canonical_name ?? parent.proposed_name

    const newRawStrings = Array.from(new Set([...parent.raw_strings, ...dup.raw_strings]))
    const newEventCount = parent.event_count + dup.event_count
    const dupIndividuals = dup.individuals.filter(
      i => !parent.individuals.map(p => p.toLowerCase()).includes(i.toLowerCase())
    )
    const newInds = [...parent.individuals, ...dupIndividuals]

    await patch(parentId, { raw_strings: newRawStrings, event_count: newEventCount, individuals: newInds })
    await handleDecision(duplicateId, { status: 'skip', notes: `Merged into ${parentName}` })
    refreshAll()
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
          Review each entry — confirm it's a real firm, link any people to their firm, and skip anything irrelevant.
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
            {filter === 'pending' ? 'All planners reviewed!' : 'Nothing here yet.'}
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
            allClusters={allClusters}
            personToFirm={personToFirm}
            onDecision={handleDecision}
            onAbsorb={handleAbsorb}
            onMerge={handleMerge}
          />
        ))
      )}
    </div>
  )
}
