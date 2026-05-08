import { createClient } from '@/lib/supabase/server'

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export async function buildGraceContext(): Promise<string> {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]
  const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const ago60Days = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]

  const [
    { data: commitments },
    { data: upcomingEvents },
    { data: staleContacts },
    { data: recentInbound },
  ] = await Promise.all([
    supabase
      .from('commitments')
      .select('id, body, source, due_date, created_at, contact:contacts(name), event:events(title, date)')
      .eq('status', 'open')
      .order('created_at', { ascending: true }),

    supabase
      .from('events')
      .select('id, title, date, venue_name, event_contacts(role, contact:contacts(name))')
      .gte('date', today)
      .lte('date', in14Days)
      .order('date', { ascending: true }),

    supabase
      .from('contacts')
      .select('id, name, company, role, last_contact_date')
      .in('role', ['planner', 'coordinator'])
      .not('last_contact_date', 'is', null)
      .lte('last_contact_date', ago60Days)
      .order('last_contact_date', { ascending: true })
      .limit(8),

    supabase
      .from('email_log')
      .select('id, subject, snippet, last_message_at, contact:contacts(name)')
      .eq('direction', 'inbound')
      .gte('last_message_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('last_message_at', { ascending: false })
      .limit(5),
  ])

  const lines: string[] = []
  lines.push(`=== TODAY: ${fmt(today)} ===`)
  lines.push('')

  lines.push('=== UPCOMING EVENTS (next 14 days) ===')
  if (upcomingEvents?.length) {
    for (const ev of upcomingEvents) {
      const contacts = (ev.event_contacts as any[]) ?? []
      const planners = contacts.filter(ec => ['planner', 'coordinator'].includes(ec.role)).map(ec => ec.contact?.name).filter(Boolean)
      const clients = contacts.filter(ec => ec.role === 'client').map(ec => ec.contact?.name).filter(Boolean)
      lines.push(`- ${fmt(ev.date)}: ${ev.title || 'Untitled'}${ev.venue_name ? ` at ${ev.venue_name}` : ''}`)
      if (planners.length) lines.push(`  Planner(s): ${planners.join(', ')}`)
      if (clients.length) lines.push(`  Clients: ${clients.join(', ')}`)
    }
  } else {
    lines.push('No events in the next 14 days.')
  }

  lines.push('')
  lines.push('=== OPEN COMMITMENTS ===')
  if (commitments?.length) {
    for (const c of commitments as any[]) {
      const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
      const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`
      const who = c.contact?.name ? ` re: ${c.contact.name}` : c.event?.title ? ` re: ${c.event.title}` : ''
      const due = c.due_date ? ` (due ${fmt(c.due_date)})` : ''
      lines.push(`- [${ageStr}]${who}${due}: ${c.body}`)
    }
  } else {
    lines.push('No open commitments.')
  }

  lines.push('')
  lines.push('=== PLANNERS WHO MAY NEED A TOUCHPOINT (60+ days no contact) ===')
  if (staleContacts?.length) {
    for (const c of staleContacts as any[]) {
      lines.push(`- ${c.name}${c.company ? ` (${c.company})` : ''} — last contact: ${fmt(c.last_contact_date)}`)
    }
  } else {
    lines.push('All key planners have been contacted recently.')
  }

  lines.push('')
  lines.push('=== RECENT INBOUND EMAILS (last 7 days) ===')
  if (recentInbound?.length) {
    for (const e of recentInbound as any[]) {
      const from = e.contact?.name ?? 'Unknown'
      const date = fmt(e.last_message_at)
      lines.push(`- From ${from} [${date}]: "${e.subject}"${e.snippet ? ` — ${e.snippet}` : ''}`)
    }
  } else {
    lines.push('No recent inbound emails on record.')
  }

  return lines.join('\n')
}
