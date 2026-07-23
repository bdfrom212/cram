// Allowlist of contact fields Grace is permitted to write.
// System fields (id, created_at, updated_at, tave_job_id, import_source,
// gmail_sync_enabled, last_researched_at) are intentionally excluded.

export const ALLOWED_CONTACT_FIELDS = new Set([
  'name',
  'company',
  'role',
  'email',
  'phone',
  'website',
  'instagram',
  'photo_url',
  'action_items',
  'personal_notes',
  'last_contact_date',
  'freelancer',
])

export function filterContactFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED_CONTACT_FIELDS.has(k))
  )
}
