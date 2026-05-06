import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Nav from '@/components/Nav'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Cram — Relationship Intelligence',
  description: 'Wedding photography relationship management',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 text-gray-900 min-h-screen`}>
        <Nav />
        <main className="max-w-2xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  )
}
