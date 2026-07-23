// POST /api/assistant/confirm-merge
// Called when Brian clicks "Confirm Merge" in the MergePreview card.
// This is the ONLY place execute_merge logic lives — Grace cannot trigger it.

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { filterContactFields } from '@/lib/contacts/fields'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id_keep, id_delete, field_overrides = {}, session_id } = await request.json()

  if (!id_keep || !id_delete || id_keep === id_delete) {
    return NextResponse.json({ error: 'Invalid contact IDs' }, { status: 400 })
  }

  // Capture before-state for both contacts (undo will restore the deleted one)
  const [{ data: keepBefore }, { data: deleteBefore }] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id_keep).single(),
    supabase.from('contacts').select('*').eq('id', id_delete).single(),
  ])

  if (!keepBefore || !deleteBefore) {
    return NextResponse.json({ error: 'One or both contacts not found' }, { status: 404 })
  }

  // Apply field overrides to the keeper (allowlist enforced)
  const safeOverrides = filterContactFields(field_overrides)
  if (Object.keys(safeOverrides).length > 0) {
    await supabase.from('contacts').update(safeOverrides).eq('id', id_keep)
  }

  // Re-link event_contacts from duplicate to keeper (skip any already linked to keeper)
  const { data: dupLinks } = await supabase
    .from('event_contacts').select('event_id, role, company_context').eq('contact_id', id_delete)

  if (dupLinks && dupLinks.length > 0) {
    const { data: keepLinks } = await supabase
      .from('event_contacts').select('event_id').eq('contact_id', id_keep)
    const keepEventIds = new Set((keepLinks ?? []).map((l: { event_id: string }) => l.event_id))
    const toInsert = dupLinks
      .filter((l: { event_id: string }) => !keepEventIds.has(l.event_id))
      .map((l: { event_id: string; role: string; company_context: string | null }) => ({
        event_id: l.event_id, contact_id: id_keep, role: l.role, company_context: l.company_context,
      }))
    if (toInsert.length > 0) await supabase.from('event_contacts').insert(toInsert)
  }

  // Move notes and key_people to keeper
  await supabase.from('notes').update({ contact_id: id_keep }).eq('contact_id', id_delete)
  await supabase.from('key_people').update({ contact_id: id_keep }).eq('contact_id', id_delete)

  // Delete remaining event_contacts for duplicate, then the duplicate itself
  await supabase.from('event_contacts').delete().eq('contact_id', id_delete)
  await supabase.from('contacts').delete().eq('id', id_delete)

  // Log the operation — before_state stores both contacts so undo can restore the deleted one
  const operationId = crypto.randomUUID()
  await supabase.from('operations_log').insert({
    id: operationId,
    user_id: user.id,
    agent: 'margaret',
    operation_type: 'merge',
    entity_type: 'contact',
    entity_id: id_delete,
    before_state: { deleted_contact: deleteBefore, keeper_before: keepBefore },
    after_state: { kept_id: id_keep, deleted_id: id_delete, overrides_applied: safeOverrides },
    ...(session_id ? { session_id } : {}),
  })

  const undoExpiresAt = new Date(Date.now() + 60_000).toISOString()

  return NextResponse.json({
    ok: true,
    undo_token: operationId,
    undo_expires_at: undoExpiresAt,
    kept_id: id_keep,
  })
}
