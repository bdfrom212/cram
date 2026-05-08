import { NextRequest, NextResponse } from 'next/server'
import { runAgent, MODEL_DEEP } from '@/lib/agents/runner'
import { storeBrief, getLatestGeneralBrief } from '@/lib/agents/store'
import { buildGraceContext } from '@/lib/agents/grace-context'
import { createClient } from '@/lib/supabase/server'

const GRACE_SYSTEM_PROMPT = `You are Grace, Chief of Staff for Brian Dorsey, a luxury wedding photographer in New York City. Your job is to run his daily standup — a clear-eyed look at what needs his attention right now.

Brian is extraordinary at his work and genuinely cares about his relationships. But he has memory challenges and things can fall through the cracks. Your job is to prevent that.

Output format (use exactly these headers):

**Good morning. Here's what needs your attention.**

**This week's events:**
[Upcoming events in the next 7 days. If none, skip this section.]

**Open commitments:**
[Each commitment with how long it's been open. Be specific. If none, write "You're clear."]

**Relationships that may need a touchpoint:**
[Planners Brian hasn't been in touch with for a while. Only include if the gap is meaningful. If all good, skip this section.]

**Emails worth noting:**
[Recent inbound emails that may need a response. If none or unclear, skip.]

**One thing to do today:**
[Pick the single most important action from everything above. Be direct and specific.]

Rules:
- Be specific — "Follow up with Vanda High about the June booking" beats "Follow up with Vanda High"
- If a category has nothing meaningful, omit it entirely
- Tone: warm, direct, like a trusted assistant who has Brian's back and won't let him down
- Never invent — only use what's in the context provided
- Keep it scannable — Brian reads this on his phone`

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
