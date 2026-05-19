import { createClient } from '@/lib/supabase/server'

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function runSql(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.SUPABASE_PROJECT_REF
  if (!token || !ref) return []
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      cache: 'no-store',
    })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
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
    { data: newBookings },
    anniversaries,
    unresearchedContacts,
    { data: pendingInquiries },
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

    supabase
      .from('events')
      .select('id, title, date, venue_name, event_contacts(role, contact:contacts(name))')
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .gte('date', today)
      .order('created_at', { ascending: false })
      .limit(5),

    // Upcoming anniversaries — events from prior years whose anniversary falls in next 14 days
    runSql(`
      WITH anniversary_window AS (
        SELECT
          e.id, e.title, e.date, e.venue_name,
          (e.date + ((EXTRACT(YEAR FROM CURRENT_DATE)::int - EXTRACT(YEAR FROM e.date)::int) * INTERVAL '1 year'))::date AS anniversary_date,
          string_agg(c.name, ' & ' ORDER BY c.name) AS client_names
        FROM events e
        JOIN event_contacts ec ON ec.event_id = e.id AND ec.role = 'client'
        JOIN contacts c ON c.id = ec.contact_id
        WHERE EXTRACT(YEAR FROM e.date) < EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY e.id, e.title, e.date, e.venue_name
      )
      SELECT * FROM anniversary_window
      WHERE anniversary_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
      ORDER BY anniversary_date
      LIMIT 10
    `),

    // Contacts on upcoming events (next 30 days) who haven't been researched
    runSql(`
      SELECT DISTINCT c.id, c.name, ec.role AS event_role,
        e.title AS event_title, e.date AS event_date
      FROM events e
      JOIN event_contacts ec ON ec.event_id = e.id
      JOIN contacts c ON c.id = ec.contact_id
      WHERE e.date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND (c.last_researched_at IS NULL OR c.last_researched_at < CURRENT_DATE - INTERVAL '90 days')
      ORDER BY e.date, ec.role
      LIMIT 12
    `),

    // New inquiries awaiting response
    supabase
      .from('events')
      .select('id, title, date, stage, event_contacts(contact:contacts(name))')
      .eq('stage', 'inquiry')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const lines: string[] = []
  lines.push(`=== TODAY: ${fmt(today)} ===`)
  lines.push('')

  // Pending inquiries
  lines.push('=== NEW INQUIRIES (awaiting research & response) ===')
  if (Array.isArray(pendingInquiries) && pendingInquiries.length) {
    for (const inq of pendingInquiries as any[]) {
      const clients = (inq.event_contacts ?? [])
        .filter((ec: any) => ec.contact)
        .map((ec: any) => ec.contact.name)
        .join(' & ')
      lines.push(`- ${fmt(inq.date)}: ${inq.title || 'Unnamed'} · ${clients}`)
    }
  } else {
    lines.push('No pending inquiries.')
  }

  // Upcoming events
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

  // Open commitments
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

  // Unresearched contacts on upcoming events
  lines.push('')
  lines.push('=== CONTACTS ON UPCOMING EVENTS WITHOUT RECENT RESEARCH ===')
  if (Array.isArray(unresearchedContacts) && unresearchedContacts.length) {
    for (const r of unresearchedContacts as any[]) {
      lines.push(`- ${r.name} (${r.event_role}) · ${r.event_title || 'Untitled'} on ${fmt(r.event_date)}`)
    }
  } else {
    lines.push('All contacts on upcoming events have recent research.')
  }

  // Upcoming anniversaries
  lines.push('')
  lines.push('=== UPCOMING ANNIVERSARIES (next 14 days) ===')
  if (Array.isArray(anniversaries) && anniversaries.length) {
    for (const a of anniversaries as any[]) {
      const yearsAgo = new Date().getFullYear() - new Date(a.date).getFullYear()
      lines.push(`- ${fmt(a.anniversary_date)}: ${a.client_names || a.title || 'Unnamed couple'} · ${yearsAgo}-year anniversary${a.venue_name ? ` at ${a.venue_name}` : ''}`)
    }
  } else {
    lines.push('No anniversaries in the next 14 days.')
  }

  // New bookings this week
  lines.push('')
  lines.push('=== NEW BOOKINGS THIS WEEK ===')
  if (newBookings?.length) {
    for (const ev of newBookings) {
      const contacts = (ev.event_contacts as any[]) ?? []
      const planners = contacts.filter(ec => ['planner', 'coordinator'].includes(ec.role)).map(ec => ec.contact?.name).filter(Boolean)
      lines.push(`- ${fmt(ev.date)}: ${ev.title || 'Untitled'}${planners.length ? ` · via ${planners[0]}` : ''}`)
    }
  } else {
    lines.push('No new bookings this week.')
  }

  // Stale planner relationships
  lines.push('')
  lines.push('=== PLANNERS WHO MAY NEED A TOUCHPOINT (60+ days no contact) ===')
  if (staleContacts?.length) {
    for (const c of staleContacts as any[]) {
      lines.push(`- ${c.name}${c.company ? ` (${c.company})` : ''} — last contact: ${fmt(c.last_contact_date)}`)
    }
  } else {
    lines.push('All key planners have been contacted recently.')
  }

  // Recent inbound emails
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
