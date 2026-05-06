import { createClient } from '@/lib/supabase/server'
import EventForm from '@/components/EventForm'
import { notFound } from 'next/navigation'

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: event } = await supabase
    .from('events')
    .select('*, event_contacts(role, contact_id, contact:contacts(*))')
    .eq('id', id)
    .single()
  if (!event) notFound()

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-900">Edit Event</h1>
      <EventForm mode="edit" event={event} />
    </div>
  )
}
