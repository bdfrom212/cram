const { createClient } = require('@supabase/supabase-js');

const url = 'https://wtfjljzkberkzkwthlfr.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZmpsanprYmVya3prd3RobGZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODA5MDExOCwiZXhwIjoyMDkzNjY2MTE4fQ.k63yLc8XjEL3OnGbpQ7p2uGnqUlhIgbNMwS0sOs-s5s';

const supabase = createClient(url, serviceKey);

(async () => {
  try {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .limit(1);
    
    if (error && error.code === 'PGRST116') {
      console.log('✗ chat_sessions table does NOT exist');
      process.exit(1);
    } else if (error) {
      console.log('Error:', error);
      process.exit(1);
    } else {
      console.log('✓ chat_sessions table EXISTS');
      process.exit(0);
    }
  } catch (err) {
    console.error('Exception:', err.message);
    process.exit(1);
  }
})();
