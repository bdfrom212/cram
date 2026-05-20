# run-vsco-sync.ps1
# Pulls new booked/fulfillment/completed jobs from VSCO Workspace API and syncs
# them as events + contacts. Skips leads. Safe to re-run — ON CONFLICT DO NOTHING.

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path $PSScriptRoot -Parent
$envFile     = Join-Path $projectRoot '.env.local'

# --- Load .env.local ---
$envMap = @{}
Get-Content $envFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    $envMap[$k.Trim()] = $v.Trim().Trim('"')
}

$VSCO_KEY = $envMap['VSCO_API_KEY']
$TOKEN    = $envMap['SUPABASE_ACCESS_TOKEN']
$REF      = $envMap['SUPABASE_PROJECT_REF']

if (-not $VSCO_KEY) { Write-Error "VSCO_API_KEY not found in .env.local"; exit 1 }
if (-not $TOKEN -or -not $REF) { Write-Error "Supabase credentials not found in .env.local"; exit 1 }

$VSCO_BASE    = 'https://workspace.vsco.co/api/v2'
$VSCO_HEADERS = @{ 'X-API-KEY' = $VSCO_KEY; 'Accept' = 'application/json' }

# --- Helpers ---
function Invoke-Sql($sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Compress -Depth 5
    try {
        return Invoke-RestMethod `
            -Uri "https://api.supabase.com/v1/projects/$REF/database/query" `
            -Method POST `
            -Headers @{ Authorization = "Bearer $TOKEN"; 'Content-Type' = 'application/json' } `
            -Body $body
    } catch {
        Write-Host "SQL error: $_" -ForegroundColor Red
        Write-Host "Query: $($sql.Substring(0, [Math]::Min(300, $sql.Length)))" -ForegroundColor Yellow
        throw
    }
}

function Lit($val) {
    if ($null -eq $val -or $val -eq '') { return 'NULL' }
    $escaped = ([string]$val).Trim() -replace "'", "''"
    return "'$escaped'"
}

function Invoke-Vsco($path) {
    try {
        return Invoke-RestMethod -Uri "$VSCO_BASE$path" -Headers $VSCO_HEADERS -Method GET
    } catch {
        $status = $_.Exception.Response?.StatusCode?.value__
        Write-Host "  VSCO API error ($path) — $status : $_" -ForegroundColor Yellow
        return $null
    }
}

function Str($val) { if ($null -eq $val) { return '' }; return ([string]$val).Trim() }

function Extract-TaveId($managerHref) {
    if (-not $managerHref) { return $null }
    if ($managerHref -match '/jobs/view/(\d+)') { return $matches[1] }
    return $null
}

function Map-Role($roleKinds) {
    if (-not $roleKinds) { return 'vendor' }
    if ($roleKinds -contains 'client')  { return 'client' }
    if ($roleKinds -contains 'planner') { return 'planner' }
    return 'vendor'
}

# --- Ensure partial unique index for vsco: contact import_source ---
Write-Host "Ensuring schema..." -ForegroundColor Cyan
Invoke-Sql "CREATE UNIQUE INDEX IF NOT EXISTS contacts_vsco_src_idx ON contacts (import_source) WHERE import_source LIKE 'vsco:%';" | Out-Null
Write-Host "  Index ready."

# --- Step 1: Fetch all VSCO jobs (paginated) ---
Write-Host ""
Write-Host "Fetching VSCO jobs..." -ForegroundColor Cyan
$allJobs  = [System.Collections.Generic.List[object]]::new()
$skipStages = @('lead', 'inquiry')
$page     = 1
$perPage  = 100

do {
    $resp = Invoke-Vsco "/job?page=$page&perPage=$perPage"
    if (-not $resp -or -not $resp.items) { break }

    $jobs = @($resp.items)
    foreach ($job in $jobs) {
        if ($skipStages -contains $job.stage) { continue }
        $allJobs.Add($job)
    }

    $total = $resp.meta.totalItems
    Write-Host "  Page $page — kept $($allJobs.Count) of $total total" -ForegroundColor Gray

    if ($jobs.Count -lt $perPage) { break }
    $page++
    Start-Sleep -Milliseconds 200
} while ($true)

Write-Host "  Non-lead VSCO jobs: $($allJobs.Count)" -ForegroundColor Green

# --- Step 2: Diff against DB ---
Write-Host ""
Write-Host "Checking database for new jobs..." -ForegroundColor Cyan
$existingRows = Invoke-Sql "SELECT tave_job_id FROM events WHERE tave_job_id IS NOT NULL"
$existingIds  = @{}
foreach ($r in $existingRows) { $existingIds[$r.tave_job_id] = $true }
Write-Host "  Events already in DB: $($existingIds.Count)"

$newJobs = [System.Collections.Generic.List[object]]::new()
$noTaveId = 0
foreach ($job in $allJobs) {
    $taveId = Extract-TaveId ($job.links?.self?.managerHref)
    if (-not $taveId) { $noTaveId++; continue }
    if (-not $existingIds[$taveId]) { $newJobs.Add($job) }
}

Write-Host "  New jobs to sync: $($newJobs.Count)" -ForegroundColor $(if ($newJobs.Count -gt 0) { 'Green' } else { 'Yellow' })
if ($noTaveId -gt 0) { Write-Host "  Skipped (no tave_job_id): $noTaveId" -ForegroundColor Gray }

if ($newJobs.Count -eq 0) {
    Write-Host ""
    Write-Host "Already up to date — no new jobs." -ForegroundColor Yellow
    exit 0
}

# --- Step 3: Fetch event details + contacts for each new job ---
Write-Host ""
Write-Host "Fetching details for $($newJobs.Count) new jobs..." -ForegroundColor Cyan

$eventRows   = [System.Collections.Generic.List[hashtable]]::new()
$contactMap  = @{}   # vscoContactId -> contact details hash
$linkQueue   = [System.Collections.Generic.List[hashtable]]::new()  # {vscoId, cid, role}

$done = 0
foreach ($job in $newJobs) {
    $done++
    $taveId  = Extract-TaveId ($job.links?.self?.managerHref)
    $vscoId  = $job.id
    $pct     = [Math]::Round($done / $newJobs.Count * 100)
    Write-Host "  [$pct%] $($job.name)" -ForegroundColor Gray

    # Venue from primary session event (uses session ID, not job ULID)
    $venueName = $null; $venueCity = $null; $venueState = $null
    $primarySessionHref = $job.links?.primarySessionId?.href
    if ($primarySessionHref -match '/event/([^/]+)$') {
        $evResp = Invoke-Vsco "/event/$($matches[1])"
        if ($evResp -and $evResp.location) {
            $loc = $evResp.location.address
            if ($loc) {
                $venueName  = $loc.name
                $venueCity  = $loc.city
                $venueState = $loc.state
            }
        }
    }

    # Job contacts
    $jcResp = Invoke-Vsco "/job-contact?jobId=$vscoId"
    if ($jcResp -and $jcResp.items) {
        foreach ($jc in @($jcResp.items)) {
            $cid = $jc.contactId
            if (-not $cid) { continue }
            $role = Map-Role $jc.roleKinds
            $linkQueue.Add(@{ vscoId = $vscoId; cid = $cid; role = $role })

            if (-not $contactMap.ContainsKey($cid)) {
                $ab = Invoke-Vsco "/address-book/$cid"
                if ($ab) {
                    $name = Str $ab.name
                    if (-not $name) {
                        $parts = @((Str $ab.firstName), (Str $ab.lastName)) | Where-Object { $_ }
                        $name  = $parts -join ' '
                    }
                    $contactMap[$cid] = @{
                        name         = $name
                        email        = Str $ab.email
                        company      = Str $ab.companyName
                        importSource = "vsco:$cid"
                    }
                }
                Start-Sleep -Milliseconds 100
            }
        }
    }

    $eventRows.Add(@{
        vscoId     = $vscoId
        taveId     = $taveId
        name       = $job.name
        date       = $job.eventDate
        venueName  = $venueName
        venueCity  = $venueCity
        venueState = $venueState
    })

    Start-Sleep -Milliseconds 150
}

Write-Host "  Fetched. Unique contacts found: $($contactMap.Count)"

# --- Step 4: Insert events ---
Write-Host ""
Write-Host "Inserting events..." -ForegroundColor Cyan

$totalEventsInserted = 0
$evList = @($eventRows)

for ($i = 0; $i -lt $evList.Count; $i += 50) {
    $end   = [Math]::Min($i + 49, $evList.Count - 1)
    $batch = $evList[$i..$end]

    $vals = $batch | ForEach-Object {
        $t   = Lit $_.name
        $d   = Lit $_.date
        $vn  = Lit $_.venueName
        $vc  = Lit $_.venueCity
        $vs  = Lit $_.venueState
        $tid = Lit $_.taveId
        "($t, $d, $vn, $vc, $vs, $tid, 'vsco')"
    }

    $sql = "INSERT INTO events (title, date, venue_name, venue_city, venue_state, tave_job_id, import_source) VALUES " +
           ($vals -join ',') +
           " ON CONFLICT (tave_job_id) WHERE tave_job_id IS NOT NULL DO NOTHING RETURNING id, tave_job_id"

    $inserted = Invoke-Sql $sql
    $n = if ($inserted -is [array]) { $inserted.Count } elseif ($inserted) { 1 } else { 0 }
    $totalEventsInserted += $n
}

Write-Host "  Events inserted: $totalEventsInserted" -ForegroundColor Green

# Resolve vscoId -> DB UUID via taveId
Write-Host "  Resolving event UUIDs for contact linking..."
$taveIdsToResolve = @($evList | Where-Object { $_.taveId } | ForEach-Object { $_.taveId })
$vscoIdToDbUuid   = @{}

if ($taveIdsToResolve.Count -gt 0) {
    $inClause = ($taveIdsToResolve | ForEach-Object { "'$_'" }) -join ','
    $rows = Invoke-Sql "SELECT id, tave_job_id FROM events WHERE tave_job_id IN ($inClause)"
    $taveToUuid = @{}
    foreach ($r in $rows) { $taveToUuid[$r.tave_job_id] = $r.id }

    foreach ($ev in $evList) {
        if ($ev.taveId -and $taveToUuid[$ev.taveId]) {
            $vscoIdToDbUuid[$ev.vscoId] = $taveToUuid[$ev.taveId]
        }
    }
}
Write-Host "  Events resolved: $($vscoIdToDbUuid.Count)"

# --- Step 5: Upsert contacts ---
Write-Host ""
Write-Host "Inserting contacts..." -ForegroundColor Cyan

$contactList          = @($contactMap.Keys | ForEach-Object { $contactMap[$_] })
$totalContactsInserted = 0
$contactIdMap         = @{}   # import_source -> DB UUID

for ($i = 0; $i -lt $contactList.Count; $i += 50) {
    $end   = [Math]::Min($i + 49, $contactList.Count - 1)
    $batch = $contactList[$i..$end]

    $vals = $batch | ForEach-Object {
        $n   = Lit $_.name
        $e   = Lit $_.email
        $c   = Lit $_.company
        $src = Lit $_.importSource
        "($n, $e, $c, $src)"
    }

    $sql = "INSERT INTO contacts (name, email, company, import_source) VALUES " +
           ($vals -join ',') +
           " ON CONFLICT (import_source) WHERE import_source LIKE 'vsco:%' DO NOTHING RETURNING id, import_source"

    $inserted = Invoke-Sql $sql
    if ($inserted -is [array]) {
        foreach ($r in $inserted) { $contactIdMap[$r.import_source] = $r.id; $totalContactsInserted++ }
    } elseif ($inserted) {
        $contactIdMap[$inserted.import_source] = $inserted.id; $totalContactsInserted++
    }
    Start-Sleep -Milliseconds 200
}

Write-Host "  Contacts inserted: $totalContactsInserted" -ForegroundColor Green

# Resolve previously-existing vsco: contacts (re-run scenario)
$existingContacts = Invoke-Sql "SELECT id, import_source FROM contacts WHERE import_source LIKE 'vsco:%'"
foreach ($r in $existingContacts) {
    if (-not $contactIdMap.ContainsKey($r.import_source)) {
        $contactIdMap[$r.import_source] = $r.id
    }
}

# --- Step 6: Link contacts to events ---
Write-Host ""
Write-Host "Linking contacts to events..." -ForegroundColor Cyan

$links = [System.Collections.Generic.List[hashtable]]::new()
foreach ($link in $linkQueue) {
    $dbEventId   = $vscoIdToDbUuid[$link.vscoId]
    $dbContactId = $contactIdMap["vsco:$($link.cid)"]
    if (-not $dbEventId -or -not $dbContactId) { continue }
    $links.Add(@{ eid = $dbEventId; cid = $dbContactId; role = $link.role })
}

Write-Host "  Links to insert: $($links.Count)"
$totalLinksInserted = 0
$linkArr = @($links)

for ($i = 0; $i -lt $linkArr.Count; $i += 100) {
    $end   = [Math]::Min($i + 99, $linkArr.Count - 1)
    $batch = $linkArr[$i..$end]
    $vals  = $batch | ForEach-Object { "('$($_.eid)', '$($_.cid)', '$($_.role)')" }
    $sql   = "INSERT INTO event_contacts (event_id, contact_id, role) VALUES " +
             ($vals -join ',') +
             " ON CONFLICT DO NOTHING RETURNING event_id"
    $inserted = Invoke-Sql $sql
    $n = if ($inserted -is [array]) { $inserted.Count } elseif ($inserted) { 1 } else { 0 }
    $totalLinksInserted += $n
}

Write-Host "  Links created: $totalLinksInserted" -ForegroundColor Green

# --- Summary ---
Write-Host ""
$finalCount = (Invoke-Sql "SELECT COUNT(*) as n FROM events")[0].n
Write-Host "=== VSCO Sync Complete ===" -ForegroundColor Green
Write-Host "  New events added:   $totalEventsInserted"
Write-Host "  New contacts added: $totalContactsInserted"
Write-Host "  Contact links set:  $totalLinksInserted"
Write-Host "  Total events in DB: $finalCount"
