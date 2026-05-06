import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import DeleteEventButton from '@/components/DeleteEventButton'

interface EventContactRow {
  role: string
  contact: { id: string; name: string; company?: string | null; photo_url?: string | null }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: event } = await supabase
    .from('events')
    .select('*, event_contacts(role, contact:contacts(id, name, company, photo_url))')
    .eq('id', id)
    .single()

  if (!event) notFound()

  const eventContacts = (event.event_contacts ?? []) as unknown as EventContactRow[]

  const dateStr = new Date(event.date).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const planners = eventContacts.filter(ec => ['planner', 'coordinator'].includes(ec.role))
  const clients = eventContacts.filter(ec => ec.role === 'client')
  const vendors = eventContacts.filter(ec => ec.role === 'vendor')

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <Link href="/events" className="text-sm text-gray-400 hover:text-gray-600">← Events</Link>
        <div className="flex gap-2">
          <Link href={`/events/${id}/edit`} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Edit
          </Link>
          <DeleteEventButton eventId={id} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-5 border-b border-gray-100">
          <h1 className="text-xl font-semibold text-gray-900">{event.title || 'Unnamed Event'}</h1>
          <p className="text-sm text-gray-500 mt-1">{dateStr}</p>
          {(event.venue_name || event.venue_city) && (
            <p className="text-sm text-gray-600 mt-0.5">
              {[event.venue_name, event.venue_city, event.venue_state].filter(Boolean).join(', ')}
            </p>
          )}
          {(event.tags as string[] | null)?.length ? (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {(event.tags as string[]).map(tag => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          ) : null}
        </div>

        {planners.length > 0 && <ContactSection label="Planners" contacts={planners} />}
        {clients.length > 0 && <ContactSection label="Clients" contacts={clients} />}
        {vendors.length > 0 && <ContactSection label="Vendors" contacts={vendors} />}

        {event.notes && (
          <div className="px-5 py-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{event.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ContactSection({ label, contacts }: { label: string; contacts: EventContactRow[] }) {
  return (
    <div className="px-5 py-4 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <div className="space-y-2">
        {contacts.map(ec => (
          <Link
            key={ec.contact.id}
            href={`/contacts/${ec.contact.id}`}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-medium text-gray-500">
              {ec.contact.photo_url
                ? <Image src={ec.contact.photo_url} alt={ec.contact.name} width={32} height={32} className="w-full h-full object-cover" />
                : ec.contact.name[0]
              }
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{ec.contact.name}</p>
              {ec.contact.company && <p className="text-xs text-gray-500">{ec.contact.company}</p>}
            </div>
            <span className="ml-auto text-xs text-gray-400 capitalize">{ec.role}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
