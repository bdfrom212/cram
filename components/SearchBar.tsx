'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'

interface SearchResult {
  contacts: { id: string; name: string; company?: string; role: string; photo_url?: string }[]
  events: { id: string; title?: string; date: string; venue_name?: string; venue_city?: string; venue_state?: string }[]
}

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults(null); setOpen(false); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data)
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const hasResults = results && (results.contacts.length > 0 || results.events.length > 0)

  return (
    <div ref={ref} className="relative w-full">
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Search contacts, venues, cities…"
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-gray-400 focus:ring-0"
      />
      {loading && (
        <div className="absolute right-3 top-3.5 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      )}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
          {!hasResults && !loading && (
            <p className="px-4 py-3 text-sm text-gray-400">No results for &ldquo;{query}&rdquo;</p>
          )}
          {results?.contacts.map(c => (
            <Link
              key={c.id}
              href={`/contacts/${c.id}`}
              onClick={() => { setOpen(false); setQuery('') }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50"
            >
              <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
                {c.photo_url
                  ? <Image src={c.photo_url} alt={c.name} width={32} height={32} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xs font-medium text-gray-500">{c.name[0]}</div>
                }
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{c.name}</p>
                {c.company && <p className="text-xs text-gray-500">{c.company}</p>}
              </div>
              <span className="ml-auto text-xs text-gray-400 capitalize">{c.role}</span>
            </Link>
          ))}
          {results?.events && results.events.length > 0 && results.contacts.length > 0 && (
            <div className="border-t border-gray-100" />
          )}
          {results?.events.map(e => (
            <Link
              key={e.id}
              href={`/events/${e.id}`}
              onClick={() => { setOpen(false); setQuery('') }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50"
            >
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-400 text-xs">
                &#128338;
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{e.title || 'Unnamed event'}</p>
                <p className="text-xs text-gray-500">
                  {new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {e.venue_name && ` · ${e.venue_name}`}
                  {e.venue_city && `, ${e.venue_city}`}
                  {e.venue_state && `, ${e.venue_state}`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
