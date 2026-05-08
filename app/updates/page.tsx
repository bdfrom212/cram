import { getAllBriefs } from '@/lib/agents/store'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const AGENT_LABELS: Record<string, { label: string; color: string }> = {
  concierge:  { label: 'Claire · Morning Brief',    color: 'bg-gray-100 text-gray-600' },
  researcher: { label: 'Diana · Research',           color: 'bg-indigo-50 text-indigo-600' },
  grace:      { label: 'Grace · Standup',            color: 'bg-emerald-50 text-emerald-600' },
  publicist:  { label: 'Sophia · Content Draft',     color: 'bg-rose-50 text-rose-600' },
}

function agentMeta(agent: string) {
  return AGENT_LABELS[agent] ?? { label: agent, color: 'bg-gray-100 text-gray-500' }
}

function fmtAge(dateStr: string) {
  const age = Date.now() - new Date(dateStr).getTime()
  if (age < 60_000) return 'just now'
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function preview(content: string) {
  return content.replace(/\*\*/g, '').split('\n').find(l => l.trim().length > 20)?.trim().slice(0, 120) ?? ''
}

export default async function UpdatesPage() {
  const supabase = await createClient()
  const briefs = await getAllBriefs(100)

  // Get event titles for event-keyed briefs
  const eventIds = Array.from(new Set(briefs.map(b => b.event_id).filter(Boolean))) as string[]
  let eventMap: Record<string, string> = {}
  if (eventIds.length) {
    const { data: events } = await supabase
      .from('events')
      .select('id, title, date, venue_name')
      .in('id', eventIds)
    for (const ev of events ?? []) {
      const label = ev.title || 'Untitled'
      eventMap[ev.id] = `${label}${ev.venue_name ? ` · ${ev.venue_name}` : ''}`
    }
  }

  const unreadCount = briefs.filter(b => !b.read_at).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Updates</h1>
        {unreadCount > 0 && (
          <span className="text-xs bg-gray-900 text-white px-2 py-0.5 rounded-full">{unreadCount} unread</span>
        )}
      </div>

      {briefs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-8 text-center text-sm text-gray-400">
          No agent outputs yet. Run Claire or Grace to get started.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {briefs.map(brief => {
            const meta = agentMeta(brief.agent)
            const eventLabel = brief.event_id ? eventMap[brief.event_id] : null
            const isUnread = !brief.read_at
            const href = brief.event_id
              ? brief.agent === 'grace' ? '/grace'
              : `/events/${brief.event_id}`
              : '/grace'

            return (
              <Link
                key={brief.id}
                href={href}
                className={`block px-5 py-3.5 hover:bg-gray-50 transition-colors ${isUnread ? 'bg-white' : 'bg-gray-50/50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
                        {meta.label}
                      </span>
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                    </div>
                    {eventLabel && (
                      <p className="text-xs text-gray-500 mb-0.5">{eventLabel}</p>
                    )}
                    <p className="text-sm text-gray-600 truncate">{preview(brief.content)}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{fmtAge(brief.created_at)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
