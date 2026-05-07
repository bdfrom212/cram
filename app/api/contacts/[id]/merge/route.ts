import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/contacts/:id/merge  { duplicateId: string }
// Merges duplicateId INTO :id — :id survives, duplicateId is deleted.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: keepId } = await params
  const { duplicateId } = await request.json()

  if (!duplicateId || duplicateId === keepId) {
    return NextResponse.json({ error: 'Invalid duplicateId' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  // Re-point all event_contacts from the duplicate to the keeper
  // Skip any that would create a duplicate (same event already linked to keeper)
  const { data: dupLinks } = await supabase
    .from('event_contacts')
    .select('event_id, role, company_context')
    .eq('contact_id', duplicateId)

  if (dupLinks && dupLinks.length > 0) {
    const { data: keepLinks } = await supabase
      .from('event_contacts')
      .select('event_id')
      .eq('contact_id', keepId)

    const keepEventIds = new Set((keepLinks ?? []).map(l => l.event_id))
    const toInsert = dupLinks
      .filter(l => !keepEventIds.has(l.event_id))
      .map(l => ({ event_id: l.event_id, contact_id: keepId, role: l.role, company_context: l.company_context }))

    if (toInsert.length > 0) {
      await supabase.from('event_contacts').insert(toInsert)
    }
  }

  // Move notes from duplicate to keeper
  await supabase.from('notes').update({ contact_id: keepId }).eq('contact_id', duplicateId)

  // Move key_people from duplicate to keeper
  await supabase.from('key_people').update({ contact_id: keepId }).eq('contact_id', duplicateId)

  // Delete the duplicate (remaining event_contacts cascade-delete or we clean up)
  await supabase.from('event_contacts').delete().eq('contact_id', duplicateId)
  await supabase.from('contacts').delete().eq('id', duplicateId)

  return NextResponse.json({ ok: true })
}
