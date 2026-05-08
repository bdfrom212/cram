'use client'

import { useState } from 'react'
import type { Brief } from '@/lib/agents/store'

interface EventContact {
  role: string
  contact: { id: string; name: string; company?: string | null }
}

interface Props {
  eventId: string
  initialBrief: Brief | null
  eventContacts: EventContact[]
}

interface ParsedPerson {
  name: string
  role: string
  summary: string
  contact: EventContact['contact'] | null
  ecRole: string | null
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

function parseBriefPersons(content: string, eventContacts: EventContact[]): ParsedPerson[] {
  // Split on ## headers that follow the "Name — Role" pattern
  const sections = content.split(/\n(?=## )/)
  const persons: ParsedPerson[] = []

  for (const section of sections) {
    const headerMatch = section.match(/^## (.+?) —/)
    if (!headerMatch) continue
    const name = headerMatch[1].trim()

    // Match to a linked event contact by name (first name match is enough for display)
    const firstName = name.split(' ')[0].toLowerCase()
    const ec = eventContacts.find(ec =>
      ec.contact.name.toLowerCase() === name.toLowerCase() ||
      ec.contact.name.toLowerCase().startsWith(firstName)
    )

    // Strip header line, keep the rest as the summary to save
    const summary = section.replace(/^## .+\n/, '').trim()

    persons.push({
      name,
      role: section.match(/^## .+ — (.+)/)?.[1]?.trim() ?? '',
      summary,
      contact: ec?.contact ?? null,
      ecRole: ec?.role ?? null,
    })
  }

  return persons
}

type SaveState = 'idle' | 'confirming' | 'saving' | 'saved' | 'error'

export default function ResearchSection({ eventId, initialBrief, eventContacts }: Props) {
  const [brief, setBrief] = useState<Brief | null>(initialBrief)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})

  async function generate(force = false) {
    setLoading(true)
    setError(null)
    setSaveStates({})
    try {
      const res = await fetch('/api/agents/researcher', {
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

  async function saveResearch(person: ParsedPerson) {
    if (!person.contact) return
    const id = person.contact.id

    // Clients require one confirmation tap
    if (person.ecRole === 'client' && saveStates[id] !== 'confirming') {
      setSaveStates(prev => ({ ...prev, [id]: 'confirming' }))
      return
    }

    setSaveStates(prev => ({ ...prev, [id]: 'saving' }))
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          research_summary: person.summary,
          last_researched_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStates(prev => ({ ...prev, [id]: 'saved' }))
    } catch {
      setSaveStates(prev => ({ ...prev, [id]: 'error' }))
    }
  }

  if (!brief) {
    return (
      <div className="border-t border-gray-100 px-5 py-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Research Brief</p>
        <button
          onClick={() => generate(false)}
          disabled={loading}
          className="w-full rounded-xl bg-indigo-600 text-white px-4 py-3 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Diana is researching…' : 'Run Research — Diana'}
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

  const persons = parseBriefPersons(brief.content, eventContacts)

  return (
    <div className="border-t border-gray-100 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Research Brief</p>
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
          <p key={i}>{formatContent(block)}</p>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

      {/* Save to contacts panel */}
      {persons.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Save Research to Contacts</p>
          {persons.map(person => {
            const id = person.contact?.id
            const state = id ? (saveStates[id] ?? 'idle') : 'idle'
            const isClient = person.ecRole === 'client'

            return (
              <div key={person.name} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <span className="text-sm text-gray-800">{person.name}</span>
                  <span className="ml-2 text-xs text-gray-400 capitalize">{person.ecRole ?? person.role}</span>
                  {!person.contact && (
                    <span className="ml-2 text-xs text-amber-500">no contact record</span>
                  )}
                </div>

                {person.contact && (
                  <div className="flex-shrink-0">
                    {state === 'saved' && (
                      <span className="text-xs text-emerald-600">Saved ✓</span>
                    )}
                    {state === 'error' && (
                      <span className="text-xs text-red-500">Error — retry?</span>
                    )}
                    {state === 'saving' && (
                      <span className="text-xs text-gray-400">Saving…</span>
                    )}
                    {state === 'confirming' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-600">Confirm this is the right {person.name.split(' ')[0]}?</span>
                        <button
                          onClick={() => saveResearch(person)}
                          className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-lg hover:bg-indigo-500"
                        >
                          Yes, save
                        </button>
                        <button
                          onClick={() => setSaveStates(prev => ({ ...prev, [person.contact!.id]: 'idle' }))}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {state === 'idle' && (
                      <button
                        onClick={() => saveResearch(person)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded-lg border border-indigo-200 hover:border-indigo-400 transition-colors"
                      >
                        {isClient ? 'Confirm & Save' : 'Save to contact'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
