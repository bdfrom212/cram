export interface WebResult {
  title: string
  url: string
  content: string
}

export type SearchStatus = 'ok' | 'no_key' | 'rate_limited' | 'error'

export async function tavilySearch(
  query: string
): Promise<{ results: WebResult[]; status: SearchStatus }> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return { results: [], status: 'no_key' }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: 5,
      }),
    })

    if (res.status === 429) return { results: [], status: 'rate_limited' }
    if (!res.ok) return { results: [], status: 'error' }

    const data = await res.json()
    return {
      results: (data.results ?? []).map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content ?? '',
      })),
      status: 'ok',
    }
  } catch {
    return { results: [], status: 'error' }
  }
}
