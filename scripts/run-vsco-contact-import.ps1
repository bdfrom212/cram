# run-vsco-contact-import.ps1
# Full address-book sync from VSCO Workspace API.
# Imports all contacts with phone, email, Instagram handles.
# Updates existing vsco: contacts with enriched data.
# Safe to re-run — uses ON CONFLICT DO UPDATE.

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
    try {
        return Invoke-RestMethod -Uri "$VSCO_BASE$path" -Headers $VSCO_HEADERS -Method GET
    } catch {
        $status = $_.Exception.Response?.StatusCode?.value__
        Write-Host "  VSCO error ($path) — HTTP $status" -ForegroundColor Yellow
        return $null
    }
}

function Get-Phone($contact) {
    if ($contact.cellPhone -and $contact.cellPhone.Trim()) { return $contact.cellPhone.Trim() }
    if ($contact.workPhone -and $contact.workPhone.Trim()) { return $contact.workPhone.Trim() }
    if ($contact.homePhone -and $contact.homePhone.Trim()) { return $contact.homePhone.Trim() }
    return $null
}

function Get-Instagram($contact) {
    # Check chatAccount1, 2, 3 for instagram service
    foreach ($acct in @($contact.chatAccount1, $contact.chatAccount2, $contact.chatAccount3)) {
        if ($acct -and $acct.service -eq 'instagram' -and $acct.identity) {
            $handle = $acct.identity.Trim().TrimStart('@')
            if ($handle) { return "@$handle" }
        }
    }
    # Fallback: check twitterUsername if it looks like IG (unlikely but safe to check)
    return $null
}

function Get-DisplayName($contact) {
    $name = $contact.name
    if ($name -and $name.Trim()) { return $name.Trim() }
    $parts = @($contact.firstName, $contact.lastName) | Where-Object { $_ -and $_.Trim() }
    if ($parts.Count -gt 0) { return ($parts -join ' ').Trim() }
    return $null
}

# --- Ensure unique index for vsco: contacts ---
Write-Host "Ensuring schema..." -ForegroundColor Cyan
Invoke-Sql "CREATE UNIQUE INDEX IF NOT EXISTS contacts_vsco_src_idx ON contacts (import_source) WHERE import_source LIKE 'vsco:%';" | Out-Null

# --- Paginate VSCO address-book ---
Write-Host ""
Write-Host "Fetching VSCO address book..." -ForegroundColor Cyan
$allContacts = [System.Collections.Generic.List[object]]::new()
$page = 1
$perPage = 100

do {
    $resp = Invoke-Vsco "/address-book?page=$page&perPage=$perPage"
    if (-not $resp -or -not $resp.data) { break }

    $contacts = @($resp.data)
    $allContacts.AddRange($contacts)

    $total = $resp.meta.totalItems
    Write-Host "  Page $page — $($allContacts.Count) of $total contacts fetched" -ForegroundColor Gray

    if ($contacts.Count -lt $perPage) { break }
    $page++
    Start-Sleep -Milliseconds 250
} while ($true)

Write-Host "  Total VSCO contacts: $($allContacts.Count)" -ForegroundColor Green

# --- Parse and filter ---
Write-Host ""
Write-Host "Processing contacts..." -ForegroundColor Cyan

$toUpsert = [System.Collections.Generic.List[hashtable]]::new()
$skipped = 0

foreach ($c in $allContacts) {
    $name = Get-DisplayName $c
    if (-not $name) { $skipped++; continue }

    $phone = Get-Phone $c
    $ig    = Get-Instagram $c

    $toUpsert.Add(@{
        id           = $c.id
        name         = $name
        email        = $c.email
        phone        = $phone
        instagram    = $ig
        company      = $c.companyName
        importSource = "vsco:$($c.id)"
    })
}

Write-Host "  Contacts to upsert: $($toUpsert.Count) ($skipped skipped — no name)"

# Count how many have phone vs. IG
$withPhone = @($toUpsert | Where-Object { $_.phone }).Count
$withIg    = @($toUpsert | Where-Object { $_.instagram }).Count
Write-Host "  With phone: $withPhone  |  With Instagram: $withIg"

# --- Upsert in batches of 50 ---
Write-Host ""
Write-Host "Upserting contacts..." -ForegroundColor Cyan

$list   = @($toUpsert)
$total  = $list.Count
$inserted = 0
$updated  = 0

for ($i = 0; $i -lt $list.Count; $i += 50) {
    $end   = [Math]::Min($i + 49, $list.Count - 1)
    $batch = $list[$i..$end]

    $vals = $batch | ForEach-Object {
        $n   = Lit $_.name
        $e   = Lit $_.email
        $p   = Lit $_.phone
        $ig  = Lit $_.instagram
        $co  = Lit $_.company
        $src = Lit $_.importSource
        "($n, $e, $p, $ig, $co, $src)"
    }

    # ON CONFLICT: always update phone/instagram (new data wins); coalesce email/company
    $sql = @"
INSERT INTO contacts (name, email, phone, instagram, company, import_source)
VALUES $($vals -join ',')
ON CONFLICT (import_source) WHERE import_source LIKE 'vsco:%'
DO UPDATE SET
  phone     = EXCLUDED.phone,
  instagram = EXCLUDED.instagram,
  email     = COALESCE(EXCLUDED.email, contacts.email),
  company   = COALESCE(EXCLUDED.company, contacts.company),
  name      = COALESCE(contacts.name, EXCLUDED.name)
RETURNING id, (xmax = 0) AS is_insert
"@

    $result = Invoke-Sql $sql
    if ($result -is [array]) {
        foreach ($r in $result) {
            if ($r.is_insert -eq $true) { $inserted++ } else { $updated++ }
        }
    } elseif ($result) {
        if ($result.is_insert -eq $true) { $inserted++ } else { $updated++ }
    }

    $pct = [Math]::Round(($i + $batch.Count) / $total * 100)
    Write-Host "  [$pct%] Processed $([Math]::Min($i + 50, $total)) / $total"
    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "=== VSCO Contact Import Complete ===" -ForegroundColor Green
Write-Host "  Contacts processed: $total"
Write-Host "  New contacts:       $inserted"
Write-Host "  Updated (enriched): $updated"
Write-Host "  With phone #:       $withPhone"
Write-Host "  With Instagram:     $withIg"

# --- Final count ---
$finalCount = (Invoke-Sql "SELECT COUNT(*) as n FROM contacts")[0].n
Write-Host "  Total contacts in DB: $finalCount"
