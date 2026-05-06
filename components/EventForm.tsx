'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Event, Contact } from '@/types'

interface EventContact {
  contact_id: string
  role: string
  name?: string
}

interface Props {
  event?: Partial<Event & { event_contacts: { contact_id: string; role: string; contact: Contact }[] }>
  mode: 'create' | 'edit'
}

export default function EventForm({ event, mode }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [allContacts, setAllContacts] = useState<Contact[]>([])
  const [linkedContacts, setLinkedContacts] = useState<EventContact[]>(
    event?.event_contacts?.map(ec => ({ contact_id: ec.contact_id, role: ec.role, name: ec.contact.name })) ?? []
  )
  const [fields, setFields] = useState({
    title: event?.title ?? '',
    date: event?.date ?? '',
    venue_name: event?.venue_name ?? '',
    venue_city: event?.venue_city ?? '',
    venue_state: event?.venue_state ?? '',
    notes: event?.notes ?? '',
    tags: event?.tags?.join(', ') ?? '',
  })

  useEffect(() => {
    fetch('/api/contacts').then(r => r.json()).then(setAllContacts)
  }, [])

  function set(key: string, value: string) {
    setFields(f => ({ ...f, [key]: value }))
  }

  function addContact() {
    setLinkedContacts(lc => [...lc, { contact_id: '', role: 'planner' }])
  }

  function updateContact(i: number, key: string, value: string) {
    setLinkedContacts(lc => lc.map((c, idx) => idx === i ? { ...c, [key]: value } : c))
  }

  function removeContact(i: number) {
    setLinkedContacts(lc => lc.filter((_, idx) => idx !== i))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!fields.date) { setError('Date is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...fields,
        tags: fields.tags ? fields.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        contacts: linkedContacts.filter(c => c.contact_id),
      }
      const url = mode === 'create' ? '/api/events' : `/api/events/${event?.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/events/${data.id}`)
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Event Details</h2>

        <Field label="Couple Names (e.g. Smith / Jones)">
          <input value={fields.title} onChange={e => set('title', e.target.value)} className={input} placeholder="Smith / Jones" />
        </Field>

        <Field label="Date *">
          <input type="date" value={fields.date} onChange={e => set('date', e.target.value)} className={input} />
        </Field>

        <Field label="Venue Name">
          <input value={fields.venue_name} onChange={e => set('venue_name', e.target.value)} className={input} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input value={fields.venue_city} onChange={e => set('venue_city', e.target.value)} className={input} />
          </Field>
          <Field label="State">
            <input value={fields.venue_state} onChange={e => set('venue_state', e.target.value)} className={input} placeholder="RI" />
          </Field>
        </div>

        <Field label="Tags (comma-separated)">
          <input value={fields.tags} onChange={e => set('tags', e.target.value)} className={input} placeholder="beach, ballroom, rhode island" />
        </Field>

        <Field label="Notes">
          <textarea value={fields.notes} onChange={e => set('notes', e.target.value)} rows={3} className={`${input} resize-none`} />
        </Field>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Contacts</h2>
          <button type="button" onClick={addContact} className="text-sm text-gray-500 hover:text-gray-900">+ Add</button>
        </div>

        {linkedContacts.map((lc, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={lc.contact_id}
              onChange={e => updateContact(i, 'contact_id', e.target.value)}
              className={`${input} flex-1`}
            >
              <option value="">— select contact —</option>
              {allContacts.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
              ))}
            </select>
            <select
              value={lc.role}
              onChange={e => updateContact(i, 'role', e.target.value)}
              className={`${input} w-32`}
            >
              <option value="planner">Planner</option>
              <option value="client">Client</option>
              <option value="coordinator">Coordinator</option>
              <option value="vendor">Vendor</option>
            </select>
            <button type="button" onClick={() => removeContact(i)} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
          </div>
        ))}

        {linkedContacts.length === 0 && (
          <p className="text-sm text-gray-400">No contacts linked yet.</p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-xl bg-gray-900 text-white px-4 py-3 text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors"
        >
          {saving ? 'Saving…' : mode === 'create' ? 'Create Event' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white'
