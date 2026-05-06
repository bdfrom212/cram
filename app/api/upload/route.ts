import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const formData = await request.formData()
  const file = formData.get('file') as File
  const contactId = formData.get('contact_id') as string

  if (!file || !contactId) {
    return NextResponse.json({ error: 'file and contact_id required' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()
  const path = `${contactId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(path, file, { upsert: true })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)

  await supabase.from('contacts').update({ photo_url: publicUrl }).eq('id', contactId)

  return NextResponse.json({ url: publicUrl })
}
