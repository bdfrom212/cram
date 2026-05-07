
# Add entity_type column to import_planner_clusters
# Stores manual overrides for the auto-detected person/company/venue classification.
# Safe to re-run (IF NOT EXISTS).

Get-Content "$PSScriptRoot/../.env.local" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.+)$') { [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) }
}
$token = $env:SUPABASE_ACCESS_TOKEN; $ref = $env:SUPABASE_PROJECT_REF
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

$sql = "ALTER TABLE import_planner_clusters ADD COLUMN IF NOT EXISTS entity_type text;"

$body = @{ query = $sql } | ConvertTo-Json
$result = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Method POST -Headers $headers -Body $body
Write-Host "Done: $($result | ConvertTo-Json -Compress)"
