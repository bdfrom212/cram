# VSCO Inquiry Automation Plan

**Status:** Shelved — build after Grace chat panel ships  
**Created:** 2026-07-22  
**Source:** Claude research thread, 05/19/26

---

## Overview

Automatically detect new inquiry-stage jobs in VSCO, import them into CRAM, and trigger Diana to research the clients and planner — without Brian having to ask.

VSCO doesn't offer outbound webhooks, so everything is CRAM polling VSCO on a schedule.

---

## How VSCO Sync Currently Works

- Polling-based: `/api/cron/vsco-sync` fetches all VSCO jobs and upserts new ones
- **Currently skips** `lead` and `inquiry` stage jobs — only picks up booked/fulfillment/completed
- PowerShell scripts do the same thing manually
- No webhook option exists on VSCO's API

---

## Trigger Architecture

A separate (or extended) cron job watches for new inquiry-stage jobs. When it finds one it hasn't seen before:

1. Creates the event record in Supabase (`stage = 'inquiry'`)
2. Imports contacts and links them with roles (client, planner)
3. Kicks off Diana's research on that event

The existing cron already has all the scaffolding — deduplication by `tave_job_id`, contact import — it just needs an inquiry-aware branch.

---

## Who Gets Researched

Based on `event_contacts` roles:

- **Clients** (`role = client`) — always
- **Planner/Coordinator** (`role = planner` or `coordinator`) — only if `last_researched_at` is stale or null
- **Vendors/venue** — skip at inquiry stage (usually not determined yet)

**Freshness threshold:** 90 days (matches Grace's existing standup logic)

---

## What Diana Needs

Diana's existing context builder already handles everything — she takes an `eventId`, fetches the event, and pulls all linked contacts. As long as the inquiry sync creates the event with date/venue and links the contacts, Diana can run immediately with no changes needed.

---

## Grace's Role

- Inquiry cron triggers Diana immediately (don't wait for Grace to notice)
- Grace surfaces completed research in her next standup: *"New inquiry came in: Keaton/Morrison on October 4th at Terrain. Diana has their brief ready."*

---

## Open Decisions

These four need answers before build starts:

**1. Do inquiry-stage events appear in the main event list or separately?**  
*Recommended:* Add a `stage` field to events (inquiry / booked) and show them in a distinct "Inquiries" section.

**2. If a planner was researched <90 days ago, skip or refresh?**  
*Recommended:* Skip — planner data is still fresh, and event-specific context is minimal at inquiry stage.

**3. How often does the inquiry-watching cron run?**  
*Recommended:* Every 30 minutes — responsive enough, light on VSCO API calls.

**4. Notification when research completes, or just Grace's next standup?**  
*Recommended:* Grace surfaces it in standup (no separate push notification).

---

## Build Steps

1. **Add `stage` column to events table** — migration: `stage TEXT DEFAULT 'booked'` with check constraint (inquiry, booked, completed)
2. **Extend VSCO sync to include inquiries** — add inquiry-fetching branch to `/app/api/cron/vsco-sync`; detect `lead`/`inquiry` stage jobs, deduplicate by `tave_job_id`, create records with `stage = 'inquiry'`
3. **Wire contact import for inquiry events** — reuse existing contact/link upsert logic to attach clients and planner contacts
4. **Add research-after-import trigger** — after contacts are linked, call `POST /api/agents/researcher` with new `eventId`; apply 90-day freshness check for planners
5. **Create dedicated inquiry cron schedule** — every 30 minutes (or chosen interval), separate from main sync
6. **Update Grace's context** — add inquiry-stage events to standup, surface completed Diana briefs
7. **UI: Inquiries section** — distinct frontend view for inquiries, showing Diana brief when available

---

## Dependencies / Prerequisites

- Grace chat panel must be live first (this automation surfaces results through it)
- Diana's researcher agent is already capable — no changes needed
- Supabase `event_contacts` table with roles already exists
