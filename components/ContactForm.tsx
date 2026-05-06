'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Contact } from '@/types'

interface Props {
  contact?: Partial<Contact>
  mode: 'create' | 'edit'
}

export default function ContactForm({ contact, mode }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [fields, setFields] = useState({
    name: contact?.name ?? '',
    company: contact?.company ?? '',
    role: contact?.role ?? 'planner',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    website: contact?.website ?? '',
    instagram: contact?.instagram ?? '',
    photo_url: contact?.photo_url ?? '',
    action_items: contact?.action_items ?? '',
    personal_notes: contact?.personal_notes ?? '',
    last_contact_date: contact?.last_contact_date ?? '',
  })

  function set(key: string, value: string) {
    setFields(f => ({ ...f, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!fields.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')

    try {
      const url = mode === 'create' ? '/api/contacts' : `/api/contacts/${contact?.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      if (photoFile) {
        const fd = new FormData()
        fd.append('file', photoFile)
        fd.append('contact_id', data.id)
        await fetch('/api/upload', { method: 'POST', body: fd })
      }

      router.push(`/contacts/${data.id}`)
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
        <h2 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Basic Info</h2>

        <Field label="Name *">
          <input value={fields.name} onChange={e => set('name', e.target.value)} className={input} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Company">
            <input value={fields.company} onChange={e => set('company', e.target.value)} className={input} />
          </Field>
          <Field label="Role">
            <select value={fields.role} onChange={e => set('role', e.target.value)} className={input}>
              <option value="planner">Planner</option>
              <option value="client">Client</option>
              <option value="vendor">Vendor</option>
            </select>
          </Field>
        </div>

        <Field label="Email">
          <input type="email" value={fields.email} onChange={e => set('email', e.target.value)} className={input} />
        </Field>

        <Field label="Phone">
          <input type="tel" value={fields.phone} onChange={e => set('phone', e.target.value)} className={input} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Website">
            <input value={fields.website} onChange={e => set('website', e.target.value)} className={input} placeholder="https://…" />
          </Field>
          <Field label="Instagram">
            <input value={fields.instagram} onChange={e => set('instagram', e.target.value)} className={input} placeholder="@handle" />
          </Field>
        </div>

        <Field label="Last Contact Date">
          <input type="date" value={fields.last_contact_date} onChange={e => set('last_contact_date', e.target.value)} className={input} />
        </Field>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Photo</h2>
        <Field label="Upload from computer">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-600"
          />
        </Field>
        <Field label="Or paste a URL">
          <input value={fields.photo_url} onChange={e => set('photo_url', e.target.value)} className={input} placeholder="https://…" />
        </Field>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">Notes</h2>
        <Field label="Bring Up / Discuss">
          <textarea value={fields.action_items} onChange={e => set('action_items', e.target.value)} rows={3} className={`${input} resize-none`} placeholder="Topics to raise next time you meet…" />
        </Field>
        <Field label="Personal Notes">
          <textarea value={fields.personal_notes} onChange={e => set('personal_notes', e.target.value)} rows={3} className={`${input} resize-none`} placeholder="Dog's name, hobbies, family details…" />
        </Field>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-xl bg-gray-900 text-white px-4 py-3 text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors"
        >
          {saving ? 'Saving…' : mode === 'create' ? 'Create Contact' : 'Save Changes'}
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
