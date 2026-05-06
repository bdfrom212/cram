'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DeleteContactButton({ contactId }: { contactId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)

  async function handleDelete() {
    await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
    router.push('/contacts')
    router.refresh()
  }

  if (confirming) {
    return (
      <div className="flex gap-2">
        <button onClick={handleDelete} className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-sm hover:bg-red-700 transition-colors">
          Delete
        </button>
        <button onClick={() => setConfirming(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"
    >
      Delete
    </button>
  )
}
