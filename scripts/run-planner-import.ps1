
# Import approved planner clusters into production contacts, events, and event_contacts.
# Safe to re-run: events deduplicate by tave_job_id, contacts by import_source.

Get-Content "$PSScriptRoot/../.env.local" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.+)$') { [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) }
}
$token = $env:SUPABASE_ACCESS_TOKEN; $ref = $env:SUPABASE_PROJECT_REF
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

function Sql($query) {
    $body = @{ query = $query } | ConvertTo-Json -Depth 3
    return Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Method POST -Headers $headers -Body $body
}

function Esc($s) {
    if ($null -eq $s -or $s -eq '') { return $null }
    return ([string]$s) -replace "'", "''"
}

function Lit($s) {
    # Return SQL literal: NULL or 'escaped string'
    $e = Esc $s
    if ($null -eq $e) { return 'NULL' }
    return "'$e'"
}

function FormatTitle($couple) {
    if (-not $couple) { return '' }
    return ($couple -replace '^inq:\s*', '' -replace '\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday).*', '').Trim()
}

# ---- Schema: add tave_job_id if missing ----
Write-Host "Ensuring schema..."
Sql "ALTER TABLE events ADD COLUMN IF NOT EXISTS tave_job_id text;" | Out-Null
Sql "CREATE UNIQUE INDEX IF NOT EXISTS events_tave_job_id_idx ON events (tave_job_id) WHERE tave_job_id IS NOT NULL;" | Out-Null
Sql "CREATE UNIQUE INDEX IF NOT EXISTS contacts_import_source_idx ON contacts (import_source) WHERE import_source LIKE 'cluster:%';" | Out-Null

# ---- Step 1: Fetch approved clusters ----
Write-Host "Fetching approved clusters..."
$clusters = Sql "SELECT id, proposed_name, canonical_name, instagram, role, entity_type, primary_firm_id, source_events FROM import_planner_clusters WHERE status = 'approved';"
Write-Host "  $($clusters.Count) clusters"

# Firm name lookup (for freelancer company field)
$firmNames = @{}
foreach ($c in $clusters) {
    $firmNames[$c.id] = if ($c.canonical_name) { $c.canonical_name } else { $c.proposed_name }
}

# ---- Step 2: Build deduped event map ----
# Key: "job:{tave_job_id}" when available, else "dt:{date}|{title}"
Write-Host "Building event map..."
$eventMap = @{}

foreach ($cluster in $clusters) {
    if (-not $cluster.source_events) { continue }
    $evts = $cluster.source_events
    if ($evts -isnot [array]) { $evts = @($evts) }

    foreach ($ev in $evts) {
        if (-not $ev.date) { continue }
        $jobId = $ev.job_id
        $title = FormatTitle $ev.couple
        $key   = if ($jobId) { "job:$jobId" } else { "dt:$($ev.date)|$title" }

        if (-not $eventMap.ContainsKey($key)) {
            $eventMap[$key] = @{ title = $title; date = $ev.date; venue = $ev.venue; source = $ev.source; job_id = $jobId; clusters = @{} }
        }
        # Prefer venue when not yet recorded
        if (-not $eventMap[$key].venue -and $ev.venue) { $eventMap[$key].venue = $ev.venue }
        $eventMap[$key].clusters[$cluster.id] = $true
    }
}
Write-Host "  $($eventMap.Count) unique events"

# ---- Step 3: Insert events ----
Write-Host "Inserting events..."
$allKeys = @($eventMap.Keys)

for ($i = 0; $i -lt $allKeys.Count; $i += 50) {
    $batch  = $allKeys[$i..[Math]::Min($i+49, $allKeys.Count-1)]
    $rowSql = ($batch | ForEach-Object {
        $e = $eventMap[$_]
        "($(Lit $e.title), '$(Esc $e.date)', $(Lit $e.venue), $(Lit $e.source), $(Lit $e.job_id))"
    }) -join ', '

    $sql = "INSERT INTO events (title, date, venue_name, import_source, tave_job_id) VALUES $rowSql ON CONFLICT (tave_job_id) WHERE tave_job_id IS NOT NULL DO NOTHING;"
    Sql $sql | Out-Null
    Write-Host "  events: $([Math]::Min($i+50, $allKeys.Count)) / $($allKeys.Count)"
    Start-Sleep -Milliseconds 300
}

# Build eventKey → UUID map
Write-Host "Mapping event IDs..."
$allEvents  = Sql "SELECT id, tave_job_id, title, date::text FROM events WHERE import_source IN ('vsco','tave');"
$eventIdMap = @{}
foreach ($row in $allEvents) {
    if ($row.tave_job_id) {
        $eventIdMap["job:$($row.tave_job_id)"] = $row.id
    } else {
        $eventIdMap["dt:$($row.date)|$($row.title)"] = $row.id
    }
}
Write-Host "  Mapped $($eventIdMap.Count) events"

# ---- Step 4: Insert contacts ----
Write-Host "Inserting contacts..."
$contactIdMap = @{}

for ($i = 0; $i -lt $clusters.Count; $i += 50) {
    $batch  = $clusters[$i..[Math]::Min($i+49, $clusters.Count-1)]
    $rowSql = ($batch | ForEach-Object {
        $clusterName = if ($_.canonical_name) { $_.canonical_name } else { $_.proposed_name }
        $name = Lit $clusterName
        $ig   = Lit $_.instagram
        $free = ($_.role -eq 'freelancer').ToString().ToLower()
        $role = if ($_.entity_type -eq 'venue') { 'venue' } else { 'planner' }
        $hasPrimaryFirm = ($_.role -eq 'freelancer' -and $_.primary_firm_id -and $firmNames[$_.primary_firm_id])
        $co   = if ($hasPrimaryFirm) { Lit $firmNames[$_.primary_firm_id] } else { 'NULL' }
        $src  = "'cluster:$($_.id)'"
        "($name, $ig, $free, '$role', $co, $src)"
    }) -join ', '

    $sql    = "INSERT INTO contacts (name, instagram, freelancer, role, company, import_source) VALUES $rowSql ON CONFLICT (import_source) WHERE import_source LIKE 'cluster:%' DO NOTHING RETURNING id, import_source;"
    $result = Sql $sql
    foreach ($row in $result) {
        if ($row.import_source -match '^cluster:(.+)') { $contactIdMap[$matches[1]] = $row.id }
    }
    Write-Host "  contacts: $([Math]::Min($i+50, $clusters.Count)) / $($clusters.Count)"
    Start-Sleep -Milliseconds 300
}
Write-Host "  $($contactIdMap.Count) contacts inserted"

# ---- Step 5: Insert event_contacts ----
Write-Host "Building event-contact links..."
$links = [System.Collections.Generic.List[object]]::new()
foreach ($key in $eventMap.Keys) {
    $eid = $eventIdMap[$key]
    if (-not $eid) { continue }
    foreach ($cid in $eventMap[$key].clusters.Keys) {
        $contactId = $contactIdMap[$cid]
        if (-not $contactId) { continue }
        $links.Add(@{ eid = $eid; cid = $contactId })
    }
}
Write-Host "  $($links.Count) links"

for ($i = 0; $i -lt $links.Count; $i += 100) {
    $batch  = $links[$i..[Math]::Min($i+99, $links.Count-1)]
    $rowSql = ($batch | ForEach-Object { "('$($_.eid)', '$($_.cid)', 'planner')" }) -join ', '
    Sql "INSERT INTO event_contacts (event_id, contact_id, role) VALUES $rowSql ON CONFLICT DO NOTHING;" | Out-Null
    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "=== Import complete ==="
Write-Host "  Events:   $($eventIdMap.Count)"
Write-Host "  Contacts: $($contactIdMap.Count)"
Write-Host "  Links:    $($links.Count)"
