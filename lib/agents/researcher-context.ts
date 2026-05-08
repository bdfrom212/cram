import { createClient } from '@/lib/supabase/server'

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export async function buildResearcherContext(eventId: string): Promise<string> {
  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from('events')
    .select(`
      id, title, date, venue_name, venue_city, venue_state, notes,
      event_contacts(
        role,
        contact:contacts(
          id, name, company, role, instagram, website,
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

  // Full event history for each contact
  const contactsWithHistory = await Promise.all(
    contacts.map(async (ec) => {
      const contact = ec.contact
      if (!contact) return ec

      const { data: links } = await supabase
        .from('event_contacts')
        .select('role, event:events(id, title, date, venue_name)')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })

      const allEvents = (links ?? []).map((l: any) => l.event).filter(Boolean)
      const pastEvents = allEvents
        .filter((e: any) => e.id !== eventId && e.date < event.date)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
      const futureEvents = allEvents
        .filter((e: any) => e.id !== eventId && e.date >= event.date)
        .sort((a: any, b: any) => a.date.localeCompare(b.date))

      return { ...ec, pastEvents, futureEvents }
    })
  )

  const lines: string[] = []

  lines.push('=== EVENT CONTEXT ===')
  lines.push(`Title: ${event.title || 'Untitled'}`)
  lines.push(`Date: ${fmt(event.date)}`)
  const venue = [event.venue_name, event.venue_city, event.venue_state].filter(Boolean).join(', ')
  if (venue) lines.push(`Venue: ${venue}`)
  if (event.notes) lines.push(`Event notes: ${event.notes}`)

  lines.push('')
  lines.push('=== PEOPLE TO PROFILE ===')

  for (const ec of contactsWithHistory) {
    const contact = ec.contact
    if (!contact) continue

    lines.push('')
    lines.push(`--- ${contact.name} (${ec.role}) ---`)

    if (contact.company) lines.push(`Company: ${contact.company}`)
    if (contact.instagram) lines.push(`Instagram: ${contact.instagram}`)
    if (contact.website) lines.push(`Website: ${contact.website}`)
    if (contact.last_contact_date) lines.push(`Last contact: ${fmt(contact.last_contact_date)}`)

    if (contact.personal_notes?.trim()) {
      lines.push(`Known intel: ${contact.personal_notes.trim()}`)
    }

    if (contact.action_items?.trim()) {
      lines.push(`Open action items: ${contact.action_items.trim()}`)
    }

    const keyPeople = contact.key_people ?? []
    if (keyPeople.length) {
      lines.push('Key people at their company:')
      for (const kp of keyPeople) {
        const parts = [kp.name, kp.title].filter(Boolean).join(', ')
        lines.push(`  - ${parts}${kp.notes ? ` — ${kp.notes}` : ''}`)
      }
    }

    const notes = (contact.notes ?? [])
      .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
    if (notes.length) {
      lines.push(`Field notes (${notes.length} total, most recent first):`)
      for (const n of notes) {
        lines.push(`  [${fmt(n.created_at)}] ${n.body}`)
      }
    }

    const emails = (contact.email_log ?? [])
      .sort((a: any, b: any) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
    if (emails.length) {
      lines.push(`Email history (${emails.length} threads):`)
      for (const e of emails) {
        const dir = e.direction === 'inbound' ? '←' : '→'
        const date = e.last_message_at ? fmt(e.last_message_at) : ''
        lines.push(`  ${dir} [${date}] ${e.subject}${e.snippet ? ` — "${e.snippet}"` : ''}`)
      }
    }

    if (ec.pastEvents?.length) {
      lines.push(`Past events together (${ec.pastEvents.length}):`)
      for (const ev of ec.pastEvents) {
        lines.push(`  - ${fmt(ev.date)}: ${ev.title || 'Untitled'}${ev.venue_name ? ` at ${ev.venue_name}` : ''}`)
      }
    } else {
      lines.push('Past events together: None on record — this is the first.')
    }

    if (ec.futureEvents?.length) {
      lines.push(`Upcoming events together (${ec.futureEvents.length}):`)
      for (const ev of ec.futureEvents) {
        lines.push(`  - ${fmt(ev.date)}: ${ev.title || 'Untitled'}${ev.venue_name ? ` at ${ev.venue_name}` : ''}`)
      }
    }
  }

  return lines.join('\n')
}
