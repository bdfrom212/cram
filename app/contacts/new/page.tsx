import ContactForm from '@/components/ContactForm'

export default function NewContactPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-900">New Contact</h1>
      <ContactForm mode="create" />
    </div>
  )
}
