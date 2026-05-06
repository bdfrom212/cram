import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import Image from 'next/image'
import SearchBar from '@/components/SearchBar'

interface UpcomingEvent {
  id: string
  title: string | null
  date: string
  venue_name: string | null
  venue_city: string | null
  venue_state: string | null
  event_contacts: { role: string; contact: { id: string; name: string } | null }[] | null
}

export default async function HomePage() {
  const supabase = await createClient()

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const cutoff = ninetyDaysAgo.toISOString().split('T')[0]

  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysOut = new Date()
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30)
  const endDate = thirtyDaysOut.toISOString().split('T')[0]

  const [{ data: stale }, { data: upcomingRaw }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, company, photo_url, last_contact_date, role')
      .eq('role', 'planner')
      .or(`last_contact_date.lt.${cutoff},last_contact_date.is.null`)
      .order('last_contact_date', { ascending: true, nullsFirst: true })
      .limit(5),
    supabase
      .from('events')
      .select('id, title, date, venue_name, venue_city, venue_state, event_contacts(role, contact:contacts(id, name))')
      .gte('date', today)
      .lte('date', endDate)
      .order('date')
      .limit(5),
  ])

  const upcoming = (upcomingRaw ?? []) as unknown as UpcomingEvent[]

  return (
    <div className="space-y-6">
      <SearchBar />

      {stale && stale.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Re-engage — 90+ days quiet</h2>
          <div className="space-y-2">
            {stale.map(c => (
              <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center text-sm font-medium text-gray-500">
                  {c.photo_url
                    ? <Image src={c.photo_url} alt={c.name} width={36} height={36} className="w-full h-full object-cover" />
                    : c.name[0]
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                  {c.company && <p className="text-xs text-gray-500 truncate">{c.company}</p>}
                </div>
                <p className="text-xs text-gray-400 flex-shrink-0">
                  {c.last_contact_date
                    ? new Date(c.last_contact_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                    : 'Never'
                  }
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Upcoming — next 30 days</h2>
          <div className="space-y-2">
            {upcoming.map(ev => (
              <Link key={ev.id} href={`/events/${ev.id}`} className="flex items-start gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="text-center flex-shrink-0 w-10">
                  <p className="text-xs text-gray-400 uppercase">
                    {new Date(ev.date).toLocaleDateString('en-US', { month: 'short' })}
                  </p>
                  <p className="text-lg font-semibold text-gray-900 leading-none">
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
      )}

      {(!stale?.length && !upcoming.length) && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium text-gray-600 mb-1">Nothing here yet</p>
          <p className="text-sm mb-5">Add your first planner or log a wedding to get started.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/contacts/new" className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors">
              Add Contact
            </Link>
            <Link href="/events/new" className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Log Event
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
