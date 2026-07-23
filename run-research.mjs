import { readFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envFile = readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const idx = line.indexOf('=');
  if (idx > 0) {
    const key = line.substring(0, idx);
    const value = line.substring(idx + 1);
    env[key] = value;
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing env vars');
  console.error('SUPABASE_URL:', !!SUPABASE_URL);
  console.error('SERVICE_ROLE_KEY:', !!SERVICE_ROLE_KEY);
  console.error('ANTHROPIC_KEY:', !!ANTHROPIC_KEY);
  process.exit(1);
}

console.log('✓ Loaded env vars');

// 1. Find Rebecca Sassoon's event
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const { data: events, error: eventError } = await supabase
  .from('events')
  .select('id, title, date, stage')
  .or(`title.ilike.%rebecca%,title.ilike.%sassoon%`);

if (eventError) {
  console.error('Error finding event:', eventError);
  process.exit(1);
}

if (!events || events.length === 0) {
  console.error('No event found for Rebecca Sassoon');
  process.exit(1);
}

const event = events[0];
console.log(`✓ Found event: ${event.title} (${event.id}) - Stage: ${event.stage}`);

// 2. Build research context
const { data: eventFull } = await supabase
  .from('events')
  .select(`
    id, title, date, venue_name, venue_city, venue_state, notes,
    event_contacts(
      role,
      contact:contacts(
        id, name, company, role, instagram, website,
        last_contact_date, personal_notes, action_items
      )
    )
  `)
  .eq('id', event.id)
  .single();

const contactsList = (eventFull.event_contacts || [])
  .map(ec => `${ec.contact?.name} (${ec.role})${ec.contact?.company ? ' at ' + ec.contact.company : ''}`)
  .join(', ');

const context = `
=== EVENT CONTEXT ===
Title: ${eventFull.title}
Date: ${new Date(eventFull.date).toLocaleDateString()}
Venue: ${[eventFull.venue_name, eventFull.venue_city, eventFull.venue_state].filter(Boolean).join(', ')}
Contacts: ${contactsList}
`;

console.log('✓ Built research context');

// 3. Call Anthropic API
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

const DIANA_PROMPT = `You are Diana, an intelligence researcher for a luxury wedding photographer named Brian Dorsey. Write a brief research summary for the people on this event.

${context}

Provide a concise intelligence brief — who they are, what Brian should know about them, any relevant context.`;

console.log('→ Calling Anthropic API...');
const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 2048,
  messages: [
    { role: 'user', content: DIANA_PROMPT }
  ]
});

const brief = message.content[0].type === 'text' ? message.content[0].text : '';
console.log('✓ Research brief generated');

// 4. Save brief to briefs table
const { data: savedBrief, error: briefError } = await supabase
  .from('briefs')
  .insert({
    event_id: event.id,
    agent: 'researcher',
    content: brief,
    model: 'claude-sonnet-4-6'
  })
  .select()
  .single();

if (briefError) {
  console.error('✗ Error saving brief:', briefError.message);
} else {
  console.log('✓ Saved brief to database');
}

// 5. Create notification if inquiry event
if (event.stage === 'inquiry') {
  const clientNames = (eventFull.event_contacts || [])
    .filter(ec => ec.role === 'client')
    .map(ec => ec.contact?.name)
    .filter(Boolean)
    .join(' & ');

  const dateStr = new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const notifMessage = `Diana has finished research on ${clientNames || 'clients'} — new inquiry for ${dateStr}`;

  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      event_id: event.id,
      title: 'Research Complete',
      message: notifMessage,
      action_url: `/events/${event.id}`
    });

  if (notifError) {
    console.error('✗ Error creating notification:', notifError.message);
  } else {
    console.log('✓ Created notification for inquiry event');
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Research workflow complete!');
console.log(`Brief: ${brief.length} characters`);
console.log(`Event: ${event.id}`);
