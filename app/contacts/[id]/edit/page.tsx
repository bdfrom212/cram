import { createClient } from '@/lib/supabase/server'
import ContactForm from '@/components/ContactForm'
import { notFound } from 'next/navigation'

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: contact } = await supabase.from('contacts').select('*').eq('id', id).single()
  if (!contact) notFound()

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-900">Edit {contact.name}</h1>
      <ContactForm mode="edit" contact={contact} />
    </div>
  )
}
