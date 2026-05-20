const fs = require('fs');
const path = require('path');

// Read the migration SQL
const migrationPath = path.join(__dirname, 'supabase/migrations/20260517000001_grace_chat_tables.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

// Supabase credentials
const projectRef = 'wtfjljzkberkzkwthlfr';
const accessToken = 'sbp_201aaf1821840e2da2de5365ac638e733da56606';
const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

const headers = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
};

const payload = JSON.stringify({ query: sql });

console.log(`Applying migration from ${migrationPath}...`);
console.log(`SQL length: ${sql.length} characters\n`);

// Use Node's native fetch (available in v18+)
fetch(url, {
  method: 'POST',
  headers,
  body: payload
})
  .then(res => {
    console.log(`Status: ${res.status}`);
    return res.text();
  })
  .then(text => {
    console.log(`Response: ${text}`);
    if (text.includes('error') || text.includes('ERROR')) {
      console.log('\n✗ Migration failed!');
      process.exit(1);
    } else {
      console.log('\n✓ Migration applied successfully!');
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
