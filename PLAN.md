# Wedding Photography Relationship Intelligence System

## Context

Brian is a wedding photographer with 900+ weddings, ~100 key planner relationships, and ~1,800 clients. He has difficulty recalling faces, names, shared history, and conversation context — a significant business liability when planners are his primary referral source. This system gives him an instant, visual "relationship dossier" when he encounters any contact, and keeps itself updated automatically via Gmail. It must work on both desktop (Windows) and mobile (Chrome on iPhone).

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js 14 (App Router) | Single codebase, React UI, API routes built in |
| Database | Supabase (PostgreSQL) | Free tier, full-text search, photo storage, real-time, Google OAuth |
| Hosting | Vercel | Free tier, push-button deploy, auto-deploys from GitHub |
| Email | Gmail API (OAuth) | Already connected; monitors threads and enriches contact records |
| Styling | Tailwind CSS | Rapid, mobile-first, visually clean |

**Auth**: Google Sign-In via Supabase Auth — Brian logs in with his existing Google account, no new password.

---

## Data Model

```
contacts
  id, name, company, role (planner | client | vendor)
  email, phone, website, instagram
  photo_url                          -- stored in Supabase Storage
  action_items TEXT                  -- freeform: "bring up Newport expansion"
  personal_notes TEXT                -- conversation gold: "has a dog named Biscuit"
  last_contact_date DATE
  gmail_sync_enabled BOOL
  created_at, updated_at

events
  id, date DATE, venue_name, venue_city, venue_state
  notes TEXT
  tags TEXT[]                        -- ["beach", "ballroom", "rhode island"]

event_contacts                       -- many-to-many: who was at each wedding
  event_id, contact_id
  role (planner | client | coordinator | vendor)

key_people                           -- staff/employees at a planner's company
  id, contact_id (FK → contacts)
  name, title, email, notes

email_log                            -- auto-populated by Gmail sync
  id, contact_id, gmail_thread_id
  subject, last_message_at, snippet, direction (inbound | outbound)

notes                                -- time-stamped field notes (added from phone)
  id, contact_id, body TEXT, created_at
```

---

## Core Features

### 1. Relationship Dossier Card (the primary UI)
The first thing shown when searching for or tapping a contact:

```
┌─────────────────────────────────────────────────┐
│ [PHOTO]  Sarah Chen                             │
│          Bliss Events · Wedding Planner         │
│          sarah@blissevents.com · (401) 555-0000 │
├─────────────────────────────────────────────────┤
│ LAST EVENT                                      │
│   Smith/Jones · Jun 15, 2024 · Rosecliff, RI   │
│                                                 │
│ NEXT EVENT                                      │
│   Davis/Park · Aug 22, 2026 · The Breakers, RI │
├─────────────────────────────────────────────────┤
│ KEY PEOPLE AT BLISS EVENTS                      │
│   • Maria Rodriguez — Lead Coordinator          │
│   • Tom Chen — Operations                       │
├─────────────────────────────────────────────────┤
│ BRING UP / DISCUSS                              │
│   • Mentioned wanting to expand into CT         │
│   • Has a referral for Dec wedding at Oheka     │
├─────────────────────────────────────────────────┤
│ PERSONAL NOTES                                  │
│   • Golden retriever named Biscuit              │
│   • Just got back from Italy, loves Amalfi      │
│   • Daughter just started at URI                │
└─────────────────────────────────────────────────┘
            [Full History ↓]  [Add Note]
```

Tap "Full History" to see all events together + full email thread timeline.

### 2. Search
- Search bar on homepage — searches across: name, company, venue, city, state, tags
- Keywords like "beach", "rhode island", "ballroom" return matching contacts AND events
- Results show mini-cards (photo + name + last event) for fast visual scanning

### 3. Re-Engagement Dashboard
- "Planners you haven't contacted in 90+ days" — prioritized list
- "Upcoming events this month" — who to prep for
- "Recent inbound emails from contacts" — never miss a message

### 4. Gmail Auto-Sync
- OAuth connection to Brian's Gmail
- Background job (Vercel Cron) checks Gmail daily for emails to/from known contacts
- Updates `last_contact_date` and logs thread in `email_log`
- Surfaces email snippets on the dossier card

### 5. Mobile-First Field Notes
- From phone, tap a contact → "Add Note" → type/dictate a note → saved immediately
- Notes appear in "Personal Notes" section of dossier
- Optimized for one-handed use in the real world

### 6. Photo Management
- **Import from Google Drive folder** — browse your existing headshots folder and assign photos to contacts directly (no re-upload needed)
- Upload from computer (drag-and-drop)
- Paste a URL (pull from their website/Instagram)
- Capture from phone camera directly in Chrome
- Contacts you know well can stay photo-optional; photo is most useful for contacts you see infrequently

---

## Data Import Plan (one-time seeding)

| Source | Method |
|---|---|
| VSCO Workspace | Export CSV/JSON + API; parse into `contacts` + `events` |
| Google Drive headshots folder | Browse via Drive API; match filenames to contact names; bulk-assign photos |
| Google Contacts | Google People API; match by email to enrich existing contacts |
| Google Docs/Sheets | Parse columns → map to data model; Brian reviews/confirms mapping |
| Gmail history | Initial backfill: scan last 2 years of sent/received for known contact emails |

---

## Implementation Phases

### Phase 1 — Core App (build first, use immediately)
1. Next.js + Supabase project setup, Google OAuth login
2. Database schema (all tables above)
3. Contact CRUD: create/edit/view planner and client profiles
4. Event CRUD: log weddings, link contacts (planners + clients)
5. Dossier card view — the primary UI
6. Search (full-text across name, venue, city, tags)
7. Photo upload → Supabase Storage
8. Deploy to Vercel

### Phase 2 — Intelligence Layer
1. Gmail OAuth + sync job (Vercel Cron)
2. Email log display on dossier card
3. Re-engagement dashboard (90-day no-contact list)
4. Field notes from mobile
5. Key people sub-records

### Phase 3 — Import & Enrichment
1. VSCO Workspace import (CSV/API)
2. Google Contacts import
3. Google Docs/Sheets import wizard
4. Gmail historical backfill (past 2 years)

---

## Deployment (push-button after initial setup)

1. Create free GitHub account (if needed) → push code there
2. Create free Supabase project → run schema SQL → copy connection string
3. Create free Vercel account → import GitHub repo → paste env vars → Deploy
4. Connect Google OAuth (one Supabase config screen)
5. Done — accessible at a Vercel URL on any device, any browser

Ongoing: every code change auto-deploys. No maintenance required.

---

## Verification

- Search "rhode island" → returns planners and events linked to RI venues
- Tap a planner → dossier card shows all sections populated
- Send a test email to/from a contact → Gmail sync job picks it up within 24h, appears on card
- Add a field note from iPhone Chrome → appears immediately on dossier
- "Re-engage" dashboard shows planners with no contact in 90+ days
