# run-vsco-enrich-phones.ps1
# Fetches phone numbers for all vsco: contacts that are missing one.
# Safe to re-run.

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path $PSScriptRoot -Parent
$envFile     = Join-Path $projectRoot '.env.local'

$envMap = @{}
Get-Content $envFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $k, $v = $_ -split '=', 2; $envMap[$k.Trim()] = $v.Trim().Trim('"')
}

$VSCO_KEY = $envMap['VSCO_API_KEY']
$TOKEN    = $envMap['SUPABASE_ACCESS_TOKEN']
$REF      = $envMap['SUPABASE_PROJECT_REF']

if (-not $VSCO_KEY) { Write-Error "VSCO_API_KEY not found"; exit 1 }
if (-not $TOKEN -or -not $REF) { Write-Error "Supabase credentials not found"; exit 1 }

$VSCO_BASE    = 'https://workspace.vsco.co/api/v2'
$VSCO_HEADERS = @{ 'X-API-KEY' = $VSCO_KEY; 'Accept' = 'application/json' }

function Invoke-Sql($sql) {
    $body = @{ query = $sql } | ConvertTo-Json -Compress -Depth 5
    return Invoke-RestMethod `
        -Uri "https://api.supabase.com/v1/projects/$REF/database/query" `
        -Method POST `
        -Headers @{ Authorization = "Bearer $TOKEN"; 'Content-Type' = 'application/json' } `
        -Body $body
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
                Start-Sleep -Milliseconds $delay
            } else {
                return $null
            }
        }
    }
    return $null
}

function Get-Phone($c) {
    foreach ($field in @($c.cellPhone, $c.workPhone, $c.homePhone)) {
        if ($null -eq $field) { continue }
        $val = ([string]$c.cellPhone.e164).Trim()
        if (-not $val) { $val = ([string]$field.formatted).Trim() }
        if (-not $val) { $val = ([string]$field).Trim() }
        if ($val -and $val -notlike '@{*') { return $val }
    }
    return $null
}

# Load all vsco: contacts missing a phone
Write-Host "Loading contacts missing phone..." -ForegroundColor Cyan
$contacts = Invoke-Sql "SELECT id, import_source FROM contacts WHERE import_source LIKE 'vsco:%' AND phone IS NULL ORDER BY id"
Write-Host "  To enrich: $($contacts.Count)"

if ($contacts.Count -eq 0) {
    Write-Host "All vsco contacts have phones. Done." -ForegroundColor Yellow
    exit 0
}

$updated = 0
$skipped = 0
$done    = 0

foreach ($row in $contacts) {
    $done++
    $vscoId = $row.import_source -replace '^vsco:', ''
    $pct    = [Math]::Round($done / $contacts.Count * 100)

    $ab = Invoke-Vsco "/address-book/$vscoId"
    if ($ab) {
        $phone = Get-Phone $ab
        if ($phone) {
            $p = Lit $phone
            Invoke-Sql "UPDATE contacts SET phone = $p WHERE id = '$($row.id)'" | Out-Null
            $updated++
        } else {
            $skipped++
        }
    } else {
        $skipped++
    }

    if ($done % 50 -eq 0 -or $done -eq $contacts.Count) {
        Write-Host "  [$pct%] $done / $($contacts.Count) — updated: $updated, no phone: $skipped" -ForegroundColor Gray
    }
    Start-Sleep -Milliseconds 400
}

Write-Host ""
Write-Host "=== Phone Enrichment Complete ===" -ForegroundColor Green
Write-Host "  Updated: $updated"
Write-Host "  No phone in VSCO: $skipped"
$finalCount = (Invoke-Sql "SELECT COUNT(*) as n FROM contacts WHERE import_source LIKE 'vsco:%' AND phone IS NOT NULL")[0].n
Write-Host "  Total vsco contacts with phone: $finalCount"
