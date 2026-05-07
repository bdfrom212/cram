import { createClient } from '@/lib/supabase/server'

export interface Brief {
  id: string
  event_id: string
  agent: string
  content: string
  model: string | null
  created_at: string
  read_at: string | null
}

export async function storeBrief({
  eventId,
  agent,
  content,
  model,
}: {
  eventId: string
  agent: string
  content: string
  model: string
}): Promise<Brief> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('briefs')
    .insert({ event_id: eventId, agent, content, model })
    .select()
    .single()
  if (error) throw new Error(`Failed to store brief: ${error.message}`)
  return data as Brief
}

export async function getLatestBrief(eventId: string, agent = 'concierge'): Promise<Brief | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('briefs')
    .select('*')
    .eq('event_id', eventId)
    .eq('agent', agent)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as Brief | null
}

export async function markBriefRead(briefId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.from('briefs').update({ read_at: new Date().toISOString() }).eq('id', briefId)
}
