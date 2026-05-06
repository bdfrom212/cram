'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()

  if (pathname === '/login') return null

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link href="/" className="font-semibold text-gray-900 tracking-tight">
          cram
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/contacts"
            className={`${pathname.startsWith('/contacts') ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Contacts
          </Link>
          <Link
            href="/events"
            className={`${pathname.startsWith('/events') ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Events
          </Link>
          <button
            onClick={signOut}
            className="text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  )
}
