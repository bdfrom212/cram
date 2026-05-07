import { NextRequest, NextResponse } from 'next/server'
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

// POST /api/agents/concierge — generate or return cached brief
export async function POST(request: NextRequest) {
  const { eventId, force = false } = await request.json()
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 })

  // Return cached brief if under 24h old, unless force-refreshing
  if (!force) {
    const existing = await getLatestBrief(eventId)
    if (existing) {
      const ageMs = Date.now() - new Date(existing.created_at).getTime()
      if (ageMs < 24 * 60 * 60 * 1000) return NextResponse.json({ brief: existing })
    }
  }

  const context = await buildConciergeContext(eventId)
  const content = await runAgent({ systemPrompt: CLAIRE_SYSTEM_PROMPT, context, model: MODEL_FAST })
  const brief   = await storeBrief({ eventId, agent: 'concierge', content, model: MODEL_FAST })

  return NextResponse.json({ brief })
}

// GET /api/agents/concierge?eventId= — fetch existing brief without generating
export async function GET(request: NextRequest) {
  const eventId = new URL(request.url).searchParams.get('eventId')
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  const brief = await getLatestBrief(eventId)
  return NextResponse.json({ brief })
}
