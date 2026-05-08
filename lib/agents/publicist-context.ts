import { createClient } from '@/lib/supabase/server'

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export async function buildPublicistContext(eventId: string): Promise<string> {
  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id, title, date, venue_name, venue_city, venue_state, notes, tags,
      event_contacts(
        role,
        contact:contacts(id, name, company, instagram, personal_notes)
      )
    `)
    .eq('id', eventId)
    .single()

  if (error || !event) throw new Error(`Event not found: ${eventId}`)

  const contacts = (event.event_contacts ?? []) as any[]
  const planners = contacts.filter(ec => ['planner', 'coordinator'].includes(ec.role)).map(ec => ec.contact).filter(Boolean)
  const clients = contacts.filter(ec => ec.role === 'client').map(ec => ec.contact).filter(Boolean)
  const vendors = contacts.filter(ec => !['planner', 'coordinator', 'client'].includes(ec.role)).map(ec => ({ ...ec.contact, role: ec.role })).filter(Boolean)

  const lines: string[] = []

  lines.push('=== THE WEDDING ===')
  lines.push(`Title: ${event.title || 'Untitled'}`)
  lines.push(`Date: ${fmt(event.date)}`)
  const venue = [event.venue_name, event.venue_city, event.venue_state].filter(Boolean).join(', ')
  if (venue) lines.push(`Venue: ${venue}`)
  if ((event.tags as string[] | null)?.length) lines.push(`Tags: ${(event.tags as string[]).join(', ')}`)
  if (event.notes) lines.push(`Notes: ${event.notes}`)

  if (planners.length) {
    lines.push('')
    lines.push('=== PLANNERS ===')
    for (const p of planners) {
      lines.push(`- ${p.name}${p.company ? ` (${p.company})` : ''}${p.instagram ? ` | IG: ${p.instagram}` : ''}`)
      if (p.personal_notes) lines.push(`  Context: ${p.personal_notes}`)
    }
  }

  if (clients.length) {
    lines.push('')
    lines.push('=== COUPLE / CLIENTS ===')
    for (const c of clients) {
      lines.push(`- ${c.name}${c.personal_notes ? ` — ${c.personal_notes}` : ''}`)
    }
  }

  if (vendors.length) {
    lines.push('')
    lines.push('=== OTHER VENDORS ===')
    for (const v of vendors) {
      lines.push(`- ${v.name}${v.company ? ` (${v.company})` : ''} [${v.role}]${v.instagram ? ` | IG: ${v.instagram}` : ''}`)
    }
  }

  return lines.join('\n')
}
