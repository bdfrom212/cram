# run-vsco-backfill-contacts.ps1
# For the 603 events already in the DB (imported from CSV), fetches VSCO job
# contacts and links them. Skips events that already have client/vendor contacts.
# Safe to re-run.

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
    if ($null -eq $val -or ([string]$val).Trim() -eq '') { return 'NULL' }
    $escaped = ([string]$val).Trim() -replace "'", "''"
    return "'$escaped'"
}

function Invoke-Vsco($path) {
    $delays = @(2000, 5000, 10000)
    foreach ($delay in $delays) {
        try {
            return Invoke-RestMethod -Uri "$VSCO_BASE$path" -Headers $VSCO_HEADERS -Method GET
        } catch {
            $status = $_.Exception.Response?.StatusCode?.value__
            if ($status -eq 429) {
                Write-Host "  429 on $path — retrying in $($delay/1000)s" -ForegroundColor Yellow
                Start-Sleep -Milliseconds $delay
            } else {
                Write-Host "  VSCO error ($path) — HTTP $status" -ForegroundColor Yellow
                return $null
            }
        }
    }
    Write-Host "  Giving up on $path after retries" -ForegroundColor Red
    return $null
}

function Extract-TaveId($managerHref) {
    if (-not $managerHref) { return $null }
    if ($managerHref -match '/jobs/view/(\d+)') { return $matches[1] }
    return $null
}

function Map-Role($roleKinds) {
    if (-not $roleKinds) { return 'vendor' }
    if ($roleKinds -contains 'client')      { return 'client' }
    if ($roleKinds -contains 'planner')     { return 'planner' }
    if ($roleKinds -contains 'coordinator') { return 'coordinator' }
    return 'vendor'
}

function Str($val) { if ($null -eq $val) { return '' }; return ([string]$val).Trim() }

function Get-DisplayName($c) {
    $name = Str $c.name
    if ($name) { return $name }
    $parts = @((Str $c.firstName), (Str $c.lastName)) | Where-Object { $_ }
    if ($parts.Count -gt 0) { return ($parts -join ' ') }
    return $null
}

function Get-Phone($c) {
    foreach ($field in @($c.cellPhone, $c.workPhone, $c.homePhone)) {
        if ($null -eq $field) { continue }
        # VSCO returns phone as an object with e164/formatted; fall back to plain string
        $val = Str $field.e164
        if (-not $val) { $val = Str $field.formatted }
        if (-not $val) { $val = Str $field }
        if ($val -and $val -notlike '@{*') { return $val }
    }
    return $null
}

function Get-Instagram($c) {
    foreach ($acct in @($c.chatAccount1, $c.chatAccount2, $c.chatAccount3)) {
        if ($acct -and (Str $acct.service) -eq 'instagram') {
            $handle = (Str $acct.identity).TrimStart('@')
            if ($handle) { return "@$handle" }
        }
    }
    return $null
}

# --- Step 1: Load DB events that have a tave_job_id ---
Write-Host "Loading existing events from DB..." -ForegroundColor Cyan
$dbEvents = Invoke-Sql "SELECT id, tave_job_id FROM events WHERE tave_job_id IS NOT NULL"
$taveToDbId = @{}
foreach ($r in $dbEvents) { $taveToDbId[$r.tave_job_id] = $r.id }
Write-Host "  Events with tave_job_id: $($taveToDbId.Count)"

# --- Step 2: Find which events already have client/vendor contacts ---
Write-Host ""
Write-Host "Finding events that already have client or vendor contacts..." -ForegroundColor Cyan
$alreadyLinked = Invoke-Sql @"
SELECT DISTINCT event_id FROM event_contacts WHERE role IN ('client', 'vendor', 'coordinator')
"@
$alreadyLinkedIds = @{}
foreach ($r in $alreadyLinked) { $alreadyLinkedIds[$r.event_id] = $true }
Write-Host "  Already have client/vendor contacts: $($alreadyLinkedIds.Count)"

$needsBackfill = @{}
foreach ($taveId in $taveToDbId.Keys) {
    $dbId = $taveToDbId[$taveId]
    if (-not $alreadyLinkedIds[$dbId]) { $needsBackfill[$taveId] = $dbId }
}
Write-Host "  Need backfill: $($needsBackfill.Count)" -ForegroundColor Green

if ($needsBackfill.Count -eq 0) {
    Write-Host "All events already have contacts linked. Nothing to do." -ForegroundColor Yellow
    exit 0
}

# --- Step 3: Page through VSCO jobs to get vsco job.id for each tave_job_id ---
Write-Host ""
Write-Host "Fetching VSCO job list to resolve vsco IDs..." -ForegroundColor Cyan
$vscoIdForTave = @{}   # tave_job_id -> vsco job.id
$skipStages = @('lead', 'inquiry')
$page = 1

do {
    $resp = Invoke-Vsco "/job?page=$page&perPage=100"
    if (-not $resp -or -not $resp.items) { break }

    foreach ($job in @($resp.items)) {
        if ($skipStages -contains $job.stage) { continue }

        # Match by Tave numeric ID extracted from managerHref (primary key in DB)
        $taveId = Extract-TaveId ($job.links?.self?.managerHref)
        if ($taveId -and $needsBackfill.ContainsKey($taveId)) {
            $vscoIdForTave[$taveId] = $job.id
        }
    }

    Write-Host "  Page $page — matched $($vscoIdForTave.Count) of $($needsBackfill.Count)" -ForegroundColor Gray
    if ($resp.items.Count -lt 100) { break }
    $page++
    Start-Sleep -Milliseconds 200
} while ($true)

Write-Host "  Matched: $($vscoIdForTave.Count)" -ForegroundColor Green

if ($vscoIdForTave.Count -eq 0) {
    Write-Host "No VSCO jobs found for events needing backfill." -ForegroundColor Yellow
    exit 0
}

# --- Step 4: Fetch job contacts for each matched event ---
Write-Host ""
Write-Host "Fetching contacts for $($vscoIdForTave.Count) events..." -ForegroundColor Cyan

$contactCache = @{}   # vsco contact id -> contact details hash
$linkQueue    = [System.Collections.Generic.List[hashtable]]::new()
$done = 0

foreach ($taveId in $vscoIdForTave.Keys) {
    $done++
    $vscoId    = $vscoIdForTave[$taveId]
    $dbEventId = $needsBackfill[$taveId]
    $pct       = [Math]::Round($done / $vscoIdForTave.Count * 100)

    $jcResp = Invoke-Vsco "/job-contact?jobId=$vscoId"
    if ($jcResp -and $jcResp.items) {
        foreach ($jc in @($jcResp.items)) {
            $cid = $jc.contactId
            if (-not $cid) { continue }
            $role = Map-Role $jc.roleKinds
            $linkQueue.Add(@{ dbEventId = $dbEventId; vscoContactId = $cid; role = $role })

            if (-not $contactCache.ContainsKey($cid)) {
                $ab = Invoke-Vsco "/address-book/$cid"
                if ($ab) {
                    $name = Get-DisplayName $ab
                    if ($name) {
                        $contactCache[$cid] = @{
                            name         = $name
                            email        = $ab.email
                            phone        = Get-Phone $ab
                            instagram    = Get-Instagram $ab
                            company      = $ab.companyName
                            importSource = "vsco:$cid"
                        }
                    }
                }
                Start-Sleep -Milliseconds 400
            }
        }
    }

    if ($done % 25 -eq 0 -or $done -eq $vscoIdForTave.Count) {
        Write-Host "  [$pct%] $done / $($vscoIdForTave.Count) jobs · $($contactCache.Count) unique contacts" -ForegroundColor Gray
    }
    Start-Sleep -Milliseconds 500
}

Write-Host "  Unique contacts to import: $($contactCache.Count)" -ForegroundColor Green
Write-Host "  Event-contact links to create: $($linkQueue.Count)"

# --- Step 5: Ensure unique index, then upsert contacts ---
Write-Host ""
Write-Host "Upserting contacts..." -ForegroundColor Cyan
Invoke-Sql "CREATE UNIQUE INDEX IF NOT EXISTS contacts_vsco_src_idx ON contacts (import_source) WHERE import_source LIKE 'vsco:%';" | Out-Null

$contactList          = @($contactCache.Keys | ForEach-Object { $contactCache[$_] })
$contactIdMap         = @{}   # import_source -> db UUID
$totalContactsUpserted = 0

for ($i = 0; $i -lt $contactList.Count; $i += 50) {
    $end   = [Math]::Min($i + 49, $contactList.Count - 1)
    $batch = $contactList[$i..$end]

    $vals = $batch | ForEach-Object {
        $n   = Lit $_.name
        $e   = Lit $_.email
        $p   = Lit $_.phone
        $ig  = Lit $_.instagram
        $co  = Lit $_.company
        $src = Lit $_.importSource
        "($n, $e, $p, $ig, $co, $src)"
    }

    $sql = @"
INSERT INTO contacts (name, email, phone, instagram, company, import_source)
VALUES $($vals -join ',')
ON CONFLICT (import_source) WHERE import_source LIKE 'vsco:%'
DO UPDATE SET
  phone     = EXCLUDED.phone,
  instagram = COALESCE(EXCLUDED.instagram, contacts.instagram),
  email     = COALESCE(EXCLUDED.email, contacts.email),
  company   = COALESCE(EXCLUDED.company, contacts.company)
RETURNING id, import_source
"@

    $result = Invoke-Sql $sql
    if ($result -is [array]) {
        foreach ($r in $result) { $contactIdMap[$r.import_source] = $r.id; $totalContactsUpserted++ }
    } elseif ($result) {
        $contactIdMap[$result.import_source] = $result.id; $totalContactsUpserted++
    }
    Start-Sleep -Milliseconds 150
}

# Resolve any pre-existing vsco: contacts not just inserted
$existingVsco = Invoke-Sql "SELECT id, import_source FROM contacts WHERE import_source LIKE 'vsco:%'"
foreach ($r in $existingVsco) {
    if (-not $contactIdMap.ContainsKey($r.import_source)) {
        $contactIdMap[$r.import_source] = $r.id
    }
}
Write-Host "  Contacts upserted: $totalContactsUpserted" -ForegroundColor Green

# --- Step 6: Link contacts to events ---
Write-Host ""
Write-Host "Linking contacts to events..." -ForegroundColor Cyan

$links        = [System.Collections.Generic.List[hashtable]]::new()
$skippedLinks = 0
foreach ($link in $linkQueue) {
    $dbContactId = $contactIdMap["vsco:$($link.vscoContactId)"]
    if (-not $dbContactId) { $skippedLinks++; continue }
    $links.Add(@{ eid = $link.dbEventId; cid = $dbContactId; role = $link.role })
}

Write-Host "  Links to insert: $($links.Count)$(if ($skippedLinks -gt 0) { " ($skippedLinks skipped — no name in VSCO)" })"
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
$finalContacts = (Invoke-Sql "SELECT COUNT(*) as n FROM contacts")[0].n
$finalLinks    = (Invoke-Sql "SELECT COUNT(*) as n FROM event_contacts")[0].n
Write-Host "=== Backfill Complete ===" -ForegroundColor Green
Write-Host "  Contacts upserted:       $totalContactsUpserted"
Write-Host "  Event-contact links added: $totalLinksInserted"
Write-Host "  Total contacts in DB:    $finalContacts"
Write-Host "  Total event links in DB: $finalLinks"
