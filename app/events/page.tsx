import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

interface EventContactRow {
  role: string
  contact: { id: string; name: string } | null
}

interface EventRow {
  id: string
  title: string | null
  date: string
  venue_name: string | null
  tave_job_id: string | null
  event_contacts: EventContactRow[] | null
}

export default async function EventsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('events')
    .select('id, title, date, venue_name, tave_job_id, event_contacts(role, contact:contacts(id, name))')
    .order('date', { ascending: false })

  const events = (data ?? []) as unknown as EventRow[]
  const today = new Date().toISOString().split('T')[0]

  const upcoming = events.filter(e => e.date >= today)
  const past     = events.filter(e => e.date <  today)

  // Group past events by year
  const byYear = new Map<number, EventRow[]>()
  for (const ev of past) {
    const year = parseInt(ev.date.slice(0, 4))
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(ev)
  }
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Events</h1>
        <Link href="/events/new" className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors">
          + Add
        </Link>
      </div>

      {events.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-12">
          No events yet. <Link href="/events/new" className="text-gray-900 underline">Add your first one.</Link>
        </p>
      )}

      {upcoming.length > 0 && (
        <details open>
          <summary className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 cursor-pointer select-none list-none flex items-center justify-between">
            <span>Upcoming ({upcoming.length})</span>
          </summary>
          <div className="space-y-1 mt-2">
            {upcoming.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        </details>
      )}

      {sortedYears.map(year => (
        <details key={year} open={year >= currentYear - 1}>
          <summary className="text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer select-none list-none flex items-center justify-between py-1">
            <span>{year} ({byYear.get(year)!.length})</span>
            <span className="text-gray-300">▾</span>
          </summary>
          <div className="space-y-1 mt-2">
            {byYear.get(year)!.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        </details>
      ))}
    </div>
  )
}

function EventRow({ ev }: { ev: EventRow }) {
  const d = new Date(ev.date)
  const plannerNames = (ev.event_contacts ?? [])
    .filter(ec => ec.contact)
    .slice(0, 3)
    .map(ec => ec.contact!.name)

  return (
    <div className="flex items-start gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
      <Link href={`/events/${ev.id}`} className="flex items-start gap-3 flex-1 min-w-0">
        <div className="text-center flex-shrink-0 w-10">
          <p className="text-xs text-gray-400 uppercase leading-none">
            {d.toLocaleDateString('en-US', { month: 'short' })}
          </p>
          <p className="text-lg font-semibold text-gray-900 leading-tight">{d.getDate()}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{ev.title || 'Unnamed'}</p>
          {ev.venue_name && <p className="text-xs text-gray-500 truncate">{ev.venue_name}</p>}
          {plannerNames.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{plannerNames.join(', ')}</p>
          )}
        </div>
      </Link>
      {ev.tave_job_id && (
        <a
          href={`https://tave.app/jobs/view/${ev.tave_job_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 text-xs text-gray-300 hover:text-blue-500 px-1 py-0.5 rounded"
          title="Open in Tave"
        >
          ↗
        </a>
      )}
    </div>
  )
}
