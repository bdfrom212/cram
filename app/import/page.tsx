import Link from 'next/link'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getProgress() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data } = await supabase
    .from('import_planner_clusters')
    .select('status')

  const counts = { pending: 0, approved: 0, split: 0, skip: 0 }
  data?.forEach(row => {
    const s = row.status as keyof typeof counts
    if (s in counts) counts[s]++
  })
  return counts
}

export default async function ImportPage() {
  const counts = await getProgress()
  const total = counts.pending + counts.approved + counts.split + counts.skip
  const done = counts.approved + counts.split + counts.skip
  const plannersDone = total > 0 && counts.pending === 0

  type StageStatus = 'complete' | 'active' | 'upcoming' | 'locked'
  const stages: { number: number; title: string; description: string; status: StageStatus; href: string | null }[] = [
    {
      number: 1,
      title: 'Schema Updated',
      description: 'Database prepared for import',
      status: 'complete',
      href: null,
    },
    {
      number: 2,
      title: 'Planner Normalization',
      description: `${done} of ${total} planner firms reviewed`,
      status: plannersDone ? 'complete' : 'active',
      href: '/import/planners',
    },
    {
      number: 3,
      title: 'Event Import',
      description: '0 events staged',
      status: plannersDone ? 'upcoming' : 'locked',
      href: null,
    },
    {
      number: 4,
      title: 'Contact Import',
      description: 'Clients, planners, and venues',
      status: 'locked',
      href: null,
    },
    {
      number: 5,
      title: 'Review & Finalize',
      description: 'Approve and write to database',
      status: 'locked',
      href: null,
    },
  ]

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Data Import</h1>
        <p className="text-gray-500 text-sm mt-1">
          Margaret — importing from VSCO and Tave exports
        </p>
      </div>

      <div className="space-y-3">
        {stages.map((stage) => (
          <div
            key={stage.number}
            className={`border rounded-xl p-4 ${
              stage.status === 'complete' ? 'border-green-200 bg-green-50' :
              stage.status === 'active' ? 'border-gray-300 bg-white shadow-sm' :
              'border-gray-100 bg-gray-50 opacity-60'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                stage.status === 'complete' ? 'bg-green-500 text-white' :
                stage.status === 'active' ? 'bg-gray-900 text-white' :
                'bg-gray-200 text-gray-400'
              }`}>
                {stage.status === 'complete' ? '✓' : stage.number}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`font-medium ${stage.status === 'locked' ? 'text-gray-400' : 'text-gray-900'}`}>
                  {stage.title}
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">{stage.description}</p>
              </div>
              {stage.href && stage.status !== 'locked' && (
                <Link
                  href={stage.href}
                  className="text-sm font-medium text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg flex-shrink-0"
                >
                  {stage.status === 'complete' ? 'Review' : 'Continue →'}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center mt-8">
        Data from VSCO Workspace Export 5/4/2026 · Tave Anniversary Export April 2025
      </p>
    </div>
  )
}
