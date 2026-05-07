import { createClient } from '@/lib/supabase/server'

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export async function buildConciergeContext(eventId: string): Promise<string> {
  const supabase = await createClient()

  // Main event fetch with all nested contact data
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id, title, date, venue_name, venue_city, venue_state, notes,
      event_contacts(
        role,
        contact:contacts(
          id, name, company, instagram,
          last_contact_date, personal_notes, action_items,
          notes ( id, body, created_at ),
          key_people ( id, name, title, email, notes ),
          email_log ( id, subject, direction, snippet, last_message_at )
        )
      )
    `)
    .eq('id', eventId)
    .single()

  if (error || !event) throw new Error(`Event not found: ${eventId}`)

  const contacts = (event.event_contacts ?? []) as any[]
  const planners = contacts.filter(ec => ['planner', 'coordinator'].includes(ec.role)).map(ec => ec.contact).filter(Boolean)
  const clients  = contacts.filter(ec => ec.role === 'client').map(ec => ec.contact).filter(Boolean)

  // Fetch shared event history for each planner
  const plannerHistories = await Promise.all(
    planners.map(async (planner: any) => {
      const { data: links } = await supabase
        .from('event_contacts')
        .select('event:events(id, title, date, venue_name)')
        .eq('contact_id', planner.id)
        .order('created_at', { ascending: false })
        .limit(10)
      const events = (links ?? []).map((l: any) => l.event).filter(Boolean)
      const past = events.filter((e: any) => e.id !== eventId && e.date <= event.date)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
      return { planner, past }
    })
  )

  // Build the context string Claire will read
  const lines: string[] = []

  lines.push('=== EVENT ===')
  lines.push(`Title: ${event.title || 'Untitled'}`)
  lines.push(`Date: ${fmt(event.date)}`)
  const venue = [event.venue_name, event.venue_city, event.venue_state].filter(Boolean).join(', ')
  if (venue) lines.push(`Venue: ${venue}`)
  if (event.notes) lines.push(`Event notes: ${event.notes}`)

  lines.push('')
  lines.push('=== PLANNERS ===')

  for (const { planner, past } of plannerHistories) {
    lines.push('')
    lines.push(`Name: ${planner.name}${planner.company ? ` (${planner.company})` : ''}`)
    if (planner.instagram) lines.push(`Instagram: ${planner.instagram}`)
    if (planner.last_contact_date) lines.push(`Last contact: ${fmt(planner.last_contact_date)}`)

    if (planner.personal_notes?.trim()) {
      lines.push(`Personal notes: ${planner.personal_notes.trim()}`)
    }
    if (planner.action_items?.trim()) {
      lines.push(`Action items / things to bring up: ${planner.action_items.trim()}`)
    }

    const keyPeople = planner.key_people ?? []
    if (keyPeople.length) {
      lines.push('Key people at their company:')
      for (const kp of keyPeople) {
        const parts = [kp.name, kp.title].filter(Boolean).join(', ')
        lines.push(`  - ${parts}${kp.notes ? ` — ${kp.notes}` : ''}`)
      }
    }

    const notes = (planner.notes ?? [])
      .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
      .slice(0, 4)
    if (notes.length) {
      lines.push('Field notes (most recent first):')
      for (const n of notes) {
        lines.push(`  [${fmt(n.created_at)}] ${n.body}`)
      }
    }

    const emails = (planner.email_log ?? [])
      .sort((a: any, b: any) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
      .slice(0, 3)
    if (emails.length) {
      lines.push('Recent emails:')
      for (const e of emails) {
        const dir = e.direction === 'inbound' ? '←' : '→'
        const date = e.last_message_at ? fmt(e.last_message_at) : ''
        lines.push(`  ${dir} [${date}] ${e.subject}${e.snippet ? ` — "${e.snippet}"` : ''}`)
      }
    }

    if (past.length) {
      lines.push(`Past events together (${past.length}):`)
      for (const ev of past.slice(0, 5)) {
        lines.push(`  - ${fmt(ev.date)}: ${ev.title || 'Untitled'}${ev.venue_name ? ` at ${ev.venue_name}` : ''}`)
      }
    } else {
      lines.push('Past events together: This will be the first time.')
    }
  }

  if (planners.length === 0) {
    lines.push('No planner linked to this event yet.')
  }

  lines.push('')
  lines.push('=== CLIENTS (The Couple / Client) ===')
  if (clients.length) {
    for (const client of clients) {
      lines.push(`Name: ${client.name}`)
      if (client.personal_notes?.trim()) lines.push(`Notes: ${client.personal_notes.trim()}`)
    }
  } else {
    lines.push('No client details on file yet.')
  }

  return lines.join('\n')
}
