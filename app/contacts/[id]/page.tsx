import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import AddNoteModal from '@/components/AddNoteModal'
import DeleteContactButton from '@/components/DeleteContactButton'
import type { ContactWithEvents } from '@/types'

export default async function ContactDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: contact } = await supabase
    .from('contacts')
    .select(`
      *,
      key_people(*),
      email_log(*),
      notes(*),
      event_contacts(role, event:events(*))
    `)
    .eq('id', id)
    .single()

  if (!contact) notFound()

  const c = contact as unknown as ContactWithEvents

  // Sort related records (can't ORDER in select string)
  if (c.notes) c.notes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  if (c.email_log) {
    c.email_log.sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime())
    c.email_log = c.email_log.slice(0, 5)
  }

  const events = (c.event_contacts ?? [])
    .map(ec => ({ ...ec.event!, role: ec.role }))
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const today = new Date().toISOString().split('T')[0]
  const pastEvents = events.filter(e => e.date <= today)
  const futureEvents = events.filter(e => e.date > today).reverse()

  const lastEvent = pastEvents[0]
  const nextEvent = futureEvents[0]

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fmtEventLine(ev: { id: string; title?: string | null; date: string; venue_name?: string | null; venue_city?: string | null; venue_state?: string | null }) {
    return [ev.title, fmtDate(ev.date), [ev.venue_name, ev.venue_city, ev.venue_state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  }

  const actionLines = c.action_items?.split('\n').filter(Boolean) ?? []
  const personalLines = c.personal_notes?.split('\n').filter(Boolean) ?? []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <Link href="/contacts" className="text-sm text-gray-400 hover:text-gray-600">← Contacts</Link>
        <div className="flex gap-2">
          <Link href={`/contacts/${id}/edit`} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Edit
          </Link>
          <DeleteContactButton contactId={id} />
        </div>
      </div>

      {/* Dossier Card */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

        {/* Identity */}
        <div className="flex items-start gap-4 p-5">
          <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center text-2xl font-medium text-gray-400">
            {c.photo_url
              ? <Image src={c.photo_url} alt={c.name} width={64} height={64} className="w-full h-full object-cover" />
              : c.name[0]
            }
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-gray-900">{c.name}</h1>
            {(c.company || c.role) && (
              <p className="text-sm text-gray-500 mt-0.5">
                {[c.company, c.role ? c.role.charAt(0).toUpperCase() + c.role.slice(1) : null].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="mt-2 space-y-0.5">
              {c.email && <a href={`mailto:${c.email}`} className="block text-sm text-blue-600 hover:underline">{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone}`} className="block text-sm text-gray-600">{c.phone}</a>}
              {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="block text-sm text-gray-500 hover:underline truncate">{c.website}</a>}
              {c.instagram && <p className="text-sm text-gray-500">{c.instagram}</p>}
            </div>
          </div>
        </div>

        {/* Events */}
        {(lastEvent || nextEvent) && (
          <div className="border-t border-gray-100 px-5 py-4 space-y-3">
            {lastEvent && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Last Event</p>
                <Link href={`/events/${lastEvent.id}`} className="text-sm text-gray-700 hover:text-gray-900 hover:underline">
                  {fmtEventLine(lastEvent)}
                </Link>
              </div>
            )}
            {nextEvent && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Next Event</p>
                <Link href={`/events/${nextEvent.id}`} className="text-sm text-gray-700 hover:text-gray-900 hover:underline">
                  {fmtEventLine(nextEvent)}
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Key People */}
        {c.key_people && c.key_people.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Key People{c.company ? ` at ${c.company}` : ''}
            </p>
            <ul className="space-y-1">
              {c.key_people.map(kp => (
                <li key={kp.id} className="text-sm text-gray-700">
                  <span className="font-medium">{kp.name}</span>
                  {kp.title && <span className="text-gray-400"> — {kp.title}</span>}
                  {kp.email && <a href={`mailto:${kp.email}`} className="ml-2 text-xs text-blue-500 hover:underline">{kp.email}</a>}
                  {kp.notes && <p className="text-xs text-gray-400 mt-0.5">{kp.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Items */}
        {actionLines.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Bring Up / Discuss</p>
            <ul className="space-y-1">
              {actionLines.map((line, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="text-gray-300 flex-shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Personal Notes from contact record */}
        {personalLines.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Personal Notes</p>
            <ul className="space-y-1">
              {personalLines.map((line, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="text-gray-300 flex-shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Field Notes (timestamped) */}
        {c.notes && c.notes.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Field Notes</p>
            <ul className="space-y-2">
              {c.notes.map(n => (
                <li key={n.id} className="text-sm">
                  <p className="text-xs text-gray-400 mb-0.5">
                    {new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  <p className="text-gray-700">{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent Emails */}
        {c.email_log && c.email_log.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent Emails</p>
            <ul className="space-y-2">
              {c.email_log.map(e => (
                <li key={e.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${e.direction === 'inbound' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {e.direction === 'inbound' ? '↓ in' : '↑ out'}
                    </span>
                    <span className="font-medium text-gray-700 truncate flex-1">{e.subject}</span>
                    {e.last_message_at && (
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {new Date(e.last_message_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {e.snippet && <p className="text-xs text-gray-400 mt-0.5 truncate">{e.snippet}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="border-t border-gray-100 px-5 py-4 flex gap-3 flex-wrap">
          <AddNoteModal contactId={id} />
          {events.length > 1 && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-900 select-none">
                Full History ({events.length} events)
              </summary>
              <ul className="mt-3 space-y-1">
                {events.map(ev => (
                  <li key={ev.id}>
                    <Link href={`/events/${ev.id}`} className="text-sm text-gray-600 hover:text-gray-900 hover:underline">
                      {fmtEventLine(ev)}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
