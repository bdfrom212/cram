
# Import couples from approved cluster source_events as client contacts.
# Creates one contact per unique couple name, linked to all their events.
# Safe to re-run: deduplicates by import_source = 'couple:{normalized_name}'.

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
    $e = Esc $s
    if ($null -eq $e) { return 'NULL' }
    return "'$e'"
}

function FormatCouple($raw) {
    if (-not $raw) { return $null }
    $s = ($raw -replace '^inq:\s*', '' -replace '\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday).*', '').Trim()
    if ($s.Length -lt 2) { return $null }
    return $s
}

# ---- Schema ----
Write-Host "Ensuring schema..."
Sql "CREATE UNIQUE INDEX IF NOT EXISTS contacts_couple_src_idx ON contacts (import_source) WHERE import_source LIKE 'couple:%';" | Out-Null

# ---- Step 1: Fetch all approved clusters with source_events ----
Write-Host "Fetching clusters..."
$clusters = Sql "SELECT id, source_events FROM import_planner_clusters WHERE status = 'approved' AND source_events IS NOT NULL;"
Write-Host "  $($clusters.Count) clusters"

# ---- Step 2: Build map of eventKey -> couple name ----
Write-Host "Parsing couples from source events..."
$keyToCouple = @{}   # eventKey -> display couple name (first non-null wins)

foreach ($cluster in $clusters) {
    $evts = $cluster.source_events
    if ($evts -isnot [array]) { $evts = @($evts) }

    foreach ($ev in $evts) {
        if (-not $ev.date) { continue }
        $couple = FormatCouple $ev.couple
        if (-not $couple) { continue }

        $jobId = $ev.job_id
        $key   = if ($jobId) { "job:$jobId" } else { "dt:$($ev.date)|$couple" }

        if (-not $keyToCouple.ContainsKey($key)) {
            $keyToCouple[$key] = $couple
        }
    }
}
Write-Host "  $($keyToCouple.Count) event keys with couple names"

# ---- Step 3: Map event keys -> UUIDs ----
Write-Host "Fetching event UUIDs..."
$allEvents  = Sql "SELECT id, tave_job_id, title, date::text FROM events WHERE import_source IN ('vsco','tave');"
$eventIdMap = @{}
foreach ($row in $allEvents) {
    if ($row.tave_job_id) { $eventIdMap["job:$($row.tave_job_id)"] = $row.id }
    else                  { $eventIdMap["dt:$($row.date)|$($row.title)"] = $row.id }
}
Write-Host "  $($eventIdMap.Count) events in DB"

# ---- Step 4: Build couple name -> {displayName, events[]} map ----
$coupleData = @{}   # normalized name -> { display, events }

foreach ($key in $keyToCouple.Keys) {
    $eid    = $eventIdMap[$key]
    if (-not $eid) { continue }

    $display  = $keyToCouple[$key]
    $normName = $display.ToLower().Trim()

    if (-not $coupleData.ContainsKey($normName)) {
        $coupleData[$normName] = @{ display = $display; events = [System.Collections.Generic.List[string]]::new() }
    }
    $coupleData[$normName].events.Add($eid)
}
Write-Host "  $($coupleData.Count) unique couples matched to events"

# ---- Step 5: Insert client contacts ----
Write-Host "Inserting client contacts..."
$contactIdMap = @{}

$normNames = @($coupleData.Keys)
for ($i = 0; $i -lt $normNames.Count; $i += 50) {
    $batch  = $normNames[$i..[Math]::Min($i+49, $normNames.Count-1)]
    $rowSql = ($batch | ForEach-Object {
        $entry = $coupleData[$_]
        $name  = Lit $entry.display
        $src   = Lit "couple:$_"
        "($name, 'client', $src)"
    }) -join ', '

    $sql    = "INSERT INTO contacts (name, role, import_source) VALUES $rowSql ON CONFLICT (import_source) WHERE import_source LIKE 'couple:%' DO NOTHING RETURNING id, import_source;"
    $result = Sql $sql
    foreach ($row in $result) {
        if ($row.import_source -match '^couple:(.+)') { $contactIdMap[$matches[1]] = $row.id }
    }
    Write-Host "  contacts: $([Math]::Min($i+50, $normNames.Count)) / $($normNames.Count)"
    Start-Sleep -Milliseconds 300
}
Write-Host "  $($contactIdMap.Count) new contacts inserted"

# Also fetch previously-inserted ones (re-run scenario)
Write-Host "Resolving existing client contacts..."
$existing = Sql "SELECT id, import_source FROM contacts WHERE import_source LIKE 'couple:%';"
foreach ($row in $existing) {
    if ($row.import_source -match '^couple:(.+)') {
        $normKey = $matches[1]
        if (-not $contactIdMap.ContainsKey($normKey)) {
            $contactIdMap[$normKey] = $row.id
        }
    }
}

# ---- Step 6: Insert event_contacts links ----
Write-Host "Building event-contact links..."
$links = [System.Collections.Generic.List[object]]::new()
foreach ($normName in $coupleData.Keys) {
    $contactId = $contactIdMap[$normName]
    if (-not $contactId) { continue }
    foreach ($eid in $coupleData[$normName].events) {
        $links.Add(@{ eid = $eid; cid = $contactId })
    }
}
Write-Host "  $($links.Count) links to insert"

for ($i = 0; $i -lt $links.Count; $i += 100) {
    $batch  = $links[$i..[Math]::Min($i+99, $links.Count-1)]
    $rowSql = ($batch | ForEach-Object { "('$($_.eid)', '$($_.cid)', 'client')" }) -join ', '
    Sql "INSERT INTO event_contacts (event_id, contact_id, role) VALUES $rowSql ON CONFLICT DO NOTHING;" | Out-Null
    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "=== Client import complete ==="
Write-Host "  Unique couples: $($coupleData.Count)"
Write-Host "  Contacts inserted: $($contactIdMap.Count)"
Write-Host "  Event links: $($links.Count)"
