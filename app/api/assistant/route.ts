import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ALLOWED_CONTACT_FIELDS, filterContactFields } from '@/lib/contacts/fields'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Simple in-memory sliding window. Resets on server restart, which is fine
// for a single-user app. Keyed by user_id.
const rateLimits = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT = 100
const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkRateLimit(userId: string): {
  allowed: boolean
  retryAfter?: number
  remaining: number
} {
  const now = Date.now()
  const state = rateLimits.get(userId)

  if (!state || now - state.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(userId, { count: 1, windowStart: now })
    return { allowed: true, remaining: RATE_LIMIT - 1 }
  }

  if (state.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: state.windowStart + RATE_WINDOW_MS, remaining: 0 }
  }

  state.count++
  return { allowed: true, remaining: RATE_LIMIT - state.count }
}

// ── Tools ─────────────────────────────────────────────────────────────────────
// execute_merge is intentionally absent — merges require Brian's explicit
// confirmation through the /api/assistant/confirm-merge endpoint.
const GRACE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_contacts',
    description: 'Search for contacts by name, company, or email',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_contact',
    description: 'Get full details of a specific contact including events, notes, and key people',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Contact UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'find_duplicates',
    description: 'Find potential duplicate contacts by name',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name to search for duplicates' },
      },
      required: ['name'],
    },
  },
  {
    name: 'preview_merge',
    description:
      'Prepare a merge preview for two contacts. Does NOT execute the merge — Brian must confirm via the confirmation card that appears in the UI.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id_a: { type: 'string', description: 'First contact UUID (will be kept)' },
        id_b: { type: 'string', description: 'Second contact UUID (will be deleted after confirmation)' },
      },
      required: ['id_a', 'id_b'],
    },
  },
  {
    name: 'update_contact',
    description: `Update allowed fields on a contact. Allowed fields: ${[...ALLOWED_CONTACT_FIELDS].join(', ')}. System fields are silently ignored.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Contact UUID' },
        fields: {
          type: 'object',
          description: 'Fields to update',
          additionalProperties: true,
        },
      },
      required: ['id', 'fields'],
    },
  },
  {
    name: 'add_note',
    description: 'Add a note to a contact',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string', description: 'Contact UUID' },
        body: { type: 'string', description: 'Note text' },
      },
      required: ['contact_id', 'body'],
    },
  },
  {
    name: 'search_events',
    description: 'Search events by couple name, venue, city, or date',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_operations',
    description: 'Get recent operations Brian can review or undo',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'undo_operation',
    description: 'Undo a recent operation by ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string', description: 'Operation UUID from operations_log' },
      },
      required: ['operation_id'],
    },
  },
]

// ── Tool execution ────────────────────────────────────────────────────────────
interface ToolResult {
  result: unknown
  mergePreview?: {
    id_a: string
    id_b: string
    contact_a: Record<string, unknown>
    contact_b: Record<string, unknown>
    merged: Record<string, unknown>
  }
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<ToolResult> {
  if (name === 'search_contacts') {
    const q = input.query as string
    const { data } = await supabase
      .from('contacts')
      .select('id, name, company, role, email')
      .or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10)
    return { result: data ?? [] }
  }

  if (name === 'get_contact') {
    const { data } = await supabase
      .from('contacts')
      .select('*, notes(*), key_people(*), event_contacts(role, events(id, title, date, venue_name))')
      .eq('id', input.id as string)
      .single()
    return { result: data }
  }

  if (name === 'find_duplicates') {
    const { data } = await supabase
      .from('contacts')
      .select('id, name, company, email, created_at')
      .ilike('name', `%${input.name as string}%`)
      .limit(5)
    return { result: data ?? [] }
  }

  if (name === 'preview_merge') {
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', input.id_a as string).single(),
      supabase.from('contacts').select('*').eq('id', input.id_b as string).single(),
    ])
    if (!a || !b) return { result: { error: 'One or both contacts not found' } }

    const fields = ['name', 'company', 'role', 'email', 'phone', 'website', 'instagram', 'personal_notes']
    const merged: Record<string, unknown> = {}
    fields.forEach(f => { merged[f] = (a[f] || b[f]) ?? null })

    const mergePreview = { id_a: a.id, id_b: b.id, contact_a: a, contact_b: b, merged }
    return {
      result: { message: 'Merge preview ready — confirmation card shown to Brian', id_a: a.id, id_b: b.id },
      mergePreview,
    }
  }

  if (name === 'update_contact') {
    const safeFields = filterContactFields(input.fields as Record<string, unknown>)
    if (Object.keys(safeFields).length === 0) {
      return { result: { error: 'No writable fields in the request' } }
    }
    const { data: before } = await supabase.from('contacts').select('*').eq('id', input.id as string).single()
    const { data: after } = await supabase
      .from('contacts').update(safeFields).eq('id', input.id as string).select().single()
    await supabase.from('operations_log').insert({
      user_id: userId, agent: 'grace', operation_type: 'update',
      entity_type: 'contact', entity_id: input.id,
      before_state: before, after_state: after,
    })
    return { result: after }
  }

  if (name === 'add_note') {
    const { data } = await supabase
      .from('notes')
      .insert({ contact_id: input.contact_id as string, body: input.body as string })
      .select().single()
    await supabase.from('operations_log').insert({
      user_id: userId, agent: 'grace', operation_type: 'add_note',
      entity_type: 'contact', entity_id: input.contact_id,
      before_state: null, after_state: { note: input.body },
    })
    return { result: data }
  }

  if (name === 'search_events') {
    const q = input.query as string
    const { data } = await supabase
      .from('events')
      .select('id, title, date, venue_name, venue_city')
      .or(`title.ilike.%${q}%,venue_name.ilike.%${q}%,venue_city.ilike.%${q}%`)
      .order('date', { ascending: true })
      .limit(10)
    return { result: data ?? [] }
  }

  if (name === 'get_recent_operations') {
    const { data } = await supabase
      .from('operations_log')
      .select('id, agent, operation_type, entity_type, created_at, undone_at')
      .eq('user_id', userId)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(10)
    return { result: data ?? [] }
  }

  if (name === 'undo_operation') {
    const { data: op } = await supabase
      .from('operations_log').select('*')
      .eq('id', input.operation_id as string).eq('user_id', userId).single()
    if (!op) return { result: { error: 'Operation not found or already undone' } }

    if (op.operation_type === 'update' && op.before_state) {
      const safeRestore = filterContactFields(op.before_state)
      await supabase.from('contacts').update(safeRestore).eq('id', op.entity_id)
      await supabase.from('operations_log')
        .update({ undone_at: new Date().toISOString() }).eq('id', input.operation_id as string)
      return { result: { ok: true } }
    }
    // Merge undos are handled by /api/assistant/undo
    return { result: { error: 'Use the Undo button for merge operations' } }
  }

  return { result: { error: `Unknown tool: ${name}` } }
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  const personaPath = join(process.cwd(), 'agents/personas/chief-of-staff.md')
  const persona = readFileSync(personaPath, 'utf-8')
  const studio = process.env.STUDIO_NAME || 'Brian Dorsey Studios'
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return `${persona.replace(/\{\{studio_name\}\}/g, studio)}

---
Today is ${today}. Studio: ${studio}.

You have tools to search contacts and events, update contact fields, add notes, and prepare merge previews.

CRITICAL: You can ONLY preview merges — you cannot execute them. When Brian asks to merge contacts, call preview_merge. A confirmation card will appear in his UI. After he confirms, he'll see a success message. Do NOT say the merge is done until after confirmation.

For update_contact, only these fields are writable: ${[...ALLOWED_CONTACT_FIELDS].join(', ')}. Any other fields are silently ignored.

Be direct, warm, and specific. Use Brian's first name. After any action confirm what was done in plain English.`
}

// ── POST handler ──────────────────────────────────────────────────────────────
interface RequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  session_id?: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit check
  const rateCheck = checkRateLimit(user.id)
  if (!rateCheck.allowed) {
    const retryTime = new Date(rateCheck.retryAfter!).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    })
    return NextResponse.json({
      error: 'rate_limited',
      retry_after: rateCheck.retryAfter,
      message: `You've reached the hourly request limit. Grace will be available again at ${retryTime}.`,
    }, { status: 429 })
  }

  const body: RequestBody = await request.json()

  // Create or reuse session
  let sessionId = body.session_id
  if (!sessionId) {
    const { data: session } = await supabase
      .from('chat_sessions').insert({ user_id: user.id }).select().single()
    sessionId = session?.id ?? null
  }

  // Save user message
  const lastMsg = body.messages.at(-1)
  if (lastMsg?.role === 'user' && sessionId) {
    await supabase.from('chat_messages').insert({
      session_id: sessionId, role: 'user', content: lastMsg.content,
    })
  }

  const encoder = new TextEncoder()
  const emit = (event: object) => encoder.encode(JSON.stringify(event) + '\n')

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let apiMessages: Anthropic.MessageParam[] = body.messages.map(m => ({
          role: m.role,
          content: m.content,
        }))

        let fullResponse = ''
        const MAX_TURNS = 6

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: buildSystemPrompt(),
            tools: GRACE_TOOLS,
            messages: apiMessages,
          })

          const toolUses: Anthropic.ToolUseBlock[] = []

          for (const block of response.content) {
            if (block.type === 'text') {
              fullResponse += block.text
              controller.enqueue(emit({ t: 'tx', v: block.text }))
            } else if (block.type === 'tool_use') {
              toolUses.push(block)
            }
          }

          // No tools called or natural end — we're done
          if (toolUses.length === 0 || response.stop_reason === 'end_turn') break

          // Execute tools and collect results
          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const toolUse of toolUses) {
            const { result, mergePreview } = await executeTool(
              toolUse.name,
              toolUse.input as Record<string, unknown>,
              supabase,
              user.id
            )
            if (mergePreview) {
              controller.enqueue(emit({ t: 'mp', v: mergePreview }))
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            })
          }

          // Feed results back for next turn
          apiMessages = [
            ...apiMessages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: toolResults },
          ]
        }

        // Persist the conversation
        if (sessionId && fullResponse) {
          await supabase.from('chat_messages').insert({
            session_id: sessionId, role: 'assistant', content: fullResponse,
          })
          await supabase.from('chat_sessions')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', sessionId)
        }

        controller.enqueue(emit({ t: 'done', session_id: sessionId }))
        controller.close()
      } catch (err) {
        controller.enqueue(emit({ t: 'err', v: String(err) }))
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}
