'use client'

import { useState } from 'react'
import type { Cluster } from '@/app/import/planners/page'
import PlannerClusterCard from './PlannerClusterCard'

type EntityType = 'person' | 'company' | 'venue'

function classifyEntity(name: string): EntityType {
  const venueWords = /\b(plaza|hotel|estate|gardens?|club|hall|ballroom|manor|house|farm|inn|vineyard|country|resort|room|loft|space|pavilion|terrace|rooftop|warehouse|library|museum|gallery|park|lawn|brewery|winery|restaurant|lounge|suite|palace|castle|chateau|penthouse|barn|chapel|cathedral|sanctuary|amphitheater|yacht|marina|beach)\b/i
  const companyWords = /\b(events?|co\.?|company|group|productions?|studio|planning|associates?|llc|ltd\.?|inc\.?|design|collective|weddings?|celebrations?|occasions?|creations?|agency|management|lifestyle|experiences?|entertainment|services?|international|worldwide|consulting|creative)\b/i
  if (venueWords.test(name)) return 'venue'
  if (companyWords.test(name)) return 'company'
  return 'person'
}

const TYPE_STYLE: Record<EntityType, string> = {
  person: 'bg-purple-600 text-white',
  company: 'bg-blue-600 text-white',
  venue: 'bg-emerald-600 text-white',
}

interface Props {
  firm: Cluster
  pendingPeople: Cluster[]
  allClusters: Cluster[]
  personToFirm: Record<string, { id: string; name: string }>
  onDecision: (id: string, decision: Partial<Cluster>) => Promise<void>
  onAbsorb: (personClusterId: string, parentClusterId: string) => Promise<void>
  onMerge: (duplicateId: string, parentId: string) => Promise<void>
  onFirmDecision: (id: string, decision: Partial<Cluster>) => Promise<void>
}

export default function FirmGroup({
  firm, pendingPeople, allClusters, personToFirm,
  onDecision, onAbsorb, onMerge, onFirmDecision
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const [editingIndividuals, setEditingIndividuals] = useState(false)
  const [individualsText, setIndividualsText] = useState(firm.individuals.join(', '))
  const [saving, setSaving] = useState(false)

  const firmName = firm.canonical_name ?? firm.proposed_name
  const isFirmApproved = firm.status === 'approved'
  const entityType = classifyEntity(firmName)
  const pendingCount = pendingPeople.filter(p => p.status === 'pending').length

  async function saveIndividuals() {
    setSaving(true)
    const newInds = individualsText.split(',').map(s => s.trim()).filter(Boolean)
    await onFirmDecision(firm.id, { individuals: newInds })
    setSaving(false)
    setEditingIndividuals(false)
  }

  return (
    <div className="mb-6">
      {/* Firm header */}
      <div className={`rounded-xl border p-4 mb-2 ${isFirmApproved ? 'bg-green-50 border-green-200' : 'bg-white border-gray-300 shadow-sm'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900">{firmName}</h3>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_STYLE[entityType]}`}>
                {entityType.charAt(0).toUpperCase() + entityType.slice(1)}
              </span>
              {isFirmApproved
                ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Approved</span>
                : <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Needs review</span>
              }
              {pendingCount > 0 && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {pendingCount} person{pendingCount !== 1 ? 's' : ''} to review
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{firm.event_count} events</p>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {/* Individuals on the firm */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-green-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-gray-500 font-medium">People at this firm</p>
              <button
                onClick={() => setEditingIndividuals(!editingIndividuals)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                {editingIndividuals ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {editingIndividuals ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-400"
                  value={individualsText}
                  onChange={e => setIndividualsText(e.target.value)}
                  autoFocus
                />
                <button
                  onClick={saveIndividuals}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 bg-gray-900 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? '...' : 'Save'}
                </button>
              </div>
            ) : firm.individuals.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {firm.individuals.map(person => {
                  const hasPendingCluster = pendingPeople.some(
                    p => p.status === 'pending' && (p.proposed_name === person || p.canonical_name === person)
                  )
                  return (
                    <span
                      key={person}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        hasPendingCluster
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {person}
                      {hasPendingCluster && ' ↓'}
                    </span>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No named individuals yet — add them above</p>
            )}
          </div>
        )}

        {/* Approve firm if it's pending */}
        {!isFirmApproved && expanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
            <button
              onClick={() => onFirmDecision(firm.id, { status: 'approved', canonical_name: firmName })}
              className="flex-1 bg-gray-900 text-white text-sm font-medium py-2 rounded-lg"
            >
              Approve firm
            </button>
            <button
              onClick={() => onFirmDecision(firm.id, { status: 'skip' })}
              className="px-4 py-2 border border-gray-200 text-sm rounded-lg text-gray-400"
            >
              Skip
            </button>
          </div>
        )}
      </div>

      {/* Person sub-cards */}
      {expanded && pendingPeople.length > 0 && (
        <div className="pl-4 border-l-2 border-green-200 space-y-0">
          {pendingPeople.map(person => (
            <PlannerClusterCard
              key={person.id}
              cluster={person}
              allClusters={allClusters}
              personToFirm={personToFirm}
              parentFirmName={firmName}
              onDecision={onDecision}
              onAbsorb={onAbsorb}
              onMerge={onMerge}
            />
          ))}
        </div>
      )}
    </div>
  )
}
