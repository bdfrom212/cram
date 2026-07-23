// POST /api/assistant/undo
// Handles the 60-second undo window after a Grace or Margaret operation.

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { operation_id } = await request.json()
  if (!operation_id) return NextResponse.json({ error: 'operation_id required' }, { status: 400 })

  const { data: op } = await supabase
    .from('operations_log').select('*')
    .eq('id', operation_id).eq('user_id', user.id).single()

  if (!op) return NextResponse.json({ error: 'Operation not found' }, { status: 404 })
  if (op.undone_at) return NextResponse.json({ error: 'Already undone' }, { status: 409 })

  // Check the 60-second window
  const ageMs = Date.now() - new Date(op.created_at).getTime()
  if (ageMs > 60_000) {
    return NextResponse.json({ error: 'Undo window has expired' }, { status: 410 })
  }

  if (op.operation_type === 'merge') {
    // Restore the deleted contact
    const deletedContact = op.before_state?.deleted_contact
    if (!deletedContact) return NextResponse.json({ error: 'No snapshot to restore' }, { status: 500 })

    // Re-insert the deleted contact with its original data
    const { id: originalId, ...contactData } = deletedContact
    await supabase.from('contacts').insert({ id: originalId, ...contactData })

    // Move notes and key_people back to the restored contact
    await supabase.from('notes').update({ contact_id: originalId }).eq('contact_id', op.after_state?.kept_id)
    await supabase.from('key_people').update({ contact_id: originalId }).eq('contact_id', op.after_state?.kept_id)

    await supabase.from('operations_log')
      .update({ undone_at: new Date().toISOString() }).eq('id', operation_id)

    return NextResponse.json({ ok: true, restored_id: originalId })
  }

  if (op.operation_type === 'update' && op.before_state) {
    // Restore the contact's previous field values
    const { id: _id, created_at: _c, updated_at: _u, ...restorableFields } = op.before_state
    await supabase.from('contacts').update(restorableFields).eq('id', op.entity_id)
    await supabase.from('operations_log')
      .update({ undone_at: new Date().toISOString() }).eq('id', operation_id)
    return NextResponse.json({ ok: true })
  }

  if (op.operation_type === 'add_note') {
    // Delete the note
    const { data: note } = await supabase
      .from('notes').select('id').eq('contact_id', op.entity_id)
      .order('created_at', { ascending: false }).limit(1).single()
    if (note) await supabase.from('notes').delete().eq('id', note.id)
    await supabase.from('operations_log')
      .update({ undone_at: new Date().toISOString() }).eq('id', operation_id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Cannot undo this operation type' }, { status: 422 })
}
