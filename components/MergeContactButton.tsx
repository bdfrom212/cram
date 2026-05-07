'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface ContactStub {
  id: string
  name: string
  company?: string | null
  role: string
}

interface Props {
  contactId: string
  contactName: string
  allContacts: ContactStub[]
}

export default function MergeContactButton({ contactId, contactName, allContacts }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const results = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return allContacts
      .filter(c => c.id !== contactId && (
        c.name.toLowerCase().includes(q) ||
        (c.company ?? '').toLowerCase().includes(q)
      ))
      .slice(0, 8)
  }, [search, allContacts, contactId])

  async function handleMerge(duplicateId: string) {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/contacts/${contactId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicateId }),
    })
    if (!res.ok) {
      setError('Merge failed — please try again')
      setSaving(false)
      return
    }
    router.refresh()
    setOpen(false)
    setSaving(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
      >
        Merge duplicate
      </button>
    )
  }

  return (
    <div className="w-full border border-orange-200 rounded-xl p-4 bg-orange-50 space-y-3">
      <p className="text-sm font-medium text-orange-800">
        Merge a duplicate into <span className="font-semibold">{contactName}</span>
      </p>
      <p className="text-xs text-orange-600">
        The contact you pick will be deleted. Its events and notes move here.
      </p>
      <input
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 bg-white"
        placeholder="Search for the duplicate..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
      />
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map(c => (
            <li key={c.id}>
              <button
                onClick={() => handleMerge(c.id)}
                disabled={saving}
                className="w-full text-left text-sm px-3 py-2 rounded-lg bg-white hover:bg-orange-100 border border-gray-200 disabled:opacity-50"
              >
                <span className="font-medium">{c.name}</span>
                {c.company && <span className="text-gray-400 ml-2">{c.company}</span>}
                <span className="text-gray-300 ml-2 capitalize">{c.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={() => setOpen(false)} className="text-xs text-gray-400">Cancel</button>
    </div>
  )
}
