import Anthropic from '@anthropic-ai/sdk'

const MODEL_FAST = 'claude-haiku-4-5-20251001'   // Claire, Scout, Archivist
const MODEL_DEEP = 'claude-sonnet-4-6'            // Researcher, Strategist

export { MODEL_FAST, MODEL_DEEP }

let _client: Anthropic | null = null
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

export interface AgentRunOptions {
  systemPrompt: string
  context: string
  model?: string
  maxTokens?: number
}

export async function runAgent({ systemPrompt, context, model = MODEL_FAST, maxTokens = 1024 }: AgentRunOptions): Promise<string> {
  const msg = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: context }],
  })
  const block = msg.content[0]
  if (block.type !== 'text') throw new Error(`Unexpected response type: ${block.type}`)
  return block.text
}
