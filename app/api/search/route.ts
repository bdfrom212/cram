import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ contacts: [], events: [] })

  const supabase = await createClient()

  const [{ data: contacts }, { data: events }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, company, role, photo_url, last_contact_date')
      .or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`)
      .order('name')
      .limit(10),
    supabase
      .from('events')
      .select('id, title, date, venue_name, venue_city, venue_state')
      .or(`title.ilike.%${q}%,venue_name.ilike.%${q}%,venue_city.ilike.%${q}%,venue_state.ilike.%${q}%`)
      .order('date', { ascending: false })
      .limit(10),
  ])

  return NextResponse.json({ contacts: contacts ?? [], events: events ?? [] })
}
