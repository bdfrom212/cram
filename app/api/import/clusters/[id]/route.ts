import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  const body = await request.json()
  const { canonical_name, individuals, instagram, status, notes, raw_strings, event_count, role } = body

  const updateFields: Record<string, unknown> = {}
  if (canonical_name !== undefined) updateFields.canonical_name = canonical_name
  if (individuals !== undefined) updateFields.individuals = individuals
  if (instagram !== undefined) updateFields.instagram = instagram
  if (status !== undefined) updateFields.status = status
  if (notes !== undefined) updateFields.notes = notes
  if (raw_strings !== undefined) updateFields.raw_strings = raw_strings
  if (event_count !== undefined) updateFields.event_count = event_count
  if (role !== undefined) updateFields.role = role

  const { data, error } = await supabase
    .from('import_planner_clusters')
    .update(updateFields)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
