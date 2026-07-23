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
        .select('company_context, event:events(id, title, date, venue_name)')
        .eq('contact_id', planner.id)
        .limit(20)
      const past = (links ?? [])
        .map((l: any) => ({ ...l.event, company_context: l.company_context }))
        .filter((e: any) => e.id && e.id !== eventId && e.date <= event.date)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
      // Detect firm transitions: unique companies across history vs current
      const companies = past.map((e: any) => e.company_context).filter(Boolean)
      // @ts-expect-error downlevelIteration issue with Set
      const historicalFirms = Array.from(new Set(companies))
      const firmTransition = historicalFirms.length > 0 && planner.company &&
        !historicalFirms.some((f: string) => f.toLowerCase().includes(planner.company.toLowerCase()) || planner.company.toLowerCase().includes(f.toLowerCase()))
      return { planner, past, historicalFirms, firmTransition }
    })
  )

  // Fetch history for each client, plus family connections via shared last name
  const clientHistories = await Promise.all(
    clients.map(async (client: any) => {
      const { data: links } = await supabase
        .from('event_contacts')
        .select('event:events(id, title, date, venue_name)')
        .eq('contact_id', client.id)
        .limit(20)
      const events = (links ?? []).map((l: any) => l.event).filter(Boolean)
      const past = events.filter((e: any) => e.id !== eventId && e.date <= event.date)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))

      // Family connections — find other contacts sharing the same last name
      const nameParts = (client.name ?? '').trim().split(/\s+/)
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null
      let familyConnections: Array<{ name: string; eventCount: number }> = []

      if (lastName && lastName.length > 2) {
        const { data: familyContacts } = await supabase
          .from('contacts')
          .select('id, name')
          .ilike('name', `%${lastName}%`)
          .neq('id', client.id)
          .limit(20)

        if (familyContacts && familyContacts.length > 0) {
          const familyIds = familyContacts.map((c: any) => c.id)
          const { data: familyLinks } = await supabase
            .from('event_contacts')
            .select('contact_id, event_id')
            .in('contact_id', familyIds)

          const countByContact: Record<string, number> = {}
          for (const link of familyLinks ?? []) {
            countByContact[link.contact_id] = (countByContact[link.contact_id] ?? 0) + 1
          }

          familyConnections = familyContacts
            .filter((c: any) => (countByContact[c.id] ?? 0) > 0)
            .map((c: any) => ({ name: c.name, eventCount: countByContact[c.id] ?? 0 }))
            .sort((a, b) => b.eventCount - a.eventCount)
            .slice(0, 6)
        }
      }

      return { client, past, familyConnections }
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

  for (const { planner, past, historicalFirms, firmTransition } of plannerHistories) {
    lines.push('')
    lines.push(`Name: ${planner.name}${planner.company ? ` (${planner.company})` : ''}`)
    if (firmTransition) {
      lines.push(`Firm note: Previously worked at ${historicalFirms.join(', ')} — now at ${planner.company}. Long relationship, new context.`)
    } else if (historicalFirms.length > 0 && !planner.company) {
      lines.push(`Firm note: Previously at ${historicalFirms.join(', ')} — current firm not on file.`)
    }
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
        const firmNote = ev.company_context ? ` [${ev.company_context}]` : ''
        lines.push(`  - ${fmt(ev.date)}: ${ev.title || 'Untitled'}${ev.venue_name ? ` at ${ev.venue_name}` : ''}${firmNote}`)
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

  if (clientHistories.length) {
    for (const { client, past, familyConnections } of clientHistories) {
      lines.push('')
      lines.push(`Name: ${client.name}${client.company ? ` (${client.company})` : ''}`)
      if (client.last_contact_date) lines.push(`Last contact: ${fmt(client.last_contact_date)}`)

      if (client.personal_notes?.trim()) {
        lines.push(`Notes: ${client.personal_notes.trim()}`)
      }
      if (client.action_items?.trim()) {
        lines.push(`Things to remember: ${client.action_items.trim()}`)
      }

      const notes = (client.notes ?? [])
        .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
        .slice(0, 3)
      if (notes.length) {
        lines.push('Field notes (most recent first):')
        for (const n of notes) {
          lines.push(`  [${fmt(n.created_at)}] ${n.body}`)
        }
      }

      if (past.length) {
        lines.push(`Past sessions together (${past.length}):`)
        for (const ev of past.slice(0, 5)) {
          lines.push(`  - ${fmt(ev.date)}: ${ev.title || 'Untitled'}${ev.venue_name ? ` at ${ev.venue_name}` : ''}`)
        }
      }

      if (familyConnections.length) {
        lines.push('Family / related contacts in system:')
        for (const fc of familyConnections) {
          lines.push(`  - ${fc.name} (${fc.eventCount} event${fc.eventCount === 1 ? '' : 's'} on file)`)
        }
      }
    }
  } else {
    lines.push('No client details on file yet.')
  }

  return lines.join('\n')
}
