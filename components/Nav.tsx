'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)

  if (pathname === '/login') return null

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function handleTouchStart() {
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      alert(`Built: ${buildLabel}`)
    }, 500)
  }

  function handleTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  function handleLogoClick(e: React.MouseEvent) {
    if (didLongPress.current) {
      e.preventDefault()
      didLongPress.current = false
    }
  }

  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
    ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })
    : 'dev build'
  const commitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
  const buildLabel = commitSha ? `${buildTime} · ${commitSha}` : buildTime

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link
          href="/"
          className="font-semibold text-gray-900 tracking-tight select-none"
          title={`Built: ${buildLabel}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchEnd}
          onContextMenu={e => e.preventDefault()}
          onClick={handleLogoClick}
        >
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
          <Link
            href="/grace"
            className={`${pathname.startsWith('/grace') ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Grace
          </Link>
          <Link
            href="/updates"
            className={`${pathname.startsWith('/updates') ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Updates
          </Link>
          <Link
            href="/import"
            className={`${pathname.startsWith('/import') ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Import
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
