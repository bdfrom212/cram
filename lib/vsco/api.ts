const BASE = 'https://workspace.vsco.co/api/v2'

function headers() {
  return { 'X-API-KEY': process.env.VSCO_API_KEY ?? '', Accept: 'application/json' }
}

async function vscoFetch(path: string) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers(), next: { revalidate: 0 } })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export interface VscoJob {
  id: string
  name: string
  eventDate: string
  stage: 'lead' | 'inquiry' | 'booked' | 'fulfillment' | 'completed'
  links?: { self?: { managerHref?: string } }
}

export interface VscoContact {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  email?: string
  secondaryEmail?: string
  cellPhone?: string
  workPhone?: string
  homePhone?: string
  companyName?: string
  jobTitle?: string
  twitterUsername?: string
  facebookUsername?: string
  chatAccount1?: { service: string; identity: string }
  chatAccount2?: { service: string; identity: string }
  chatAccount3?: { service: string; identity: string }
  customFields?: { fieldId: string; value: string }[]
}

export interface VscoJobContact {
  contactId: string
  roleKinds: string[]
}

export interface VscoEventLocation {
  location?: { address?: { name?: string; city?: string; state?: string } }
}

export function extractTaveId(managerHref?: string): string | null {
  if (!managerHref) return null
  const m = managerHref.match(/\/jobs\/view\/(\d+)/)
  return m ? m[1] : null
}

export function extractPhone(contact: VscoContact): string | null {
  return contact.cellPhone || contact.workPhone || contact.homePhone || null
}

export function extractInstagram(contact: VscoContact): string | null {
  for (const acct of [contact.chatAccount1, contact.chatAccount2, contact.chatAccount3]) {
    if (acct?.service === 'instagram' && acct.identity) {
      const handle = acct.identity.replace(/^@/, '')
      return `@${handle}`
    }
  }
  return null
}

export function contactDisplayName(c: VscoContact): string {
  if (c.name?.trim()) return c.name.trim()
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
}

// Collections use `items`; single-record endpoints return fields at top level.

export function extractPrimarySessionId(job: any): string | null {
  const href = job?.links?.primarySessionId?.href
  if (!href) return null
  const m = href.match(/\/event\/([^/]+)$/)
  return m ? m[1] : null
}

export async function fetchJobs(page = 1, perPage = 100) {
  const data = await vscoFetch(`/job?page=${page}&perPage=${perPage}`)
  return data as { items: VscoJob[]; meta: { totalItems: number } } | null
}

export async function fetchJobEvent(primarySessionId: string) {
  return await vscoFetch(`/event/${primarySessionId}`) as VscoEventLocation | null
}

export async function fetchJobContacts(vscoJobId: string) {
  const data = await vscoFetch(`/job-contact?jobId=${vscoJobId}`)
  return (data?.items ?? []) as VscoJobContact[]
}

export async function fetchAddressBook(contactId: string) {
  return await vscoFetch(`/address-book/${contactId}`) as VscoContact | null
}

export async function fetchAddressBookPage(page = 1, perPage = 100) {
  const data = await vscoFetch(`/address-book?page=${page}&perPage=${perPage}`)
  return data as { items: VscoContact[]; meta: { totalItems: number } } | null
}

export async function fetchJob(vscoJobId: string) {
  return await vscoFetch(`/job/${vscoJobId}`) as (VscoJob & { leadNotes?: string }) | null
}
