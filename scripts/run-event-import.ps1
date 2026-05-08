# run-event-import.ps1
# Imports all events from VSCO and Tave CSVs into the events table,
# then links approved planner clusters as event_contacts.
# Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING.

$ErrorActionPreference = 'Stop'

# --- Config ---
$projectRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $projectRoot '.env.local'
$vscoPath = Join-Path $projectRoot 'data\vsco_jobs_raw.csv'
$tavePath = Join-Path $projectRoot 'data\tave_anniversary_raw.csv'

# Load .env.local
$env = @{}
Get-Content $envFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $key, $value = $_ -split '=', 2
    $env[$key.Trim()] = $value.Trim().Trim('"')
}
$TOKEN = $env['SUPABASE_ACCESS_TOKEN']
$REF   = $env['SUPABASE_PROJECT_REF']

if (-not $TOKEN -or -not $REF) {
    Write-Error "SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF not found in .env.local"
    exit 1
}

# --- Helpers ---
function Invoke-Sql($sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Compress -Depth 5
    try {
        $result = Invoke-RestMethod `
            -Uri "https://api.supabase.com/v1/projects/$REF/database/query" `
            -Method POST `
            -Headers @{ Authorization = "Bearer $TOKEN"; 'Content-Type' = 'application/json' } `
            -Body $body
        return $result
    } catch {
        Write-Host "SQL error: $_" -ForegroundColor Red
        Write-Host "Query: $($sql.Substring(0, [Math]::Min(200, $sql.Length)))" -ForegroundColor Yellow
        throw
    }
}

function Sql-Str($val) {
    if (-not $val -or $val.Trim() -eq '') { return 'NULL' }
    $escaped = $val.Trim() -replace "'", "''"
    return "'$escaped'"
}

function Format-Title($raw) {
    if (-not $raw) { return $null }
    # Strip " on Monday, January 1st, 2019" suffix
    $t = $raw -replace '\s+on\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),.+$', ''
    # Decode HTML entities
    $t = $t -replace '&amp;', '&'
    $t = $t -replace '&#39;', "'"
    $t = $t -replace '&quot;', '"'
    return $t.Trim()
}

function First-Value($raw) {
    # Given a field that may contain multiple comma/newline-separated values, return the first clean one
    if (-not $raw -or $raw.Trim() -eq '') { return $null }
    $val = ($raw -split "`n")[0]          # first line
    $val = ($val -split ',')[0]            # first comma-part
    $val = $val -replace '&amp;', '&'
    $val = $val.Trim()
    if ($val -eq '') { return $null }
    return $val
}

# --- Parse source CSVs ---
Write-Host "Loading VSCO jobs..." -ForegroundColor Cyan
$vsco = Import-Csv $vscoPath
Write-Host "  $($vsco.Count) rows"

Write-Host "Loading Tave anniversary data..." -ForegroundColor Cyan
$tave = Import-Csv $tavePath
Write-Host "  $($tave.Count) rows"

# --- Build deduplicated event map (keyed by job_id) ---
$events = @{}

foreach ($row in $vsco) {
    $id = $row.'ID'
    if (-not $id) { continue }
    if (-not $row.'Job Date' -or $row.'Job Date'.Trim() -eq '') { continue }
    $venue = First-Value ($row.'Contacts with Role: Venue(JR)')
    if (-not $venue) { $venue = First-Value $row.'Primary Session Location Name' }
    if (-not $venue) { $venue = First-Value ($row.'Contacts with Role: Ceremony Loc(J/R)') }
    $events[$id] = @{
        id     = $id
        title  = Format-Title $row.'Job Name'
        date   = $row.'Job Date'
        venue  = $venue
        source = 'vsco'
    }
}

foreach ($row in $tave) {
    $id = $row.'ID'
    if (-not $id) { continue }
    if (-not $row.'Job Date' -or $row.'Job Date'.Trim() -eq '') { continue }
    $venue = First-Value ($row.'Contacts with Role: Venue(JR)')
    if (-not $venue) { $venue = First-Value ($row.'Contacts with Role: Ceremony Loc(J/R)') }
    $title = Format-Title $row.'Job Name'

    if ($events.ContainsKey($id)) {
        # Already from VSCO — merge venue if VSCO was missing it
        if (-not $events[$id].venue -and $venue) { $events[$id].venue = $venue }
        $events[$id].source = 'vsco+tave'
    } else {
        $events[$id] = @{
            id     = $id
            title  = $title
            date   = $row.'Job Date'
            venue  = $venue
            source = 'tave'
        }
    }
}

Write-Host "Unique events in source data: $($events.Count)" -ForegroundColor Cyan

# --- Filter out events already in DB ---
Write-Host "Checking existing events in database..."
$existingRaw = Invoke-Sql "SELECT tave_job_id FROM events WHERE tave_job_id IS NOT NULL"
$existing = @{}
foreach ($r in $existingRaw) { $existing[$r.tave_job_id] = $true }
Write-Host "  Already imported: $($existing.Count)"

$toImport = $events.Values | Where-Object { -not $existing[$_.id] }
Write-Host "  New events to import: $($toImport.Count)" -ForegroundColor Green

if ($toImport.Count -eq 0) {
    Write-Host "Nothing new to import." -ForegroundColor Yellow
} else {
    # --- Insert events in batches of 50 ---
    $list = @($toImport)
    $batchSize = 50
    $totalInserted = 0

    for ($i = 0; $i -lt $list.Count; $i += $batchSize) {
        $end = [Math]::Min($i + $batchSize - 1, $list.Count - 1)
        $batch = $list[$i..$end]

        $vals = $batch | ForEach-Object {
            $t  = Sql-Str $_.title
            $d  = Sql-Str $_.date
            $v  = Sql-Str $_.venue
            $s  = Sql-Str $_.source
            $jid = Sql-Str $_.id
            "($t, $d, $v, $s, $jid)"
        }

        $sql = "INSERT INTO events (title, date, venue_name, import_source, tave_job_id) VALUES " +
               ($vals -join ',') +
               " ON CONFLICT (tave_job_id) WHERE tave_job_id IS NOT NULL DO NOTHING RETURNING id"

        $inserted = Invoke-Sql $sql
        $n = if ($inserted -is [array]) { $inserted.Count } else { if ($inserted) { 1 } else { 0 } }
        $totalInserted += $n

        $pct = [Math]::Round(($i + $batch.Count) / $list.Count * 100)
        Write-Host "  [$pct%] Batch $([Math]::Floor($i/$batchSize)+1): +$n events (total: $totalInserted)"
    }

    Write-Host "Events inserted: $totalInserted" -ForegroundColor Green
}

# --- Planner linking ---
Write-Host ""
Write-Host "Linking planners to events..." -ForegroundColor Cyan

# Load approved clusters and their source_events
$clusters = Invoke-Sql "SELECT id, source_events FROM import_planner_clusters WHERE status = 'approved'"
Write-Host "  Approved clusters: $($clusters.Count)"

# Build reverse map: job_id -> list of cluster IDs
$jobToCluster = @{}
foreach ($c in $clusters) {
    $srcEvents = $c.source_events
    if ($srcEvents -is [string]) { $srcEvents = $srcEvents | ConvertFrom-Json }
    foreach ($ev in $srcEvents) {
        $jid = $ev.PSObject.Properties['job_id']?.Value
        if ($jid) {
            if (-not $jobToCluster.ContainsKey($jid)) { $jobToCluster[$jid] = [System.Collections.Generic.List[string]]::new() }
            $jobToCluster[$jid].Add($c.id)
        }
    }
}
Write-Host "  Events with planner associations: $($jobToCluster.Count)"

# Load contacts for each approved cluster
$clusterContacts = Invoke-Sql "SELECT id, import_source FROM contacts WHERE import_source LIKE 'cluster:%'"
$clusterToContact = @{}
foreach ($c in $clusterContacts) {
    $cid = $c.import_source -replace '^cluster:', ''
    $clusterToContact[$cid] = $c.id
}
Write-Host "  Cluster contacts found: $($clusterToContact.Count)"

# Load all imported event IDs (covers both newly inserted and pre-existing)
Write-Host "  Loading event IDs for planner linking..."
$allJobIds = @($events.Keys)
$jobToEvent = @{}
$idBatchSize = 200

for ($i = 0; $i -lt $allJobIds.Count; $i += $idBatchSize) {
    $end = [Math]::Min($i + $idBatchSize - 1, $allJobIds.Count - 1)
    $batch = $allJobIds[$i..$end]
    $inClause = ($batch | ForEach-Object { "'$_'" }) -join ','
    $rows = Invoke-Sql "SELECT id, tave_job_id FROM events WHERE tave_job_id IN ($inClause)"
    foreach ($r in $rows) { $jobToEvent[$r.tave_job_id] = $r.id }
}
Write-Host "  Events matched in DB: $($jobToEvent.Count)"

# Build event_contacts link list
$links = [System.Collections.Generic.List[hashtable]]::new()
foreach ($jid in $jobToCluster.Keys) {
    $eventId = $jobToEvent[$jid]
    if (-not $eventId) { continue }
    foreach ($clusterId in $jobToCluster[$jid]) {
        $contactId = $clusterToContact[$clusterId]
        if ($contactId) {
            $links.Add(@{ eventId = $eventId; contactId = $contactId })
        }
    }
}
Write-Host "  Planner links to create: $($links.Count)"

if ($links.Count -gt 0) {
    $linkList = @($links)
    $linkBatch = 100
    $totalLinks = 0

    for ($i = 0; $i -lt $linkList.Count; $i += $linkBatch) {
        $end = [Math]::Min($i + $linkBatch - 1, $linkList.Count - 1)
        $batch = $linkList[$i..$end]
        $vals = $batch | ForEach-Object { "('$($_.eventId)', '$($_.contactId)', 'planner')" }
        $sql = "INSERT INTO event_contacts (event_id, contact_id, role) VALUES " +
               ($vals -join ',') +
               " ON CONFLICT DO NOTHING RETURNING event_id"
        $inserted = Invoke-Sql $sql
        $n = if ($inserted -is [array]) { $inserted.Count } else { if ($inserted) { 1 } else { 0 } }
        $totalLinks += $n
    }
    Write-Host "  Planner links created: $totalLinks" -ForegroundColor Green
}

# --- Summary ---
Write-Host ""
$finalCount = (Invoke-Sql "SELECT COUNT(*) as n FROM events")[0].n
Write-Host "Done. Total events in database: $finalCount" -ForegroundColor Green
