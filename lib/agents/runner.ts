import Anthropic from '@anthropic-ai/sdk'

const MODEL_FAST = 'claude-haiku-4-5-20251001'   // Claire, Scout, Archivist
const MODEL_DEEP = 'claude-sonnet-4-6'            // Researcher, Strategist

export { MODEL_FAST, MODEL_DEEP }

function getClient() {
  // Fallback to hardcoded key for dev if env var isn't loading
  const apiKey = process.env.ANTHROPIC_API_KEY || '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'

  if (!apiKey) {
    throw new Error(`ANTHROPIC_API_KEY not available`)
  }
  return new Anthropic({ apiKey })
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
