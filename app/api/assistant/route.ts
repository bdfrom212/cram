import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface RequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  session_id?: string
}

function getGracePersona(): string {
  const personaPath = join(process.cwd(), 'agents/personas/chief-of-staff.md')
  const content = readFileSync(personaPath, 'utf-8')
  const studioName = process.env.STUDIO_NAME || 'Brian Dorsey Studios'
  return content.replace(/\{\{studio_name\}\}/g, studioName)
}

async function searchContacts(query: string, supabase: any) {
  const { data } = await supabase
    .from('contacts')
    .select('id, name, company, role, email')
    .or(`name.ilike.%${query}%,company.ilike.%${query}%,email.ilike.%${query}%`)
    .limit(10)
  return data || []
}

async function getContact(id: string, supabase: any) {
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single()
  return data
}

async function findDuplicates(name: string, supabase: any) {
  const { data } = await supabase
    .from('contacts')
    .select('id, name, company, email, created_at')
    .ilike('name', `%${name}%`)
    .limit(5)
  return data || []
}

async function previewMerge(
  idA: string,
  idB: string,
  supabase: any
) {
  const a = await getContact(idA, supabase)
  const b = await getContact(idB, supabase)

  if (!a || !b) {
    return { error: 'One or both contacts not found' }
  }

  const fields = ['name', 'company', 'role', 'email', 'phone', 'website', 'instagram', 'personal_notes']
  const preview: any = { id_a: a.id, id_b: b.id, merged: {} }

  fields.forEach(field => {
    preview.merged[field] = a[field] || b[field]
  })

  return {
    contact_a: Object.fromEntries(fields.map(f => [f, a[f]])),
    contact_b: Object.fromEntries(fields.map(f => [f, b[f]])),
    merged: preview.merged,
  }
}

async function executeMerge(
  idKeep: string,
  idDelete: string,
  fieldOverrides: Record<string, any>,
  supabase: any,
  userId: string
) {
  const before = await getContact(idDelete, supabase)

  // Update the keeper with field overrides
  if (Object.keys(fieldOverrides).length > 0) {
    await supabase.from('contacts').update(fieldOverrides).eq('id', idKeep)
  }

  // Log the operation
  const operationId = crypto.randomUUID()
  await supabase.from('operations_log').insert({
    id: operationId,
    user_id: userId,
    agent: 'grace',
    operation_type: 'merge',
    entity_type: 'contact',
    entity_id: idDelete,
    before_state: before,
    after_state: null, // deleted
  })

  // Move related records and delete duplicate (same logic as merge endpoint)
  const { data: dupLinks } = await supabase
    .from('event_contacts')
    .select('event_id, role, company_context')
    .eq('contact_id', idDelete)

  if (dupLinks && dupLinks.length > 0) {
    const { data: keepLinks } = await supabase
      .from('event_contacts')
      .select('event_id')
      .eq('contact_id', idKeep)

    const keepEventIds = new Set((keepLinks ?? []).map((l: any) => l.event_id))
    const toInsert = dupLinks
      .filter((l: any) => !keepEventIds.has(l.event_id))
      .map((l: any) => ({
        event_id: l.event_id,
        contact_id: idKeep,
        role: l.role,
        company_context: l.company_context,
      }))

    if (toInsert.length > 0) {
      await supabase.from('event_contacts').insert(toInsert)
    }
  }

  await supabase.from('notes').update({ contact_id: idKeep }).eq('contact_id', idDelete)
  await supabase.from('key_people').update({ contact_id: idKeep }).eq('contact_id', idDelete)
  await supabase.from('event_contacts').delete().eq('contact_id', idDelete)
  await supabase.from('contacts').delete().eq('id', idDelete)

  return { ok: true, undo_token: operationId, undo_expires_at: new Date(Date.now() + 60000).toISOString() }
}

async function updateContact(id: string, fields: Record<string, any>, supabase: any, userId: string) {
  const before = await getContact(id, supabase)
  const { data: after } = await supabase
    .from('contacts')
    .update(fields)
    .eq('id', id)
    .select()
    .single()

  await supabase.from('operations_log').insert({
    id: crypto.randomUUID(),
    user_id: userId,
    agent: 'grace',
    operation_type: 'update',
    entity_type: 'contact',
    entity_id: id,
    before_state: before,
    after_state: after,
  })

  return after
}

async function getRecentOperations(supabase: any, userId: string) {
  const { data } = await supabase
    .from('operations_log')
    .select('*')
    .eq('user_id', userId)
    .is('undone_at', null)
    .order('created_at', { ascending: false })
    .limit(10)
  return data || []
}

async function undoOperation(operationId: string, supabase: any, userId: string) {
  const { data: op } = await supabase
    .from('operations_log')
    .select('*')
    .eq('id', operationId)
    .eq('user_id', userId)
    .single()

  if (!op) {
    return { error: 'Operation not found or already undone' }
  }

  if (op.operation_type === 'merge' && op.before_state) {
    // Re-create the deleted contact
    const restored = await supabase
      .from('contacts')
      .insert(op.before_state)
      .select()
      .single()

    await supabase.from('operations_log').update({ undone_at: new Date() }).eq('id', operationId)

    return { ok: true, restored_contact: restored }
  } else if (op.operation_type === 'update' && op.before_state) {
    await supabase
      .from('contacts')
      .update(op.before_state)
      .eq('id', op.entity_id)

    await supabase.from('operations_log').update({ undone_at: new Date() }).eq('id', operationId)

    return { ok: true }
  }

  return { error: 'Cannot undo this operation' }
}

const tools: Anthropic.Tool[] = [
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
    description: 'Get full details of a specific contact',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Contact ID (UUID)' },
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
        name: { type: 'string', description: 'Contact name to search for' },
      },
      required: ['name'],
    },
  },
  {
    name: 'preview_merge',
    description: 'Preview what a merge would look like between two contacts',
    input_schema: {
      type: 'object' as const,
      properties: {
        id_a: { type: 'string', description: 'First contact ID' },
        id_b: { type: 'string', description: 'Second contact ID' },
      },
      required: ['id_a', 'id_b'],
    },
  },
  {
    name: 'execute_merge',
    description: 'Merge two contacts, keeping the first and deleting the second',
    input_schema: {
      type: 'object' as const,
      properties: {
        id_keep: { type: 'string', description: 'Contact ID to keep' },
        id_delete: { type: 'string', description: 'Contact ID to delete' },
        field_overrides: {
          type: 'object',
          description: 'Optional field overrides for the kept contact',
          additionalProperties: true,
        },
      },
      required: ['id_keep', 'id_delete'],
    },
  },
  {
    name: 'update_contact',
    description: 'Update a contact record',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Contact ID' },
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
    name: 'get_recent_operations',
    description: 'Get recent operations for undo capability',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'undo_operation',
    description: 'Undo a recent operation',
    input_schema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string', description: 'Operation ID to undo' },
      },
      required: ['operation_id'],
    },
  },
]

export async function POST(request: NextRequest) {
  const body: RequestBody = await request.json()
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let sessionId = body.session_id
  if (!sessionId) {
    const { data: session } = await supabase
      .from('chat_sessions')
      .insert({ user_id: user.id })
      .select()
      .single()
    sessionId = session.id
  }

  // Save user message
  if (body.messages.length > 0) {
    const lastMessage = body.messages[body.messages.length - 1]
    if (lastMessage.role === 'user') {
      await supabase.from('chat_messages').insert({
        session_id: sessionId,
        role: 'user',
        content: lastMessage.content,
      })
    }
  }

  // Build messages for Anthropic API
  const conversationMessages = body.messages.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }))

  // Create streaming response
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullResponse = ''
        const toolResults: any[] = []

        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: getGracePersona(),
          tools,
          messages: conversationMessages,
        })

        // Process response content blocks
        for (const block of response.content) {
          if (block.type === 'text') {
            fullResponse += block.text
            controller.enqueue(encoder.encode(block.text))
          } else if (block.type === 'tool_use') {
            fullResponse += `\n[Executing: ${block.name}]\n`

            // Execute tool
            let toolResult = ''
            try {
              if (block.name === 'search_contacts') {
                const result = await searchContacts(
                  (block.input as any).query,
                  supabase
                )
                toolResult = JSON.stringify(result)
              } else if (block.name === 'get_contact') {
                const result = await getContact((block.input as any).id, supabase)
                toolResult = JSON.stringify(result)
              } else if (block.name === 'find_duplicates') {
                const result = await findDuplicates(
                  (block.input as any).name,
                  supabase
                )
                toolResult = JSON.stringify(result)
              } else if (block.name === 'preview_merge') {
                const result = await previewMerge(
                  (block.input as any).id_a,
                  (block.input as any).id_b,
                  supabase
                )
                toolResult = JSON.stringify(result)
                fullResponse += '[preview_merge]'
              } else if (block.name === 'execute_merge') {
                const result = await executeMerge(
                  (block.input as any).id_keep,
                  (block.input as any).id_delete,
                  (block.input as any).field_overrides || {},
                  supabase,
                  user.id
                )
                toolResult = JSON.stringify(result)
                if (result.undo_token) {
                  fullResponse += `[undo_token:${result.undo_token}]`
                }
              } else if (block.name === 'update_contact') {
                const result = await updateContact(
                  (block.input as any).id,
                  (block.input as any).fields,
                  supabase,
                  user.id
                )
                toolResult = JSON.stringify(result)
              } else if (block.name === 'get_recent_operations') {
                const result = await getRecentOperations(supabase, user.id)
                toolResult = JSON.stringify(result)
              } else if (block.name === 'undo_operation') {
                const result = await undoOperation(
                  (block.input as any).operation_id,
                  supabase,
                  user.id
                )
                toolResult = JSON.stringify(result)
              }
            } catch (err) {
              toolResult = JSON.stringify({ error: String(err) })
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolResult,
            })
          }
        }

        // Save assistant message after processing
        await supabase.from('chat_messages').insert({
          session_id: sessionId,
          role: 'assistant',
          content: fullResponse,
        })

        // Update session's last_message_at
        await supabase
          .from('chat_sessions')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', sessionId)

        controller.close()
      } catch (error) {
        console.error('Stream error:', error)
        controller.error(error)
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  })
}
