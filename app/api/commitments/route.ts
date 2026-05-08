import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('commitments')
    .select('id, body, source, due_date, created_at, contact:contacts(name), event:events(title, date)')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ commitments: data ?? [] })
}
