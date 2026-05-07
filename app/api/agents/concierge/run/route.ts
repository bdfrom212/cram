import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runAgent, MODEL_FAST } from '@/lib/agents/runner'
import { storeBrief, getLatestBrief } from '@/lib/agents/store'
import { buildConciergeContext } from '@/lib/agents/concierge-context'

const CLAIRE_SYSTEM_PROMPT = `You are Claire, a pre-event briefing specialist for a wedding and event photographer named Brian. Your job is to produce a concise, scannable morning brief he can read in under 60 seconds before leaving for a job.

Your output format:
**[Event title] · [Venue] · [Date]**

**The Planner — [Name] ([Company])**
[2-4 sentences: one memorable personal detail, the relationship history in one line, anything actionable]

**The Clients — [Couple name]**
[1-3 sentences: anything Brian should know that changes how he shows up]

**One thing to mention:** [One specific, concrete thing worth bringing up today]

**One thing to watch:** [One thing to be aware of or avoid]

Rules:
- Lead with what changes behavior, not what's comprehensive
- Be specific — "her golden retriever just had puppies" beats "she has a dog"
- If you don't have enough information for a section, omit it gracefully — don't pad
- If there are no field notes or personal details, acknowledge the relationship warmly (first time working together, or long-standing relationship based on event history)
- Never invent details — only use what's in the context provided
- Tone: warm, sharp, like a trusted assistant who knows Brian's business`

// Called by Vercel cron at 7am ET — generates briefs for today's and tomorrow's events
export async function GET(request: NextRequest) {
  // Protect the cron endpoint
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const today    = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0]

  const { data: events } = await supabase
    .from('events')
    .select('id, title, date')
    .in('date', [today, tomorrow])
    .order('date')

  if (!events?.length) return NextResponse.json({ generated: 0, message: 'No events today or tomorrow' })

  const results: { title: string; date: string; status: string }[] = []

  for (const event of events) {
    // Skip if a brief was already generated in the last 12 hours
    const existing = await getLatestBrief(event.id)
    if (existing) {
      const ageMs = Date.now() - new Date(existing.created_at).getTime()
      if (ageMs < 12 * 60 * 60 * 1000) {
        results.push({ title: event.title ?? 'Untitled', date: event.date, status: 'skipped (recent)' })
        continue
      }
    }

    try {
      const context = await buildConciergeContext(event.id)
      const content = await runAgent({ systemPrompt: CLAIRE_SYSTEM_PROMPT, context, model: MODEL_FAST })
      await storeBrief({ eventId: event.id, agent: 'concierge', content, model: MODEL_FAST })
      results.push({ title: event.title ?? 'Untitled', date: event.date, status: 'generated' })
    } catch (err) {
      results.push({ title: event.title ?? 'Untitled', date: event.date, status: `error: ${(err as Error).message}` })
    }
  }

  return NextResponse.json({ generated: results.filter(r => r.status === 'generated').length, results })
}
