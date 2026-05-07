
# Insert new clusters in a single batched INSERT statement to avoid rate limits

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

function Normalize-Name($name) {
    if (-not $name) { return "" }
    return $name.ToLower().Trim() -replace '&amp;', '&' -replace '\s+', ' '
}

# Load data
$clustersRaw = Get-Content "C:\Users\Studio\projects\cram\data\existing_clusters.json" -Raw | ConvertFrom-Json
$mapRaw = Get-Content "C:\Users\Studio\projects\cram\data\planner_events_map.json" -Raw | ConvertFrom-Json

# Build set of normalized names already covered by existing clusters
$existingNorm = @{}
foreach ($cluster in $clustersRaw) {
    $cn = Normalize-Name ($cluster.canonical_name)
    $pn = Normalize-Name ($cluster.proposed_name)
    if ($cn) { $existingNorm[$cn] = $true }
    if ($pn) { $existingNorm[$pn] = $true }
    foreach ($rs in $cluster.raw_strings) {
        # Strip X suffix, instagram, parentheticals, comma-person
        $norm = Normalize-Name $rs
        $norm = $norm -replace '\s*@\S+\s*$', '' -replace '\s*x$', '' -replace '\s*\(.*\)\s*$', '' -replace '\s*,.*$', ''
        $norm = $norm.Trim()
        if ($norm) { $existingNorm[$norm] = $true }
    }
}

Write-Host "Existing normalized names: $($existingNorm.Count)"

# Find firms in map not covered by existing clusters
$newFirms = @()
foreach ($prop in $mapRaw.PSObject.Properties) {
    $firmName = $prop.Name
    $firmNorm = Normalize-Name $firmName

    if (-not $existingNorm.ContainsKey($firmNorm)) {
        $newFirms += @{ name = $firmName; data = $prop.Value }
    }
}

Write-Host "New firms to insert: $($newFirms.Count)"
if ($newFirms.Count -eq 0) {
    Write-Host "Nothing to insert."
    exit
}

# Build batched INSERT — split into groups of 50 to keep SQL size manageable
$batchSize = 50
$totalInserted = 0

for ($i = 0; $i -lt $newFirms.Count; $i += $batchSize) {
    $batch = $newFirms[$i..([Math]::Min($i + $batchSize - 1, $newFirms.Count - 1))]

    $valueRows = @()
    foreach ($firm in $batch) {
        $pn = $firm.name.Replace("'", "''")
        $data = $firm.data

        $individuals = @($data.individuals.PSObject.Properties | ForEach-Object { $_.Name })
        $evCount = $data.events.Count
        $rawStrings = @($data.events | Select-Object -ExpandProperty raw_co -Unique)
        $sourceEvents = $data.events | ForEach-Object { @{ raw_co = $_.raw_co; couple = $_.couple; date = $_.date } }

        $seJson = ($sourceEvents | ConvertTo-Json -Depth 5 -Compress).Replace("'", "''")
        # Both raw_strings and individuals are text[] — use ARRAY[...] literals
        $rsArrLiteral = if ($rawStrings.Count -gt 0) {
            "ARRAY[" + ($rawStrings | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Join-String -Separator ',') + "]"
        } else {
            "ARRAY[]::text[]"
        }
        $indsArrLiteral = if ($individuals.Count -gt 0) {
            "ARRAY[" + ($individuals | ForEach-Object { "'" + $_.Replace("'", "''") + "'" } | Join-String -Separator ',') + "]"
        } else {
            "ARRAY[]::text[]"
        }

        $valueRows += "('$pn', $rsArrLiteral, $evCount, $indsArrLiteral, '$seJson'::jsonb, 'pending')"
    }

    $valuesSql = $valueRows -join ",`n"
    $sql = @"
INSERT INTO import_planner_clusters (proposed_name, raw_strings, event_count, individuals, source_events, status)
VALUES
$valuesSql
ON CONFLICT DO NOTHING;
"@

    try {
        $result = Invoke-SQL $sql
        $totalInserted += $batch.Count
        Write-Host "Inserted batch $([Math]::Ceiling(($i+1)/$batchSize)): $totalInserted total"
    } catch {
        Write-Host "Batch $([Math]::Ceiling(($i+1)/$batchSize)) error: $_"
        # Wait and retry once
        Start-Sleep -Seconds 5
        try {
            $result = Invoke-SQL $sql
            $totalInserted += $batch.Count
            Write-Host "  Retry succeeded: $totalInserted total"
        } catch {
            Write-Host "  Retry failed: $_"
        }
    }

    if ($i + $batchSize -lt $newFirms.Count) {
        Start-Sleep -Milliseconds 500
    }
}

Write-Host "`nDone! Inserted $totalInserted new clusters."
