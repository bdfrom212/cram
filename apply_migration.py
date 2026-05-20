#!/usr/bin/env python3
import requests
import json
from pathlib import Path

# Read the migration SQL
sql_file = Path(__file__).parent / 'supabase' / 'migrations' / '20260517000001_grace_chat_tables.sql'
sql = sql_file.read_text()

# Supabase credentials
project_ref = 'wtfjljzkberkzkwthlfr'
access_token = 'sbp_201aaf1821840e2da2de5365ac638e733da56606'
url = f'https://api.supabase.com/v1/projects/{project_ref}/database/query'

headers = {
    'Authorization': f'Bearer {access_token}',
    'Content-Type': 'application/json'
}

# Create payload with properly escaped SQL
payload = {
    'query': sql
}

print(f'Applying migration from {sql_file}...')
print(f'SQL length: {len(sql)} characters')

response = requests.post(url, headers=headers, json=payload)

print(f'Status: {response.status_code}')
print(f'Response: {response.text}')

if response.status_code == 200:
    print('\n✓ Migration applied successfully!')
    exit(0)
else:
    print('\n✗ Migration failed!')
    exit(1)
