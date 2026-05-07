export interface Contact {
  id: string
  name: string
  company?: string
  role: 'planner' | 'client' | 'vendor'
  email?: string
  phone?: string
  website?: string
  instagram?: string
  photo_url?: string
  action_items?: string
  personal_notes?: string
  last_contact_date?: string
  gmail_sync_enabled?: boolean
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  title?: string
  date: string
  venue_name?: string
  venue_city?: string
  venue_state?: string
  notes?: string
  tags?: string[]
  tave_job_id?: string | null
  created_at: string
  updated_at: string
}

export interface EventContact {
  event_id: string
  contact_id: string
  role: 'planner' | 'client' | 'coordinator' | 'vendor'
  contact?: Contact
  event?: Event
}

export interface KeyPerson {
  id: string
  contact_id: string
  name: string
  title?: string
  email?: string
  notes?: string
}

export interface EmailLog {
  id: string
  contact_id: string
  gmail_thread_id?: string
  subject?: string
  last_message_at?: string
  snippet?: string
  direction?: 'inbound' | 'outbound'
}

export interface Note {
  id: string
  contact_id: string
  body: string
  created_at: string
}

export interface ContactWithEvents extends Contact {
  event_contacts?: (EventContact & { event: Event })[]
  key_people?: KeyPerson[]
  email_log?: EmailLog[]
  notes?: Note[]
}
