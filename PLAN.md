# Cram — Relationship Intelligence System

## The Mission

Make Brian Dorsey a master networker despite weak memory and self-described mediocre social skills. This is not a CRM. It is a memory prosthetic, executive assistant, CMO, and social intelligence system — all working together so Brian can walk into any interaction already knowing everything that matters about the person in front of him, and leave every interaction having made that person feel like the most important person he knows.

Brian has 900+ weddings, ~100 key planner relationships, and ~1,800 clients. Planners are his primary referral source. Forgetting a planner's dog's name or missing the fact that a new client is a billionaire is a business liability. This system eliminates that liability.

---

## Design Principles

1. **Surface the right thing at the right moment** — not a database to browse, a system that tells Brian what he needs before he needs to ask
2. **AI does the work, Brian approves** — agents research, extract, and draft; Brian reviews and confirms before anything is saved
3. **High signal, zero noise** — no email archives, no activity logs; only relationship intelligence that changes how Brian shows up
4. **Always give Brian a natural, authentic way to use what he knows** — information without a script is just trivia
5. **Gmail stays Gmail** — Cram extracts insight from email but never duplicates it

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend + API | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL) |
| Hosting | Vercel |
| Email | Gmail API (OAuth) |
| AI | Claude API (Anthropic) |
| Web Research | Brave Search API or Tavily |
| Styling | Tailwind CSS |

---

## Data Model

```
contacts
  id, name, company, role (planner | client | vendor)
  email, phone, website, instagram
  photo_url
  action_items TEXT         -- "bring up Newport expansion"
  personal_notes TEXT       -- "has a dog named Biscuit"
  last_contact_date DATE
  research_summary TEXT     -- AI-generated background brief
  last_researched_at TIMESTAMPTZ
  gmail_sync_enabled BOOL
  created_at, updated_at

events
  id, title (couple names), date DATE
  venue_name, venue_city, venue_state
  notes TEXT
  tags TEXT[]

event_contacts                  -- who was at each wedding
  event_id, contact_id, role

key_people                      -- staff at a planner's company
  id, contact_id, name, title, email, notes

notes                           -- timestamped field notes
  id, contact_id, body, created_at
  source (manual | gmail_agent | research_agent)
  source_url TEXT               -- link back to Gmail thread or web source

network_radar                   -- engagement signals in contacts' networks
  id, contact_id (who knows them)
  subject_name, subject_instagram, subject_url
  signal_type (engagement_announced | wedding_planning | other)
  snippet TEXT
  detected_at TIMESTAMPTZ
  actioned BOOL
```

---

## Agent Stack

### Agent 1 — Gmail Enrichment Agent
*Reads your email history with a contact and extracts relationship intelligence*

- Connects to Gmail via OAuth
- Given a contact, retrieves all threads to/from their email address
- Sends threads to Claude with instructions to extract:
  - Weddings worked together + how they went
  - Personal details (family, pets, interests, milestones)
  - Gifts sent/received, collabs, industry encounters
  - Referrals given or received
  - Tone and relationship health signals
- Returns a structured draft: "Here's what I found — approve, edit, or discard each item"
- Approved items become notes or event records, with a link to the source thread
- Can be re-run periodically to catch new history

### Agent 2 — Research Brief Agent
*Researches who someone is before Brian meets them*

- Triggered on new contacts or manually from any dossier ("Research this person")
- Searches LinkedIn, Instagram, news, business press, wedding industry press
- Extracts: professional background, net worth signals, recent news, social aesthetic, mutual connections, conversation hooks
- Returns a one-page brief saved to `research_summary` on the contact record
- Displayed prominently on the dossier card: "Who is this person?"
- Runs automatically on new inquiries so Brian always knows who he's quoting before the meeting

### Agent 3 — Network Radar Agent
*Monitors contacts' social networks for engagement signals*

- Periodically scans public Instagram/social for key contacts
- Looks for: engagement announcements, tagged photos at weddings, friends commenting on ring photos
- Surfaces detected signals with a suggested outreach:
  "John Chen from Bliss Events liked a friend's engagement post. Want me to draft a note to John asking for a warm intro?"
- Brian approves the outreach or dismisses it
- Tracks which signals were actioned

### Agent 4 — Pre-Event Prep Agent
*Generates a brief for Brian the morning of every wedding*

- Runs automatically the morning of each scheduled event
- Pulls dossier data for every contact linked to that event (planner, coordinator, clients)
- Generates a "Today's Briefing": key people to remember, conversation starters, things to bring up, things to avoid
- Delivered as a push notification or email to Brian's phone
- Example output: "Today: Smith/Jones at Rosecliff. Planner is Sarah Chen — her dog Biscuit just had puppies, she mentioned expanding into CT. Client is James Morrison, founder of Fortress Investments — keep it low-key, he values privacy. His fiancée Emily went to URI, her mom will be very involved."

### Agent 5 — Relationship Health Monitor
*Flags when important relationships are going cold*

- Monitors `last_contact_date` across all planners
- Cross-references with booking patterns (planners who used to refer regularly and have gone quiet)
- Surfaces: "You haven't heard from 3 planners who each sent you 2+ weddings in previous years. Want to reach out?"
- Drafts a personalized re-engagement note for each, grounded in something real from their dossier
- Tracks seasonal patterns (some planners go quiet in off-season, some don't)

---

## Core Features (Built)

### Relationship Dossier Card
The primary UI — instant visual brief when you look up any contact:
- Photo, name, company, role, contact info
- Last event / Next event
- Key people at their company
- Bring up / Discuss
- Personal notes
- Field notes (timestamped)
- Research brief (Agent 2 output)
- Recent email snippets
- Add Note button (mobile-optimized)

### Search
Live search across name, company, venue, city, state, tags

### Re-Engagement Dashboard
- Planners quiet for 90+ days
- Upcoming events this month
- Network radar alerts (Agent 3)

---

## Implementation Phases

### Phase 1 — Core App ✅ COMPLETE
- Next.js + Supabase, Google OAuth
- Full database schema
- Contact and event CRUD
- Dossier card UI
- Search
- Photo upload
- Deployed to Vercel

### Phase 2 — Gmail Enrichment Agent
1. Gmail OAuth connection
2. Thread retrieval for a given contact
3. Claude API enrichment call with structured extraction prompt
4. Review UI: approve / edit / discard each extracted item
5. Save approved items as notes with source links
6. "Re-enrich" button on dossier card

### Phase 3 — Research Brief Agent
1. Web search integration (Brave or Tavily API)
2. Research agent prompt: extract background, signals, conversation hooks
3. Research brief displayed on dossier card
4. Auto-trigger on new contact creation
5. Manual "Research" button on any dossier

### Phase 4 — Pre-Event Prep Agent
1. Query upcoming events each morning
2. Pull all linked contacts' dossier data
3. Generate briefing document via Claude
4. Deliver via email or push notification

### Phase 5 — Network Radar + Relationship Health
1. Instagram/social monitoring for engagement signals
2. Booking pattern analysis for relationship health
3. Automated re-engagement draft generation
4. Unified alert dashboard

### Phase 6 — Data Import
1. VSCO Workspace import (900+ weddings)
2. Google Contacts import
3. Google Docs/Sheets import wizard
4. Historical Gmail backfill via Agent 1

---

## The North Star

Brian walks into every wedding already knowing:
- Who the planner is, what matters to her, what to bring up
- Who the clients are, what their world looks like, what not to say
- Who in the room might refer him next

And every planner he hasn't seen in months gets a personal, warm outreach at exactly the right moment — not a mass email, a real note that references something real.

That's the system.
