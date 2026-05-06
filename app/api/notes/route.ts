import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { contact_id, body } = await request.json()
  if (!contact_id || !body?.trim()) {
    return NextResponse.json({ error: 'contact_id and body required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('notes')
    .insert({ contact_id, body: body.trim() })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update last_contact_date
  await supabase
    .from('contacts')
    .update({ last_contact_date: new Date().toISOString().split('T')[0] })
    .eq('id', contact_id)

  return NextResponse.json(data, { status: 201 })
}
