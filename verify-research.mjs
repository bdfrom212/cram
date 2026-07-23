import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Get the brief
const { data: brief } = await supabase
  .from('briefs')
  .select('*')
  .eq('agent', 'researcher')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

if (brief) {
  console.log('✓ Brief found in database');
  console.log(`  Agent: ${brief.agent}`);
  console.log(`  Model: ${brief.model}`);
  console.log(`  Created: ${new Date(brief.created_at).toLocaleString()}`);
  console.log(`  Content length: ${brief.content.length} characters`);
  console.log('\n--- Content Preview ---');
  console.log(brief.content.slice(0, 800) + '\n...');
} else {
  console.log('✗ No brief found');
}

// Check for notifications
const { data: notifications } = await supabase
  .from('notifications')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5);

console.log('\n--- Recent Notifications ---');
if (notifications && notifications.length > 0) {
  notifications.forEach(n => {
    console.log(`✓ ${n.title}: ${n.message.slice(0, 60)}...`);
  });
} else {
  console.log('No notifications (expected for booked events)');
}
