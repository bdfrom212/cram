import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchJobs,
  fetchJobEvent,
  fetchJobContacts,
  fetchAddressBook,
  extractTaveId,
  extractPrimarySessionId,
  extractPhone,
  extractInstagram,
  contactDisplayName,
} from '@/lib/vsco/api'

const SKIP_STAGES = new Set(['lead', 'inquiry'])
const INQUIRY_STAGES = new Set(['lead', 'inquiry'])

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.VSCO_API_KEY) {
    return NextResponse.json({ error: 'VSCO_API_KEY not configured' }, { status: 500 })
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') ?? 'booked'

  const supabase = await createClient()

  if (mode === 'inquiries') {
    return handleInquiries(supabase)
  }

  return handleBooked(supabase)
}

async function handleBooked(supabase: Awaited<ReturnType<typeof createClient>>) {
  const summary = { eventsAdded: 0, contactsAdded: 0, linksAdded: 0, errors: 0 }

  // 1. Fetch all non-lead VSCO jobs
  const allJobs: { vscoId: string; taveId: string | null; primarySessionId: string | null; name: string; date: string }[] = []
  let page = 1
  while (true) {
    const resp = await fetchJobs(page)
    if (!resp?.items?.length) break
    for (const job of resp.items) {
      if (SKIP_STAGES.has(job.stage)) continue
      const taveId = extractTaveId(job.links?.self?.managerHref)
      const primarySessionId = extractPrimarySessionId(job)
      allJobs.push({ vscoId: job.id, taveId, primarySessionId, name: job.name, date: job.eventDate })
    }
    if (resp.items.length < 100) break
    page++
    await sleep(200)
  }

  // 2. Diff against DB
  const { data: existingRows } = await supabase
    .from('events')
    .select('tave_job_id')
    .not('tave_job_id', 'is', null)

  const existingIds = new Set((existingRows ?? []).map(r => r.tave_job_id))
  const newJobs = allJobs.filter(j => j.taveId && !existingIds.has(j.taveId))

  if (newJobs.length === 0) {
    return NextResponse.json({ ok: true, message: 'Already up to date', ...summary })
  }

  // 3. Fetch event details + contacts for new jobs
  const contactCache: Record<string, { name: string; email?: string; phone?: string; instagram?: string; company?: string }> = {}

  for (const job of newJobs) {
    try {
      // Venue from event endpoint
      let venueName: string | null = null
      let venueCity: string | null = null
      let venueState: string | null = null
      const evData = job.primarySessionId ? await fetchJobEvent(job.primarySessionId) : null
      if (evData?.location?.address) {
        venueName = evData.location.address.name ?? null
        venueCity = evData.location.address.city ?? null
        venueState = evData.location.address.state ?? null
      }

      // Insert event
      const { data: inserted } = await supabase
        .from('events')
        .insert({ title: job.name, date: job.date, venue_name: venueName, venue_city: venueCity, venue_state: venueState, tave_job_id: job.taveId, import_source: 'vsco' })
        .select('id')
        .single()

      if (!inserted?.id) continue
      summary.eventsAdded++
      const eventId = inserted.id

      // Fetch job contacts
      const jobContacts = await fetchJobContacts(job.vscoId)
      await sleep(150)

      for (const jc of jobContacts) {
        if (!jc.contactId) continue

        // Fetch address-book if not cached
        if (!contactCache[jc.contactId]) {
          const ab = await fetchAddressBook(jc.contactId)
          await sleep(100)
          if (!ab) continue
          contactCache[jc.contactId] = {
            name: contactDisplayName(ab),
            email: ab.email || undefined,
            phone: extractPhone(ab) || undefined,
            instagram: extractInstagram(ab) || undefined,
            company: ab.companyName || undefined,
          }
        }

        const cd = contactCache[jc.contactId]
        if (!cd.name) continue

        // Upsert contact
        const importSource = `vsco:${jc.contactId}`
        const { data: contact } = await supabase
          .from('contacts')
          .upsert({ name: cd.name, email: cd.email ?? null, phone: cd.phone ?? null, instagram: cd.instagram ?? null, company: cd.company ?? null, import_source: importSource },
            { onConflict: 'import_source', ignoreDuplicates: false })
          .select('id')
          .single()

        if (!contact?.id) continue
        summary.contactsAdded++

        // Determine role
        const role = jc.roleKinds.includes('client') ? 'client'
          : jc.roleKinds.includes('planner') ? 'planner'
          : 'vendor'

        // Link contact to event
        const { error: linkErr } = await supabase
          .from('event_contacts')
          .insert({ event_id: eventId, contact_id: contact.id, role })

        if (!linkErr) summary.linksAdded++
      }
    } catch {
      summary.errors++
    }
  }

  return NextResponse.json({ ok: true, newJobsFound: newJobs.length, ...summary })
}

async function fillMissingInquiryContacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  summary: { eventsAdded: number; contactsLinked: number; researchTriggered: number; errors: number }
) {
  // Find inquiry events with no linked contacts (likely rate-limited on first import)
  const { data: orphanedEvents } = await supabase
    .from('events')
    .select('id, vsco_id, title, date')
    .eq('stage', 'inquiry')

  for (const event of orphanedEvents ?? []) {
    // Check if this event already has contacts
    const { data: hasContacts } = await supabase
      .from('event_contacts')
      .select('id', { count: 'exact' })
      .eq('event_id', event.id)
      .limit(1)

    if ((hasContacts?.length ?? 0) > 0) continue // Already has contacts

    let vscoJobId = event.vsco_id

    // If no vsco_id, try to find it by searching VSCO
    if (!vscoJobId && event.title) {
      try {
        const jobs = await fetchJobs(1, 100)
        if (jobs) {
          const match = jobs.items.find(j => j.name === event.title && j.eventDate === event.date)
          if (match) vscoJobId = match.id
        }
      } catch {
        // Ignore errors in searching
      }
    }

    if (!vscoJobId) continue

    try {
      const jobContacts = await fetchJobContacts(vscoJobId)
      await sleep(150)

      for (const jc of jobContacts) {
        if (!jc.contactId) continue

        const ab = await fetchAddressBook(jc.contactId)
        await sleep(100)
        if (!ab) continue

        const importSource = `vsco:${jc.contactId}`
        const { data: contact } = await supabase
          .from('contacts')
          .upsert(
            {
              name: contactDisplayName(ab),
              email: ab.email ?? null,
              phone: extractPhone(ab) ?? null,
              instagram: extractInstagram(ab) ?? null,
              company: ab.companyName ?? null,
              import_source: importSource,
            },
            { onConflict: 'import_source', ignoreDuplicates: false }
          )
          .select('id')
          .single()

        if (!contact?.id) continue

        const role = jc.roleKinds.includes('client')
          ? 'client'
          : jc.roleKinds.includes('planner')
            ? 'planner'
            : 'vendor'

        const { error: linkErr } = await supabase
          .from('event_contacts')
          .insert({ event_id: event.id, contact_id: contact.id, role })

        if (!linkErr) summary.contactsLinked++
      }
    } catch {
      summary.errors++
    }
  }
}

async function handleInquiries(supabase: Awaited<ReturnType<typeof createClient>>) {
  const summary = { eventsAdded: 0, contactsLinked: 0, researchTriggered: 0, errors: 0 }

  // Also try to fill in missing contacts for existing inquiry events
  // (in case rate limiting prevented them from being fetched on first import)
  await fillMissingInquiryContacts(supabase, summary)

  let page = 1
  const inquiryJobs: { vscoId: string; taveId: string | null; primarySessionId: string | null; name: string; date: string }[] = []

  while (true) {
    const resp = await fetchJobs(page)
    if (!resp?.items?.length) break

    for (const job of resp.items) {
      if (!INQUIRY_STAGES.has(job.stage)) continue
      const taveId = extractTaveId(job.links?.self?.managerHref)
      const primarySessionId = extractPrimarySessionId(job)
      inquiryJobs.push({ vscoId: job.id, taveId, primarySessionId, name: job.name, date: job.eventDate })
    }

    if (resp.items.length < 100) break
    page++
    await sleep(200)
  }

  const { data: existingRows } = await supabase
    .from('events')
    .select('tave_job_id')
    .eq('stage', 'inquiry')
    .not('tave_job_id', 'is', null)

  const existingIds = new Set((existingRows ?? []).map(r => r.tave_job_id))
  const newInquiries = inquiryJobs.filter(j => j.taveId && !existingIds.has(j.taveId))

  if (newInquiries.length === 0) {
    const message = summary.contactsLinked > 0 ? `Linked contacts for ${summary.contactsLinked} existing inquiries` : 'No new inquiries'
    return NextResponse.json({ ok: true, message, ...summary })
  }

  const contactCache: Record<string, { name: string; email?: string; phone?: string; instagram?: string; company?: string; role?: string }> = {}

  for (const inquiry of newInquiries) {
    try {
      let venueName: string | null = null
      let venueCity: string | null = null
      let venueState: string | null = null
      const evData = inquiry.primarySessionId ? await fetchJobEvent(inquiry.primarySessionId) : null
      if (evData?.location?.address) {
        venueName = evData.location.address.name ?? null
        venueCity = evData.location.address.city ?? null
        venueState = evData.location.address.state ?? null
      }

      const { data: inserted } = await supabase
        .from('events')
        .insert({
          title: inquiry.name,
          date: inquiry.date,
          venue_name: venueName,
          venue_city: venueCity,
          venue_state: venueState,
          tave_job_id: inquiry.taveId,
          vsco_id: inquiry.vscoId,
          import_source: 'vsco',
          stage: 'inquiry',
        })
        .select('id')
        .single()

      if (!inserted?.id) continue
      summary.eventsAdded++
      const eventId = inserted.id

      const jobContacts = await fetchJobContacts(inquiry.vscoId)
      await sleep(150)

      const plannerContactIds: string[] = []
      const clientContactIds: string[] = []

      for (const jc of jobContacts) {
        if (!jc.contactId) continue

        if (!contactCache[jc.contactId]) {
          const ab = await fetchAddressBook(jc.contactId)
          await sleep(100)
          if (!ab) continue
          contactCache[jc.contactId] = {
            name: contactDisplayName(ab),
            email: ab.email || undefined,
            phone: extractPhone(ab) || undefined,
            instagram: extractInstagram(ab) || undefined,
            company: ab.companyName || undefined,
            role: jc.roleKinds.includes('client')
              ? 'client'
              : jc.roleKinds.includes('planner')
                ? 'planner'
                : 'vendor',
          }
        }

        const cd = contactCache[jc.contactId]
        if (!cd.name) continue

        const importSource = `vsco:${jc.contactId}`
        const { data: contact } = await supabase
          .from('contacts')
          .upsert(
            {
              name: cd.name,
              email: cd.email ?? null,
              phone: cd.phone ?? null,
              instagram: cd.instagram ?? null,
              company: cd.company ?? null,
              import_source: importSource,
            },
            { onConflict: 'import_source', ignoreDuplicates: false }
          )
          .select('id')
          .single()

        if (!contact?.id) continue

        if (cd.role === 'planner') {
          plannerContactIds.push(contact.id)
        } else if (cd.role === 'client') {
          clientContactIds.push(contact.id)
        }

        const { error: linkErr } = await supabase
          .from('event_contacts')
          .insert({ event_id: eventId, contact_id: contact.id, role: cd.role })

        if (linkErr) {
          summary.errors++
        }
      }

      // 4. Check 90-day freshness and trigger research
      const now = new Date()
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

      const { data: planners } = await supabase
        .from('contacts')
        .select('id, last_researched_at')
        .in('id', plannerContactIds)

      const plannerIdsNeedingResearch = (planners ?? [])
        .filter(p => !p.last_researched_at || new Date(p.last_researched_at) < ninetyDaysAgo)
        .map(p => p.id)

      const allContactsNeedingResearch = [...clientContactIds, ...plannerIdsNeedingResearch]

      if (allContactsNeedingResearch.length > 0) {
        try {
          await fetch(new URL('/api/agents/researcher', process.env.NEXT_PUBLIC_SUPABASE_URL).origin + '/api/agents/researcher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId, force: true }),
          })
          summary.researchTriggered++
        } catch {
          summary.errors++
        }
      }
    } catch {
      summary.errors++
    }
  }

  return NextResponse.json({ ok: true, newInquiries: newInquiries.length, ...summary })
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
