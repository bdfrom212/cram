'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AddNoteModal({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function save() {
    if (!body.trim()) return
    setSaving(true)
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, body }),
      })
      setBody('')
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        + Add Note
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Add Note</h3>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              autoFocus
              rows={4}
              placeholder="What came up? Dog's name, mentioned a venue, follow-up needed…"
              className="w-full rounded-lg border border-gray-200 p-3 text-sm outline-none focus:border-gray-400 resize-none"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={save}
                disabled={saving || !body.trim()}
                className="flex-1 rounded-lg bg-gray-900 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setOpen(false); setBody('') }}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
