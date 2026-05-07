
# Rebuild planner_events_map with venue, source file, and field context
# Then update all source_events in the DB

Get-Content "$PSScriptRoot/../.env.local" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.+)$') { [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) }
}
$token = $env:SUPABASE_ACCESS_TOKEN; $ref = $env:SUPABASE_PROJECT_REF
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

Add-Type -AssemblyName System.Web

function Decode($s) { [System.Web.HttpUtility]::HtmlDecode($s) }
function NormCo($s) {
    $s = Decode $s
    $s = $s -replace '@\S+', '' -replace '\bX\b', '' -replace '\(.*?\)', ''
    $s = ($s -split ',')[0]
    $s = $s.Trim(' -')
    return $s
}

$vsco = Import-Csv "$PSScriptRoot/../data/vsco_jobs_raw.csv"
$tave = Import-Csv "$PSScriptRoot/../data/tave_anniversary_raw.csv"

$byPlanner = @{}

function GetJobId($row) {
    foreach ($fieldName in @('Job #', 'Job ID', 'Job Id', 'Job Number', 'ID', 'Job id')) {
        if ($row.PSObject.Properties.Name -contains $fieldName -and $row.$fieldName) {
            return ($row.$fieldName).Trim()
        }
    }
    return $null
}

function AddEvent($firmKey, $rawCo, $couple, $date, $venue, $source, $field, $jobId) {
    if (-not $firmKey -or $firmKey.Length -lt 2) { return }
    if (-not $byPlanner.ContainsKey($firmKey)) {
        $byPlanner[$firmKey] = @{ individuals = @{}; events = @() }
    }
    $byPlanner[$firmKey].events += @{
        raw_co  = (Decode $rawCo)
        couple  = (Decode $couple)
        date    = $date
        venue   = (Decode $venue)
        source  = $source
        field   = $field
        job_id  = $jobId
    }
}

function ExtractIndividuals($rawCo, $plannerContact, $firmKey) {
    # Individuals from comma-separated parts after firm name
    $parts = (Decode $rawCo) -split ',' | Select-Object -Skip 1 | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_.Length -gt 2 }
    foreach ($p in $parts) {
        $p = $p -replace '@\S+', '' -replace '\bX\b', '' -replace '\(.*?\)', '' | ForEach-Object { $_.Trim() }
        if ($p -and $p.Length -gt 2) { $byPlanner[$firmKey].individuals[$p] = ($byPlanner[$firmKey].individuals[$p] ?? 0) + 1 }
    }
    # Individuals from planner contact field
    if ($plannerContact) {
        $contacts = (Decode $plannerContact) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_.Length -gt 2 }
        foreach ($c in $contacts) {
            $c = $c -replace '@\S+', '' -replace '\bX\b', '' | ForEach-Object { $_.Trim() }
            if ($c -and $c.Length -gt 2) { $byPlanner[$firmKey].individuals[$c] = ($byPlanner[$firmKey].individuals[$c] ?? 0) + 1 }
        }
    }
}

# Process VSCO
$coCol = "Contacts with Role: Planner'sCo(J/R)"
$pcCol = "Contacts with Role: Planner-Contact"
$venueCol = "Primary Session Location Name"

foreach ($row in $vsco) {
    $couple = $row.'Job Name'
    $date   = $row.'Job Date'
    $venue  = $row.$venueCol
    $jobId  = GetJobId $row

    $rawCo = $row.$coCol
    if ($rawCo -and $rawCo.Trim() -and $rawCo.Trim() -ne 'Unknown Person') {
        $firmKey = NormCo $rawCo
        if ($firmKey.Length -gt 1) {
            AddEvent $firmKey $rawCo $couple $date $venue 'vsco' 'planners_co' $jobId
            ExtractIndividuals $rawCo $row.$pcCol $firmKey
        }
    }

    $pc = $row.$pcCol
    if ($pc -and $pc.Trim() -and $pc.Trim() -ne 'Unknown Person') {
        # Only add contact field entries if no company was listed
        if (-not $rawCo -or $rawCo.Trim() -eq '' -or $rawCo.Trim() -eq 'Unknown Person') {
            $contacts = (Decode $pc) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_.Length -gt 2 }
            foreach ($c in $contacts) {
                $cKey = $c -replace '@\S+', '' -replace '\bX\b', '' | ForEach-Object { $_.Trim() }
                if ($cKey.Length -gt 1) {
                    AddEvent $cKey $c $couple $date $venue 'vsco' 'planner_contact' $jobId
                }
            }
        }
    }
}

# Process Tave
$taveCoCol = "Contacts with Role: Planner'sCo(J/R)"
$tavePcCol = "Contacts with Role: Planner-Contact"
$taveVenueCol = "Contacts with Role: Venue(JR)"

foreach ($row in $tave) {
    $couple = $row.'Job Name'
    $date   = $row.'Job Date'
    $venue  = $row.$taveVenueCol
    $jobId  = GetJobId $row

    $rawCo = $row.$taveCoCol
    if ($rawCo -and $rawCo.Trim() -and $rawCo.Trim() -ne 'Unknown Person') {
        $firmKey = NormCo $rawCo
        if ($firmKey.Length -gt 1) {
            AddEvent $firmKey $rawCo $couple $date $venue 'tave' 'planners_co' $jobId
            ExtractIndividuals $rawCo $row.$tavePcCol $firmKey
        }
    }
}

Write-Host "Firms found: $($byPlanner.Count)"
$byPlanner | ConvertTo-Json -Depth 6 | Out-File "$PSScriptRoot/../data/planner_events_map.json" -Encoding utf8
Write-Host "Saved to data/planner_events_map.json"

# Now update source_events in the DB for all clusters
Write-Host "`nFetching all clusters from DB..."
$body = @{ query = "SELECT id, proposed_name, canonical_name, raw_strings FROM import_planner_clusters;" } | ConvertTo-Json
$clusters = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Method POST -Headers $headers -Body $body
Write-Host "Found $($clusters.Count) clusters"

function Normalize-Name($name) {
    if (-not $name) { return "" }
    return $name.ToLower().Trim() -replace '&amp;', '&' -replace '\s+', ' '
}

function Find-MapEntry($cluster) {
    $attempts = @()
    if ($cluster.canonical_name) { $attempts += $cluster.canonical_name }
    if ($cluster.proposed_name) { $attempts += $cluster.proposed_name }
    foreach ($rs in $cluster.raw_strings) { $attempts += $rs }

    foreach ($attempt in $attempts) {
        $norm = Normalize-Name $attempt
        $norm = $norm -replace '\s*@\S+\s*$', '' -replace '\s*x$', '' -replace '\s*\(.*\)\s*$', '' -replace '\s*,.*$', ''
        $norm = $norm.Trim()
        if ($byPlanner.ContainsKey($norm)) { return $byPlanner[$norm] }
        # Also try case-insensitive key lookup
        $match = $byPlanner.Keys | Where-Object { $_.ToLower() -eq $norm } | Select-Object -First 1
        if ($match) { return $byPlanner[$match] }
    }
    return $null
}

$updateCount = 0
$batchSql = ""

foreach ($cluster in $clusters) {
    $entry = Find-MapEntry $cluster
    if ($entry) {
        $seJson = ($entry.events | ConvertTo-Json -Depth 5 -Compress).Replace("'", "''")
        if ($entry.events.Count -eq 1) {
            # Wrap single event in array
            $seJson = "[$seJson]"
        }
        $batchSql += "UPDATE import_planner_clusters SET source_events = '$seJson'::jsonb WHERE id = '$($cluster.id)'; "
        $updateCount++
    }
}

if ($updateCount -gt 0) {
    Write-Host "Updating $updateCount clusters..."
    # Split into batches of 20 statements
    $statements = $batchSql -split '; ' | Where-Object { $_ }
    for ($i = 0; $i -lt $statements.Count; $i += 20) {
        $batch = ($statements[$i..[Math]::Min($i+19, $statements.Count-1)] -join '; ') + ';'
        $body = @{ query = $batch } | ConvertTo-Json -Depth 5
        try {
            Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Method POST -Headers $headers -Body $body | Out-Null
            Write-Host "  Updated batch ending at $([Math]::Min($i+20, $statements.Count))..."
        } catch {
            Write-Host "  Batch error: $_"
        }
        Start-Sleep -Milliseconds 300
    }
}

Write-Host "`nDone! Updated $updateCount cluster source_events with venue data."
