import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select('*, event_contacts(role, contact:contacts(*))')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const body = await request.json()
  const { contacts: contactLinks, ...eventData } = body

  const { data, error } = await supabase
    .from('events')
    .update(eventData)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (contactLinks !== undefined) {
    await supabase.from('event_contacts').delete().eq('event_id', id)
    if (contactLinks.length) {
      const links = contactLinks.map((c: { contact_id: string; role: string }) => ({
        event_id: id,
        contact_id: c.contact_id,
        role: c.role,
      }))
      await supabase.from('event_contacts').insert(links)
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
