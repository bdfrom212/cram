import { NextResponse } from 'next/server'

export async function GET() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.SUPABASE_PROJECT_REF

  if (!token || !ref) {
    return NextResponse.json({ anniversaries: [] })
  }

  const sql = `
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
    LIMIT 15
  `

  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      cache: 'no-store',
    })

    if (!res.ok) return NextResponse.json({ anniversaries: [] })
    const data = await res.json()
    return NextResponse.json({ anniversaries: Array.isArray(data) ? data : [] })
  } catch {
    return NextResponse.json({ anniversaries: [] })
  }
}
