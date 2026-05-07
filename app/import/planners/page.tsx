'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import FirmGroup from '@/components/import/FirmGroup'
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
  role: 'solo' | 'freelancer' | null
}

export default function PlannerNormalizationPage() {
  const [allClusters, setAllClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'pending' | 'approved' | 'all'>('pending')
  const [counts, setCounts] = useState({ pending: 0, approved: 0, split: 0, skip: 0 })

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/import/clusters')
    const data: Cluster[] = await res.json()
    setAllClusters(data)
    const c = { pending: 0, approved: 0, split: 0, skip: 0 }
    data.forEach(cl => { c[cl.status] = (c[cl.status] || 0) + 1 })
    setCounts(c)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Map: person name (lowercase) → firm cluster
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

  // Build firm groups: firms that have person sub-clusters
  const { firmGroups, standaloneVisible } = useMemo(() => {
    // Find clusters whose name matches a person in another cluster's individuals list
    const personClusterIds = new Set<string>()
    const firmToPeople = new Map<string, Cluster[]>()  // firmId → person clusters

    allClusters.forEach(cluster => {
      const name = (cluster.canonical_name ?? cluster.proposed_name).toLowerCase().trim()
      const parentFirm = personToFirm[name]
      if (parentFirm && parentFirm.id !== cluster.id) {
        personClusterIds.add(cluster.id)
        const existing = firmToPeople.get(parentFirm.id) ?? []
        existing.push(cluster)
        firmToPeople.set(parentFirm.id, existing)
      }
    })

    // Build firm groups: only firms that have at least one person sub-cluster
    const groups: Array<{ firm: Cluster; people: Cluster[] }> = []
    firmToPeople.forEach((people, firmId) => {
      const firm = allClusters.find(c => c.id === firmId)
      if (firm) groups.push({ firm, people })
    })
    groups.sort((a, b) => {
      // Firms with pending people first
      const aPending = a.people.filter(p => p.status === 'pending').length
      const bPending = b.people.filter(p => p.status === 'pending').length
      return bPending - aPending || (a.firm.canonical_name ?? a.firm.proposed_name).localeCompare(b.firm.canonical_name ?? b.firm.proposed_name)
    })

    // Standalone: clusters not in a firm group, filtered by view
    const standalone = allClusters.filter(c => {
      if (personClusterIds.has(c.id)) return false  // shown in a group
      if (firmToPeople.has(c.id)) return false       // shown as group header
      if (view === 'pending') return c.status === 'pending'
      if (view === 'approved') return c.status === 'approved'
      return true
    })

    // Filter groups based on view
    const filteredGroups = groups.filter(({ firm, people }) => {
      if (view === 'pending') return firm.status === 'pending' || people.some(p => p.status === 'pending')
      if (view === 'approved') return firm.status === 'approved'
      return true
    })

    return { firmGroups: filteredGroups, standaloneVisible: standalone }
  }, [allClusters, personToFirm, view])

  async function patch(id: string, fields: Partial<Cluster>) {
    await fetch(`/api/import/clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  }

  async function handleDecision(id: string, decision: Partial<Cluster>) {
    await patch(id, decision)
    setAllClusters(prev => prev.map(c => c.id === id ? { ...c, ...decision } : c))
  }

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
    await refresh()
  }

  async function handleMerge(duplicateId: string, parentId: string) {
    const dup = allClusters.find(c => c.id === duplicateId)!
    const parent = allClusters.find(c => c.id === parentId)!
    const parentName = parent.canonical_name ?? parent.proposed_name

    const newRawStrings = Array.from(new Set([...parent.raw_strings, ...dup.raw_strings]))
    const newEventCount = parent.event_count + dup.event_count
    const dupIndividuals = dup.individuals.filter(
      i => !parent.individuals.map(p => p.toLowerCase()).includes(i.toLowerCase())
    )

    await patch(parentId, { raw_strings: newRawStrings, event_count: newEventCount, individuals: [...parent.individuals, ...dupIndividuals] })
    await handleDecision(duplicateId, { status: 'skip', notes: `Merged into ${parentName}` })
    await refresh()
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
          Review firms and their people. Approve firms, link individuals, skip anything irrelevant.
        </p>
      </div>

      {/* Progress */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>{done} of {total} reviewed</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-gray-900 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-500">
          <span className="text-green-600 font-medium">{counts.approved} approved</span>
          <span className="text-yellow-600 font-medium">{counts.split} to split</span>
          <span>{counts.skip} skipped</span>
          <span className="font-medium">{counts.pending} pending</span>
        </div>
      </div>

      {/* View filter */}
      <div className="flex gap-2 mb-6">
        {(['pending', 'approved', 'all'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-sm rounded-lg capitalize ${
              view === v ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {v === 'all' ? 'All' : v === 'pending' ? `Pending (${counts.pending})` : `Approved (${counts.approved})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* Firm groups — firms with associated person clusters */}
          {firmGroups.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Firms with linked people</p>
              {firmGroups.map(({ firm, people }) => (
                <FirmGroup
                  key={firm.id}
                  firm={firm}
                  pendingPeople={people}
                  allClusters={allClusters}
                  personToFirm={personToFirm}
                  onDecision={handleDecision}
                  onAbsorb={handleAbsorb}
                  onMerge={handleMerge}
                  onFirmDecision={handleDecision}
                />
              ))}
            </div>
          )}

          {/* Standalone clusters */}
          {standaloneVisible.length > 0 && (
            <div>
              {firmGroups.length > 0 && (
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3 mt-4">
                  All other entries ({standaloneVisible.length})
                </p>
              )}
              {standaloneVisible.map(cluster => (
                <PlannerClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  allClusters={allClusters}
                  personToFirm={personToFirm}
                  onDecision={handleDecision}
                  onAbsorb={handleAbsorb}
                  onMerge={handleMerge}
                />
              ))}
            </div>
          )}

          {firmGroups.length === 0 && standaloneVisible.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">
                {view === 'pending' ? 'All planners reviewed!' : 'Nothing here.'}
              </p>
              {view === 'pending' && (
                <Link href="/import" className="mt-4 inline-block text-sm text-gray-600 underline">
                  Back to import overview
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
