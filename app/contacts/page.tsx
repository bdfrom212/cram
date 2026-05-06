import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import Image from 'next/image'

interface ContactRow {
  id: string
  name: string
  company?: string | null
  role: string
  photo_url?: string | null
  last_contact_date?: string | null
}

export default async function ContactsPage() {
  const supabase = await createClient()
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, company, role, photo_url, last_contact_date')
    .order('name')

  const planners = (contacts ?? []).filter(c => c.role === 'planner') as ContactRow[]
  const clients = (contacts ?? []).filter(c => c.role === 'client') as ContactRow[]
  const vendors = (contacts ?? []).filter(c => c.role === 'vendor') as ContactRow[]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <Link href="/contacts/new" className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors">
          + Add
        </Link>
      </div>

      {contacts?.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-12">No contacts yet. <Link href="/contacts/new" className="text-gray-900 underline">Add your first one.</Link></p>
      )}

      {planners.length > 0 && <ContactGroup label="Planners" contacts={planners} />}
      {clients.length > 0 && <ContactGroup label="Clients" contacts={clients} />}
      {vendors.length > 0 && <ContactGroup label="Vendors" contacts={vendors} />}
    </div>
  )
}

function ContactGroup({ label, contacts }: { label: string; contacts: ContactRow[] }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        {label} ({contacts.length})
      </h2>
      <div className="space-y-1">
        {contacts.map(c => (
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
            {c.last_contact_date && (
              <p className="text-xs text-gray-400 flex-shrink-0">
                {new Date(c.last_contact_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}
