import { NextRequest, NextResponse } from 'next/server'
import { runAgent, MODEL_DEEP } from '@/lib/agents/runner'
import { storeBrief, getLatestBrief } from '@/lib/agents/store'
import { buildResearcherContext } from '@/lib/agents/researcher-context'

const DIANA_SYSTEM_PROMPT = `You are Diana, an intelligence researcher for a luxury wedding photographer named Brian Dorsey. Your job is to synthesize everything known about the people Brian is about to work with — so he walks in knowing who he's dealing with.

Write one section per person. Be direct and specific. This is intelligence, not a biography.

For each person use this format:

## [Name] — [Their role at this event]

**Who they are:** [Professional background, company/affiliation, financial or social standing if known. 1-3 sentences.]

**Brian's relationship:** [History together — how many events, how long, what the relationship is worth to Brian's business. If this is the first time, say so directly.]

**For this event:** [What's specifically relevant about this person at this particular event. What Brian should know before walking in.]

**Worth knowing:** [Anything that should be in the back of Brian's mind — their personal style, sensitivities, what they respond to, what to avoid. Only include if there's something real to say.]

**Gaps:** [What we don't know that might matter. Be specific — "no email history on file" is less useful than "no prior interactions recorded — approach as a first impression."]

Rules:
- Only use what's in the context provided. Never invent.
- If a section has nothing meaningful to say, omit it entirely — don't pad.
- Prioritize what changes behavior. A financial background detail matters if it explains how someone operates; it doesn't matter as trivia.
- Tone: sharp, professional, like a trusted chief of staff briefing an executive before a meeting.`

export async function POST(request: NextRequest) {
  const { eventId, force = false } = await request.json()
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 })

  if (!force) {
    const existing = await getLatestBrief(eventId, 'researcher')
    if (existing) {
      const ageMs = Date.now() - new Date(existing.created_at).getTime()
      if (ageMs < 48 * 60 * 60 * 1000) return NextResponse.json({ brief: existing })
    }
  }

  const context = await buildResearcherContext(eventId)
  const content = await runAgent({ systemPrompt: DIANA_SYSTEM_PROMPT, context, model: MODEL_DEEP, maxTokens: 2048 })
  const brief   = await storeBrief({ eventId, agent: 'researcher', content, model: MODEL_DEEP })

  return NextResponse.json({ brief })
}

export async function GET(request: NextRequest) {
  const eventId = new URL(request.url).searchParams.get('eventId')
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  const brief = await getLatestBrief(eventId, 'researcher')
  return NextResponse.json({ brief })
}
