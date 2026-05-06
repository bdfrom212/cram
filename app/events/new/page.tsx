import EventForm from '@/components/EventForm'

export default function NewEventPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-900">New Event</h1>
      <EventForm mode="create" />
    </div>
  )
}
