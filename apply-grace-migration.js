const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const url = 'https://wtfjljzkberkzkwthlfr.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZmpsanprYmVya3prd3RobGZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODA5MDExOCwiZXhwIjoyMDkzNjY2MTE4fQ.k63yLc8XjEL3OnGbpQ7p2uGnqUlhIgbNMwS0sOs-s5s';

const supabase = createClient(url, serviceKey);

const migrationPath = path.join(__dirname, 'supabase/migrations/20260517000001_grace_chat_tables.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

(async () => {
  try {
    console.log('Applying Grace chat tables migration...');
    const { data, error } = await supabase.rpc('query', { query: sql });
    if (error) {
      console.error('Error:', error);
      process.exit(1);
    }
    console.log('✓ Migration applied successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Exception:', err.message);
    process.exit(1);
  }
})();
