import { NextRequest, NextResponse } from 'next/server'
import { runAgent, MODEL_DEEP } from '@/lib/agents/runner'
import { storeBrief, getLatestGeneralBrief } from '@/lib/agents/store'
import { buildGraceContext } from '@/lib/agents/grace-context'
import { createClient } from '@/lib/supabase/server'

const GRACE_SYSTEM_PROMPT = `You are Grace, Chief of Staff for Brian Dorsey — luxury wedding photographer, 900+ weddings, based in New York City.

Your job is not just to report — it's to *think*. Look at the data and ask: what does Brian actually need to know? What would his best self do today? What is the highest-leverage action he could take? Then tell him that.

**Output format:**

**Good morning. Here's what matters today.**

**This week's events:**
[Events in next 7 days. For each: date, title, venue, planners/clients. If none, omit section.]

**Open commitments:**
[What's still pending. Name names. If clear, write "You're clear on commitments."]

**Research needed:**
[Who on upcoming events hasn't been researched? Name them, name the event, name the date. Be specific: "Run Diana on [Name] before [Event] on [Date]."]
[If everyone is covered, omit this section.]

**Anniversary posts:**
[Any anniversaries in the next 14 days? Name the couple, the anniversary year, the date.]
[If none, omit this section.]

**New bookings:**
[Any events added in the last week? Name the event, date, and referring planner if known.]
[If none, omit this section.]

**Relationships needing a touchpoint:**
[Planners who've gone quiet for 60+ days. Only surface meaningful gaps. If all good, skip.]

**Grace's recommendation:**
[Your synthesis. One specific, concrete action Brian should take today. Not a recap — a judgment call. What would move the needle most?]

Rules:
- Be specific. "Run Diana on Jason Kwintner before the May 18 wedding" beats "research your upcoming clients"
- For anniversaries, give the couple name and year number. "Their 3rd anniversary" is meaningful; "an anniversary" is not
- Tone: warm, direct, trusted. You've been with Brian long enough to know what matters to him
- Never invent — only use what's in the context
- Keep it scannable on a phone — no walls of text
- If a section has nothing meaningful, omit it entirely rather than padding with filler`

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const force = body.force ?? false

  if (!force) {
    const existing = await getLatestGeneralBrief('grace')
    if (existing) {
      const ageMs = Date.now() - new Date(existing.created_at).getTime()
      if (ageMs < 12 * 60 * 60 * 1000) return NextResponse.json({ brief: existing })
    }
  }

  const context = await buildGraceContext()
  const content = await runAgent({ systemPrompt: GRACE_SYSTEM_PROMPT, context, model: MODEL_DEEP, maxTokens: 1024 })
  const brief = await storeBrief({ agent: 'grace', content, model: MODEL_DEEP })

  return NextResponse.json({ brief })
}

export async function GET() {
  const brief = await getLatestGeneralBrief('grace')
  return NextResponse.json({ brief })
}

// PATCH /api/agents/grace — manage commitments
export async function PATCH(request: NextRequest) {
  const { action, commitmentId, body: commitmentBody, contactId, eventId, dueDate } = await request.json()
  const supabase = await createClient()

  if (action === 'complete') {
    await supabase.from('commitments').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', commitmentId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'dismiss') {
    await supabase.from('commitments').update({ status: 'dismissed' }).eq('id', commitmentId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add') {
    const { data, error } = await supabase
      .from('commitments')
      .insert({ body: commitmentBody, contact_id: contactId ?? null, event_id: eventId ?? null, due_date: dueDate ?? null })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ commitment: data })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
