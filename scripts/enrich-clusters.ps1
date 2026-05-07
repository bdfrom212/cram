
# Enrich import_planner_clusters with source_events and merge missing individuals
# Also creates new clusters for firms found in the events map but not yet in any cluster

# Load from .env.local
$envPath = Join-Path $PSScriptRoot "../.env.local"
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.+)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
    }
}
$token = $env:SUPABASE_ACCESS_TOKEN
$ref = $env:SUPABASE_PROJECT_REF
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$apiBase = "https://api.supabase.com/v1/projects/$ref/database/query"

function Invoke-SQL($sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Depth 20
    return Invoke-RestMethod -Uri $apiBase -Method POST -Headers $headers -Body $body
}

# Load data
$clustersRaw = Get-Content "C:\Users\Studio\projects\cram\data\existing_clusters.json" -Raw | ConvertFrom-Json
$mapRaw = Get-Content "C:\Users\Studio\projects\cram\data\planner_events_map.json" -Raw | ConvertFrom-Json

# Build a lookup from the map (normalized key -> firm name -> data)
$mapLookup = @{}
foreach ($prop in $mapRaw.PSObject.Properties) {
    $key = $prop.Name.ToLower().Trim() -replace '&amp;', '&' -replace '\s+', ' '
    $mapLookup[$key] = @{ name = $prop.Name; data = $prop.Value }
}

function Normalize-Name($name) {
    if (-not $name) { return "" }
    return $name.ToLower().Trim() -replace '&amp;', '&' -replace '\s+', ' '
}

function Find-MapEntry($cluster) {
    # Try canonical_name first, then proposed_name, then each raw_string
    $attempts = @()
    if ($cluster.canonical_name) { $attempts += $cluster.canonical_name }
    if ($cluster.proposed_name) { $attempts += $cluster.proposed_name }
    foreach ($rs in $cluster.raw_strings) { $attempts += $rs }

    foreach ($attempt in $attempts) {
        $norm = Normalize-Name $attempt
        # Strip trailing X (commission flag), instagram handles, parentheticals
        $norm = $norm -replace '\s*@\S+\s*$', '' -replace '\s*x$', '' -replace '\s*\(.*\)\s*$', '' -replace '\s*,.*$', ''
        $norm = $norm.Trim()
        if ($mapLookup.ContainsKey($norm)) {
            return $mapLookup[$norm]
        }
    }
    return $null
}

$matched = 0
$unmatched = 0
$updates = @()

foreach ($cluster in $clustersRaw) {
    $entry = Find-MapEntry $cluster

    if ($entry) {
        $matched++

        # Build source_events list
        $sourceEvents = @()
        foreach ($ev in $entry.data.events) {
            $sourceEvents += @{
                raw_co = $ev.raw_co
                couple = $ev.couple
                date   = $ev.date
            }
        }

        # Merge individuals: keep Brian's entries, add any from map not already present
        $existingInds = if ($cluster.individuals) { @($cluster.individuals | ForEach-Object { $_.ToLower().Trim() }) } else { @() }
        $newInds = @($cluster.individuals)  # start with Brian's list

        foreach ($indProp in $entry.data.individuals.PSObject.Properties) {
            $indName = $indProp.Name
            $indNorm = $indName.ToLower().Trim()
            # Check if already in Brian's list (fuzzy: first name match is good enough)
            $firstName = ($indName -split '\s+')[0].ToLower()
            $alreadyHave = $existingInds | Where-Object { $_ -like "*$firstName*" }
            if (-not $alreadyHave) {
                $newInds += $indName
            }
        }

        $updates += @{
            id           = $cluster.id
            source_events = $sourceEvents
            individuals  = $newInds
        }
    } else {
        $unmatched++
        Write-Host "  UNMATCHED: $($cluster.canonical_name ?? $cluster.proposed_name)"
    }
}

Write-Host "`nMatched: $matched / $($clustersRaw.Count) clusters"
Write-Host "Unmatched: $unmatched"

# Apply updates to Supabase
Write-Host "`nApplying updates..."
$updateCount = 0
foreach ($upd in $updates) {
    $seJson = ($upd.source_events | ConvertTo-Json -Depth 5 -Compress).Replace("'", "''")
    $indsJson = ($upd.individuals | ConvertTo-Json -Compress).Replace("'", "''")
    $id = $upd.id

    # individuals is text[] — build array literal: ARRAY['a','b',...]
    $arrLiteral = if ($upd.individuals.Count -gt 0) {
        "ARRAY[" + ($upd.individuals | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Join-String -Separator ',') + "]"
    } else {
        "ARRAY[]::text[]"
    }
    $sql = "UPDATE import_planner_clusters SET source_events = '$seJson'::jsonb, individuals = $arrLiteral WHERE id = '$id';"
    $result = Invoke-SQL $sql
    $updateCount++
    if ($updateCount % 10 -eq 0) { Write-Host "  Updated $updateCount..." }
}
Write-Host "  Updated $updateCount clusters total"

# Now create new clusters for firms NOT in any existing cluster
Write-Host "`nFinding new firms to create clusters for..."

# Build set of all raw strings from existing clusters (normalized)
$existingRaw = @{}
foreach ($cluster in $clustersRaw) {
    foreach ($rs in $cluster.raw_strings) {
        $norm = Normalize-Name $rs
        $existingRaw[$norm] = $true
    }
    $cn = Normalize-Name ($cluster.canonical_name ?? $cluster.proposed_name)
    $existingRaw[$cn] = $true
}

$newClusters = @()
foreach ($prop in $mapRaw.PSObject.Properties) {
    $firmName = $prop.Name
    $firmNorm = Normalize-Name $firmName

    # Check if this firm is already covered by an existing cluster
    $alreadyCovered = $existingRaw.ContainsKey($firmNorm)

    # Also check via Find-MapEntry in reverse - if the map key matched any cluster
    if (-not $alreadyCovered) {
        # Check if any existing cluster matched this map entry
        $wasMatched = $updates | Where-Object {
            $entry = Find-MapEntry ($clustersRaw | Where-Object { $_.id -eq $_.id } | Select-Object -First 1)
            # simpler: check if the firm name normalizes to something in existingRaw
            $false
        }
        # Simpler check: compare normalized firm name against canonical/proposed names
        $matchedByName = $clustersRaw | Where-Object {
            (Normalize-Name ($_.canonical_name ?? $_.proposed_name)) -eq $firmNorm
        }
        if ($matchedByName) { $alreadyCovered = $true }
    }

    if (-not $alreadyCovered) {
        $data = $prop.Value
        $individuals = @($data.individuals.PSObject.Properties | ForEach-Object { $_.Name })
        $evCount = $data.events.Count
        $rawStrings = @($data.events | Select-Object -ExpandProperty raw_co -Unique)

        $newClusters += @{
            proposed_name = $firmName
            raw_strings   = $rawStrings
            event_count   = $evCount
            individuals   = $individuals
            source_events = $data.events | ForEach-Object { @{ raw_co = $_.raw_co; couple = $_.couple; date = $_.date } }
            status        = "pending"
        }
    }
}

Write-Host "New clusters to create: $($newClusters.Count)"

# Insert new clusters in batches
$insertCount = 0
foreach ($nc in $newClusters) {
    $pn = $nc.proposed_name.Replace("'", "''")
    $rsJson = ($nc.raw_strings | ConvertTo-Json -Compress).Replace("'", "''")
    $seJson = ($nc.source_events | ConvertTo-Json -Depth 5 -Compress).Replace("'", "''")
    $evCount = $nc.event_count
    # individuals is text[]
    $arrLiteral = if ($nc.individuals.Count -gt 0) {
        "ARRAY[" + ($nc.individuals | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Join-String -Separator ',') + "]"
    } else {
        "ARRAY[]::text[]"
    }

    $sql = @"
INSERT INTO import_planner_clusters (proposed_name, raw_strings, event_count, individuals, source_events, status)
VALUES ('$pn', '$rsJson'::jsonb, $evCount, $arrLiteral, '$seJson'::jsonb, 'pending')
ON CONFLICT DO NOTHING;
"@
    $result = Invoke-SQL $sql
    $insertCount++
    if ($insertCount % 20 -eq 0) { Write-Host "  Inserted $insertCount..." }
}

Write-Host "`nDone! Updated $updateCount existing clusters, inserted $insertCount new clusters."
