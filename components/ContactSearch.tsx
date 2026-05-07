'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

export default function ContactSearch({ initialValue }: { initialValue: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const params = new URLSearchParams(searchParams.toString())
    if (e.target.value) params.set('q', e.target.value)
    else params.delete('q')
    router.replace(`/contacts?${params.toString()}`)
  }, [router, searchParams])

  return (
    <input
      type="search"
      defaultValue={initialValue}
      onChange={onChange}
      placeholder="Search contacts..."
      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gray-400 bg-white"
    />
  )
}
