import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select('*, event_contacts(role, contact:contacts(id, name, company, photo_url))')
    .order('date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { contacts: contactLinks, ...eventData } = body

  const { data: event, error } = await supabase
    .from('events')
    .insert(eventData)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (contactLinks?.length) {
    const links = contactLinks.map((c: { contact_id: string; role: string }) => ({
      event_id: event.id,
      contact_id: c.contact_id,
      role: c.role,
    }))
    await supabase.from('event_contacts').insert(links)
  }

  return NextResponse.json(event, { status: 201 })
}
