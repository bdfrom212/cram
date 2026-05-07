'use client'

import { useState, useMemo } from 'react'
import type { Cluster, SourceEvent } from '@/app/import/planners/page'

interface Props {
  cluster: Cluster
  allClusters: Cluster[]
  personToFirm: Record<string, { id: string; name: string }>
  parentFirmName?: string  // set when rendered inside a FirmGroup
  onDecision: (id: string, decision: Partial<Cluster>) => Promise<void>
  onAbsorb: (personClusterId: string, parentClusterId: string) => Promise<void>
  onMerge: (duplicateId: string, parentId: string) => Promise<void>
}

function formatYear(dateStr: string) {
  return dateStr?.slice(0, 4) ?? ''
}

function formatCouple(couple: string) {
  return couple
    .replace(/^inq:\s*/i, '')
    .replace(/\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?.*/i, '')
    .trim()
}

function extractRawNote(rawCo: string) {
  const match = rawCo.match(/\(([^)]+)\)/)
  return match ? match[1] : null
}

function deduplicateEvents(events: SourceEvent[]): SourceEvent[] {
  const seen = new Map<string, SourceEvent>()
  for (const ev of events) {
    const key = ev.date
    if (!seen.has(key) || (!seen.get(key)!.venue && ev.venue)) {
      seen.set(key, ev)
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.date.localeCompare(a.date))
}

type EntityType = 'person' | 'company' | 'venue'

function classifyEntity(name: string): EntityType {
  const venueWords = /\b(plaza|hotel|estate|gardens?|club|hall|ballroom|manor|house|farm|inn|vineyard|country|resort|room|loft|space|pavilion|terrace|rooftop|warehouse|library|museum|gallery|park|lawn|brewery|winery|restaurant|lounge|suite|palace|castle|chateau|penthouse|barn|chapel|cathedral|sanctuary|amphitheater|yacht|marina|beach)\b/i
  const companyWords = /\b(events?|co\.?|company|group|productions?|studio|planning|associates?|llc|ltd\.?|inc\.?|design|collective|weddings?|celebrations?|occasions?|creations?|agency|management|lifestyle|experiences?|entertainment|services?|international|worldwide|consulting|creative)\b/i
  if (venueWords.test(name)) return 'venue'
  if (companyWords.test(name)) return 'company'
  return 'person'
}

const TYPE_LABEL: Record<EntityType, string> = {
  person: 'Person',
  company: 'Company',
  venue: 'Venue',
}

const TYPE_STYLE: Record<EntityType, string> = {
  person: 'bg-purple-600 text-white',
  company: 'bg-blue-600 text-white',
  venue: 'bg-emerald-600 text-white',
}

export default function PlannerClusterCard({
  cluster, allClusters, personToFirm, parentFirmName, onDecision, onAbsorb, onMerge
}: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cluster.canonical_name ?? cluster.proposed_name)
  const [instagram, setInstagram] = useState(cluster.instagram ?? '')
  const [individuals, setIndividuals] = useState(cluster.individuals.join(', '))
  const [saving, setSaving] = useState(false)
  const [showAllEvents, setShowAllEvents] = useState(false)
  const [absorbing, setAbsorbing] = useState(false)
  const [absorbSearch, setAbsorbSearch] = useState('')
  const [merging, setMerging] = useState(false)

  const rawEvents = cluster.source_events ?? []
  const allEvents: SourceEvent[] = Array.isArray(rawEvents) ? rawEvents : [rawEvents as SourceEvent]
  const events = deduplicateEvents(allEvents)
  const visibleEvents = showAllEvents ? events : events.slice(0, 5)

  const displayName = cluster.canonical_name ?? cluster.proposed_name

  const knownParent = useMemo(() => {
    return personToFirm[displayName.toLowerCase().trim()] ?? null
  }, [personToFirm, displayName])

  const similarFirms = useMemo(() => {
    const nameLower = cluster.proposed_name.toLowerCase()
    return allClusters.filter(c =>
      c.id !== cluster.id &&
      c.status !== 'skip' &&
      (
        c.proposed_name.toLowerCase().includes(nameLower) ||
        nameLower.includes(c.proposed_name.toLowerCase())
      ) &&
      nameLower.length > 4 && c.proposed_name.toLowerCase().length > 4
    ).slice(0, 3)
  }, [allClusters, cluster])

  const absorbResults = useMemo(() => {
    if (!absorbSearch.trim()) return []
    const q = absorbSearch.toLowerCase()
    return allClusters
      .filter(c => c.id !== cluster.id && c.status !== 'skip' &&
        (c.proposed_name.toLowerCase().includes(q) || (c.canonical_name ?? '').toLowerCase().includes(q))
      )
      .slice(0, 8)
  }, [absorbSearch, allClusters, cluster.id])

  const entityType = classifyEntity(displayName)
  const isDone = cluster.status !== 'pending'

  function buildApproveFields() {
    return {
      canonical_name: name,
      instagram: instagram || null,
      individuals: individuals ? individuals.split(',').map(s => s.trim()).filter(Boolean) : [],
      status: 'approved' as const,
    }
  }

  async function handleApprove() {
    setSaving(true)
    await onDecision(cluster.id, buildApproveFields())
    setSaving(false)
    setEditing(false)
  }

  async function handleApproveWithRole(role: 'solo' | 'freelancer') {
    setSaving(true)
    await onDecision(cluster.id, { ...buildApproveFields(), role })
    setSaving(false)
    setEditing(false)
  }

  async function handleSkip() {
    setSaving(true)
    await onDecision(cluster.id, { status: 'skip' })
    setSaving(false)
  }

  async function handleSplit() {
    setSaving(true)
    await onDecision(cluster.id, { status: 'split', notes: 'Two different firms mixed together — needs manual review' })
    setSaving(false)
  }

  async function handleAbsorbInto(parentId: string) {
    setSaving(true)
    await onAbsorb(cluster.id, parentId)
    setSaving(false)
    setAbsorbing(false)
  }

  async function handleMergeInto(parentId: string) {
    setSaving(true)
    await onMerge(cluster.id, parentId)
    setSaving(false)
    setMerging(false)
  }

  return (
    <div className={`border rounded-xl mb-4 overflow-hidden ${isDone ? 'opacity-60' : ''}`}>

      {/* Context banners */}
      {knownParent && !isDone && !parentFirmName && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-2">
          <span className="text-amber-600 text-sm font-medium flex-shrink-0">Appeared on a job with:</span>
          <span className="text-amber-800 text-sm">{knownParent.name}</span>
        </div>
      )}
      {similarFirms.length > 0 && !isDone && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5">
          <span className="text-blue-600 text-sm font-medium">Similar entries: </span>
          <span className="text-blue-800 text-sm">
            {similarFirms.map(f => `${f.canonical_name ?? f.proposed_name} (${f.event_count} events)`).join(' · ')}
          </span>
        </div>
      )}

      <div className={`p-4 ${isDone ? 'bg-gray-50' : 'bg-white'}`}>

        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                className="text-lg font-semibold w-full border-b border-gray-300 focus:outline-none focus:border-gray-600 pb-1"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            ) : (
              <h3 className="text-lg font-semibold text-gray-900 truncate">{displayName}</h3>
            )}
          </div>
          {isDone && (
            <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
              cluster.status === 'approved' ? 'bg-green-100 text-green-700' :
              cluster.status === 'skip' ? 'bg-gray-200 text-gray-500' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {cluster.status === 'approved' ? '✓ Approved' :
               cluster.status === 'skip' ? 'Skipped' : 'Split'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500 mb-3">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_STYLE[entityType]}`}>
            {TYPE_LABEL[entityType]}
          </span>
          {cluster.role === 'solo' && (
            <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Solo planner</span>
          )}
          {cluster.role === 'freelancer' && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Freelancer</span>
          )}
          <span>{cluster.event_count} event{cluster.event_count !== 1 ? 's' : ''}</span>
          {cluster.instagram && !editing && <span className="text-blue-500">@{cluster.instagram}</span>}
          {cluster.notes && isDone && <span className="text-gray-400 text-xs italic truncate">{cluster.notes}</span>}
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

        {/* Individuals */}
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

        {/* Source events */}
        {events.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-400 mb-1.5">Weddings you shot with them</p>
            <div className="space-y-2">
              {visibleEvents.map((ev, i) => {
                const note = extractRawNote(ev.raw_co)
                return (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-gray-400 text-xs tabular-nums flex-shrink-0 w-8 pt-0.5">{formatYear(ev.date)}</span>
                    <div className="min-w-0">
                      <span className="text-gray-700">{formatCouple(ev.couple)}</span>
                      {ev.venue && (
                        <span className="text-gray-400 ml-1.5">· {ev.venue}</span>
                      )}
                      <span className="ml-1.5 text-xs text-gray-300">
                        [{ev.source ?? 'vsco'} / {ev.field === 'planner_contact' ? 'contact field' : 'company field'}]
                      </span>
                      {note && (
                        <span className="block text-xs text-amber-600 mt-0.5">Note: {note}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {events.length > 5 && (
              <button
                onClick={() => setShowAllEvents(!showAllEvents)}
                className="text-xs text-gray-400 hover:text-gray-600 mt-1.5"
              >
                {showAllEvents ? 'Show less' : `+${events.length - 5} more`}
              </button>
            )}
          </div>
        )}

        {/* Raw strings */}
        <details className="mb-3">
          <summary className="text-xs text-gray-400 cursor-pointer select-none">
            Raw strings ({cluster.raw_strings.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {cluster.raw_strings.map((s, i) => (
              <li key={i} className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded">{s}</li>
            ))}
          </ul>
        </details>

        {/* "Works for" absorb panel */}
        {absorbing && (
          <div className="mb-3 border border-amber-200 rounded-lg p-3 bg-amber-50">
            <p className="text-xs text-amber-700 font-medium mb-2">Which firm does {displayName} work for?</p>
            <input
              className="text-sm w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 bg-white mb-2"
              placeholder="Search firm name..."
              value={absorbSearch}
              onChange={e => setAbsorbSearch(e.target.value)}
              autoFocus
            />
            {absorbResults.length > 0 && (
              <ul className="space-y-1">
                {absorbResults.map(firm => (
                  <li key={firm.id}>
                    <button
                      onClick={() => handleAbsorbInto(firm.id)}
                      className="w-full text-left text-sm px-3 py-2 rounded-lg bg-white hover:bg-amber-100 border border-gray-200"
                    >
                      <span className="font-medium">{firm.canonical_name ?? firm.proposed_name}</span>
                      <span className="text-gray-400 ml-2">{firm.event_count} events</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setAbsorbing(false)} className="text-xs text-gray-400 mt-2">Cancel</button>
          </div>
        )}

        {/* "Same as" merge panel */}
        {merging && (
          <div className="mb-3 border border-blue-200 rounded-lg p-3 bg-blue-50">
            <p className="text-xs text-blue-700 font-medium mb-2">Which entry is this the same as?</p>
            {similarFirms.length > 0 && (
              <ul className="space-y-1 mb-2">
                {similarFirms.map(firm => (
                  <li key={firm.id}>
                    <button
                      onClick={() => handleMergeInto(firm.id)}
                      className="w-full text-left text-sm px-3 py-2 rounded-lg bg-white hover:bg-blue-100 border border-gray-200"
                    >
                      <span className="font-medium">{firm.canonical_name ?? firm.proposed_name}</span>
                      <span className="text-gray-400 ml-2">{firm.event_count} events</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              className="text-sm w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 bg-white"
              placeholder="Or search another firm..."
              onChange={e => setAbsorbSearch(e.target.value)}
            />
            {absorbSearch && absorbResults.map(firm => (
              <button
                key={firm.id}
                onClick={() => handleMergeInto(firm.id)}
                className="w-full text-left text-sm px-3 py-2 rounded-lg bg-white hover:bg-blue-100 border border-gray-200 mt-1"
              >
                <span className="font-medium">{firm.canonical_name ?? firm.proposed_name}</span>
                <span className="text-gray-400 ml-2">{firm.event_count} events</span>
              </button>
            ))}
            <button onClick={() => setMerging(false)} className="text-xs text-gray-400 mt-2">Cancel</button>
          </div>
        )}

        {/* Actions */}
        {!isDone && !absorbing && !merging && (
          <div className="space-y-2">
            {entityType === 'person' ? (
              <>
                {/* Person: role-based approval */}
                {editing ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveWithRole('solo')}
                      disabled={saving}
                      className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
                    >
                      {saving ? '...' : 'Save as solo planner'}
                    </button>
                    <button
                      onClick={() => handleApproveWithRole('freelancer')}
                      disabled={saving}
                      className="flex-1 bg-gray-700 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
                    >
                      {saving ? '...' : 'Save as freelancer'}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleApproveWithRole('solo')}
                      disabled={saving}
                      className="bg-gray-900 text-white text-sm py-3 rounded-lg disabled:opacity-50 text-left px-3"
                    >
                      <div className="font-semibold">Solo planner</div>
                      <div className="text-xs text-gray-300 mt-0.5">Person = their own firm</div>
                    </button>
                    <button
                      onClick={() => handleApproveWithRole('freelancer')}
                      disabled={saving}
                      className="bg-gray-700 text-white text-sm py-3 rounded-lg disabled:opacity-50 text-left px-3"
                    >
                      <div className="font-semibold">Freelancer</div>
                      <div className="text-xs text-gray-300 mt-0.5">Works various firms</div>
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(!editing)}
                    className={`flex-1 text-sm py-2 border rounded-lg ${editing ? 'border-gray-900 text-gray-900' : 'border-gray-300 text-gray-600'}`}
                  >
                    {editing ? 'Cancel edit' : 'Edit name & details'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setAbsorbing(true)
                      if (parentFirmName) setAbsorbSearch(parentFirmName)
                      else if (knownParent) setAbsorbSearch(knownParent.name)
                    }}
                    disabled={saving}
                    className="flex-1 text-sm py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Works exclusively for one firm →
                  </button>
                  <button
                    onClick={() => setMerging(true)}
                    disabled={saving}
                    className="flex-1 text-sm py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Same as another entry
                  </button>
                </div>
                <button
                  onClick={handleSkip}
                  disabled={saving}
                  className="w-full text-sm py-2 border border-gray-200 rounded-lg text-gray-400 hover:bg-gray-50 disabled:opacity-50"
                >
                  Skip — not relevant
                </button>
              </>
            ) : (
              <>
                {/* Company / Venue: standard approval */}
                <div className="flex gap-2">
                  <button
                    onClick={handleApprove}
                    disabled={saving}
                    className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50"
                  >
                    {saving ? '...' : editing ? 'Save & Approve' : 'Approve'}
                  </button>
                  <button
                    onClick={() => setEditing(!editing)}
                    className={`px-4 py-2.5 border text-sm rounded-lg ${editing ? 'border-gray-900 text-gray-900' : 'border-gray-300 text-gray-600'}`}
                  >
                    {editing ? 'Cancel' : 'Edit'}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setAbsorbing(true)
                      if (parentFirmName) setAbsorbSearch(parentFirmName)
                      else if (knownParent) setAbsorbSearch(knownParent.name)
                    }}
                    disabled={saving}
                    className="flex-1 text-sm py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Works for another firm
                  </button>
                  <button
                    onClick={() => setMerging(true)}
                    disabled={saving}
                    className="flex-1 text-sm py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Same as another entry
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSplit}
                    disabled={saving}
                    className="flex-1 text-sm py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Split — two firms mixed together
                  </button>
                  <button
                    onClick={handleSkip}
                    disabled={saving}
                    className="flex-1 text-sm py-2 border border-gray-200 rounded-lg text-gray-400 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Skip — not relevant
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
