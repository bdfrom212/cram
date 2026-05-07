import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import Image from 'next/image'
import { Suspense } from 'react'
import ContactSearch from '@/components/ContactSearch'

interface ContactRow {
  id: string
  name: string
  company?: string | null
  role: string
  photo_url?: string | null
  instagram?: string | null
  event_contacts: { event_id: string }[]
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('contacts')
    .select('id, name, company, role, photo_url, instagram, event_contacts(event_id)')

  if (q) {
    query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%`)
  }

  const { data } = await query.order('name')
  const contacts = (data ?? []) as unknown as ContactRow[]

  // Sort by event count desc (most frequent collaborators first), then name
  contacts.sort((a, b) => {
    const diff = (b.event_contacts?.length ?? 0) - (a.event_contacts?.length ?? 0)
    return diff !== 0 ? diff : a.name.localeCompare(b.name)
  })

  const planners = contacts.filter(c => c.role === 'planner')
  const clients  = contacts.filter(c => c.role === 'client')
  const vendors  = contacts.filter(c => c.role === 'vendor')
  const venues   = contacts.filter(c => c.role === 'venue')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <Link href="/contacts/new" className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors">
          + Add
        </Link>
      </div>

      <Suspense>
        <ContactSearch initialValue={q ?? ''} />
      </Suspense>

      {contacts.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-12">
          {q ? `No contacts matching "${q}"` : 'No contacts yet.'}
        </p>
      )}

      {planners.length > 0 && <ContactGroup label="Planners" contacts={planners} />}
      {venues.length > 0   && <ContactGroup label="Venues"   contacts={venues} />}
      {clients.length > 0  && <ContactGroup label="Clients"  contacts={clients} defaultOpen={!!q} />}
      {vendors.length > 0  && <ContactGroup label="Vendors"  contacts={vendors} />}
    </div>
  )
}

function ContactGroup({ label, contacts, defaultOpen = true }: { label: string; contacts: ContactRow[]; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen}>
      <summary className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 cursor-pointer select-none list-none flex items-center justify-between py-1">
        <span>{label} ({contacts.length})</span>
        <span className="text-gray-300">▾</span>
      </summary>
      <div className="space-y-1 mt-1">
        {contacts.map(c => {
          const eventCount = c.event_contacts?.length ?? 0
          return (
            <Link
              key={c.id}
              href={`/contacts/${c.id}`}
              className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
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
              {eventCount > 0 && (
                <p className="text-xs text-gray-400 flex-shrink-0">{eventCount} event{eventCount !== 1 ? 's' : ''}</p>
              )}
            </Link>
          )
        })}
      </div>
    </details>
  )
}
