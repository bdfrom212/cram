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
  venue_city: string | null
  venue_state: string | null
  event_contacts: EventContactRow[] | null
}

export default async function EventsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('events')
    .select('id, title, date, venue_name, venue_city, venue_state, event_contacts(role, contact:contacts(id, name))')
    .order('date', { ascending: false })

  const events = (data ?? []) as unknown as EventRow[]
  const today = new Date().toISOString().split('T')[0]
  const upcoming = events.filter(e => e.date >= today)
  const past = events.filter(e => e.date < today)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Events</h1>
        <Link href="/events/new" className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors">
          + Add
        </Link>
      </div>

      {events.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-12">No events yet. <Link href="/events/new" className="text-gray-900 underline">Log your first wedding.</Link></p>
      )}

      {upcoming.length > 0 && <EventGroup label="Upcoming" events={upcoming} />}
      {past.length > 0 && <EventGroup label="Past" events={past} />}
    </div>
  )
}

function EventGroup({ label, events }: { label: string; events: EventRow[] }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label} ({events.length})</h2>
      <div className="space-y-1">
        {events.map(ev => (
          <Link
            key={ev.id}
            href={`/events/${ev.id}`}
            className="flex items-start gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="text-center flex-shrink-0 w-10">
              <p className="text-xs text-gray-400 uppercase leading-none">
                {new Date(ev.date).toLocaleDateString('en-US', { month: 'short' })}
              </p>
              <p className="text-lg font-semibold text-gray-900 leading-tight">
                {new Date(ev.date).getDate()}
              </p>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{ev.title || 'Unnamed'}</p>
              <p className="text-xs text-gray-500">
                {[ev.venue_name, ev.venue_city, ev.venue_state].filter(Boolean).join(', ')}
              </p>
              {(ev.event_contacts?.length ?? 0) > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {ev.event_contacts!.slice(0, 3).map(ec => ec.contact?.name).filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
