<#
.SYNOPSIS
  TEMPORARY diagnostic for spike S7 (APP-2): can the connector attach a VIEW at all,
  or only our five views are the problem? (FINAL PLAN/your_steps/APP-2.md, B3c)

.DESCRIPTION
  On 14 Nov the connector accepted the table app.field_catalog and refused all five real
  views ("400 Bad Request: Source attachment failed"). The real views differ from that
  table in many ways at once, so this script applies a LADDER of throw-away entities, one
  at a time, over the probe objects that db/dev/probe_s7_views.sql created in schema dev:

    ProbeTable      control: plain table with a primary key         (must be ACCEPTED)
    ProbeViewPlain  V1: view over the control, key passes through   (the decisive step)
    ProbeViewKeyless K1: the SAME view as V1, but no key declared   (only if V1 is refused)
    ProbeViewTypes  V2: V1 plus decimal(18,4) and datetime2(3)      (only if V1 is accepted)
    ProbeViewKey    V3: ISNULL string key, CAST on every column     (only if V1 is accepted)
    ProbeViewJoin   V4: join (OUTER APPLY) with a count             (only if V1 is accepted)

  It stops as early as the answer allows:
    - control refused            -> the test is invalid; nothing else is tried
    - V1 refused                 -> K1 is tried: refused too = the server attaches tables only;
                                    accepted = the key we declare on a view is what fails
    - V1 accepted                -> V2, V3, V4 are all tried, to find which feature breaks
  (-RunAll tries every step anyway.) So it makes between 3 and 5 calls to Fabric, and it
  prints how long each one took (about 6 to 20 seconds each on 15 Nov).

  How: the CLI sends every entity file it finds in rayfin\connectors\atlas_sql_db. For each
  step the script removes the real entity files from that folder, writes the one probe
  entity and a tiny schema.ts, runs `npx rayfin up connector apply --name atlas_sql_db`
  and reads the CLI's own summary line ("N applied, N skipped, N failed"). A copy of the
  folder is taken first and ALWAYS put back at the end, even if something goes wrong; the
  script then compares file hashes and says whether your files are byte-for-byte as they
  were. The probe entities exist only inside the loop; none is left in the project.

  Touches Fabric: yes. It replaces the connector's configuration on the deployed item once
  per step, so the connector ends up holding whatever was applied last (the app does not
  read through it at the moment; the next `npx rayfin up` replaces it). Nothing in the
  database changes. You run it; Claude never does (project rule).

  -DryRun does everything except the Fabric call (it compiles each variant into a temp
  folder instead), to prove the file shuffling and the generated files are sound.

.EXAMPLE
  cd C:\Users\gayatri.mangire\Desktop\atlas-mdm
  powershell -ExecutionPolicy Bypass -File tools\probe_view_vs_table.ps1
  powershell -ExecutionPolicy Bypass -File tools\probe_view_vs_table.ps1 -DryRun
#>
param(
    [switch] $DryRun,
    [switch] $RunAll
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'rayfin\connectors\atlas_sql_db'
$compiled = Join-Path $root 'rayfin\.temp\compiled\connectors\atlas_sql_db'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = Join-Path $env:TEMP "atlas_sql_db_backup_$stamp"
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path (Join-Path $dir 'schema.ts'))) { throw "Not the atlas-mdm project: $dir\schema.ts not found." }
Set-Location $root

# ---- the probe entities (same decorator style as the real entity files) ----------------

$srcTable = @'
import { entity, int, text, decimal, date, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// TEMPORARY probe entity written by tools/probe_view_vs_table.ps1 (never kept in the project).
@role('authenticated', ['read'])
@entity()
export class ProbeTable extends Source({ schema: 'dev', table: 'probe_s7_table', primaryKey: ['id'] }) {
  @int({ column: 'id' }) id!: number;
  @text({ column: 'label', optional: true, max: 40 }) label?: string;
  @decimal({ column: 'amount', optional: true, precision: 18, scale: 4 }) amount?: number;
  @date({ column: 'changed_at', optional: true }) changedAt?: Date;
}
'@

$srcPlain = @'
import { entity, int, text, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// TEMPORARY probe entity written by tools/probe_view_vs_table.ps1 (never kept in the project).
@role('authenticated', ['read'])
@entity()
export class ProbeViewPlain extends Source({ schema: 'dev', table: 'vw_probe_s7_plain', primaryKey: ['id'] }) {
  @int({ column: 'id' }) id!: number;
  @text({ column: 'label', optional: true, max: 40 }) label?: string;
}
'@

$srcTypes = @'
import { entity, int, text, decimal, date, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// TEMPORARY probe entity written by tools/probe_view_vs_table.ps1 (never kept in the project).
@role('authenticated', ['read'])
@entity()
export class ProbeViewTypes extends Source({ schema: 'dev', table: 'vw_probe_s7_types', primaryKey: ['id'] }) {
  @int({ column: 'id' }) id!: number;
  @text({ column: 'label', optional: true, max: 40 }) label?: string;
  @decimal({ column: 'amount', optional: true, precision: 18, scale: 4 }) amount?: number;
  @date({ column: 'changed_at', optional: true }) changedAt?: Date;
}
'@

$srcKey = @'
import { entity, text, decimal, date, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// TEMPORARY probe entity written by tools/probe_view_vs_table.ps1 (never kept in the project).
@role('authenticated', ['read'])
@entity()
export class ProbeViewKey extends Source({ schema: 'dev', table: 'vw_probe_s7_key', primaryKey: ['probeKey'] }) {
  @text({ column: 'probe_key', max: 20 }) probeKey!: string;
  @text({ column: 'label', optional: true, max: 40 }) label?: string;
  @decimal({ column: 'amount', optional: true, precision: 18, scale: 4 }) amount?: number;
  @date({ column: 'changed_at', optional: true }) changedAt?: Date;
}
'@

$srcJoin = @'
import { entity, int, text, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// TEMPORARY probe entity written by tools/probe_view_vs_table.ps1 (never kept in the project).
@role('authenticated', ['read'])
@entity()
export class ProbeViewJoin extends Source({ schema: 'dev', table: 'vw_probe_s7_join', primaryKey: ['id'] }) {
  @int({ column: 'id' }) id!: number;
  @text({ column: 'label', optional: true, max: 40 }) label?: string;
  @int({ column: 'child_count', optional: true }) childCount?: number;
  @text({ column: 'last_note', optional: true, max: 40 }) lastNote?: string;
}
'@

$srcKeyless = @'
import { entity, int, text, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// TEMPORARY probe entity written by tools/probe_view_vs_table.ps1 (never kept in the project).
// KEYLESS on purpose: same view as ProbeViewPlain, but no primaryKey is declared.
@role('authenticated', ['read'])
@entity()
export class ProbeViewKeyless extends Source({ schema: 'dev', table: 'vw_probe_s7_plain' }) {
  @int({ column: 'id' }) id!: number;
  @text({ column: 'label', optional: true, max: 40 }) label?: string;
}
'@

# When: 'always' | 'v1-refused' (only worth trying when the plain view was refused)
#       | 'v1-accepted' (only worth trying when the plain view was accepted)
$ladder = @(
    [pscustomobject]@{ Name = 'ProbeTable';       Step = 'control'; When = 'always';      What = 'plain table, primary key';                 Source = $srcTable },
    [pscustomobject]@{ Name = 'ProbeViewPlain';   Step = 'V1';      When = 'always';      What = 'view, 2 columns, key passes through';      Source = $srcPlain },
    [pscustomobject]@{ Name = 'ProbeViewKeyless'; Step = 'K1';      When = 'v1-refused';  What = 'same view as V1, NO key declared';         Source = $srcKeyless },
    [pscustomobject]@{ Name = 'ProbeViewTypes';   Step = 'V2';      When = 'v1-accepted'; What = 'view + decimal(18,4) and datetime2(3)';    Source = $srcTypes },
    [pscustomobject]@{ Name = 'ProbeViewKey';     Step = 'V3';      When = 'v1-accepted'; What = 'view with ISNULL string key and CASTs';    Source = $srcKey },
    [pscustomobject]@{ Name = 'ProbeViewJoin';    Step = 'V4';      When = 'v1-accepted'; What = 'view with OUTER APPLY, count and MAX';     Source = $srcJoin }
)

function New-ProbeSchema([string] $name) {
    return @"
import type { GraphQLBackedConnector } from '@microsoft/rayfin-connector-fabric-graphql';
import type { ConnectorConfig } from '@microsoft/rayfin-connectors';

import { ${name} } from './${name}.js';

export { ${name} } from './${name}.js';

// TEMPORARY probe schema written by tools/probe_view_vs_table.ps1; the real one is restored afterwards.
export const connectorConfig = {
  connector: 'fabric-sqldatabase',
  operations: ['read'],
  entities: { ${name} },
} as const satisfies ConnectorConfig;

export type AtlasSqlDbSchema = GraphQLBackedConnector<{ ${name}: typeof ${name} }, typeof connectorConfig>;
"@
}

function Get-Reading([hashtable] $r) {
    if ($r.Values -contains 'UNCLEAR') {
        return 'UNCLEAR: at least one step gave no summary line. Copy the whole output to Claude.'
    }
    if ($r['ProbeTable'] -ne 'ACCEPTED') {
        return 'TEST INVALID: the plain control table was refused, so schema dev or the probe itself is the problem, not views. Copy the whole output to Claude.'
    }
    if ($r['ProbeViewPlain'] -ne 'ACCEPTED') {
        if ($r['ProbeViewKeyless'] -eq 'ACCEPTED') {
            return 'THE KEY IS WHAT FAILS: the view is refused with a declared key and accepted without one. Keyless view entities lose lookup by key, and cursor paging without a key is NOT proven: it needs a paging test on the deployed app (spike S7) before we rely on it. Copy the whole output to Claude.'
        }
        if ($r['ProbeViewKeyless'] -eq 'REFUSED') {
            return 'VIEWS ARE REFUSED WITH OR WITHOUT A KEY: the same columns are accepted as a table and refused as a view, whatever we declare. The server attaches tables only. Reading views through the connector is not possible here; the choice is functions (C) or tables (B).'
        }
        return 'VIEWS ARE REFUSED even in the plainest form (the keyless check gave no clear answer). Reading views through the connector with a declared key is not possible here; the choice is functions (C) or tables (B).'
    }
    $bad = @('ProbeViewTypes', 'ProbeViewKey', 'ProbeViewJoin') | Where-Object { $r[$_] -ne 'ACCEPTED' }
    if ($bad.Count -eq 0) {
        return 'VIEWS ARE ACCEPTED, even with decimal/datetime columns, the ISNULL key and a join. The five real views fail for another reason: Claude compares them with these four next.'
    }
    $meaning = @{
        ProbeViewTypes = 'decimal(18,4) or datetime2(3) columns'
        ProbeViewKey   = 'the ISNULL string key with CASTs'
        ProbeViewJoin  = 'a join (OUTER APPLY) with a count and MAX'
    }
    $named = ($bad | ForEach-Object { "$_ ($($meaning[$_]))" }) -join '; '
    return "PLAIN VIEWS ARE ACCEPTED, but these are refused: $named. That feature is what our real views trip on, and it can be changed in the view. Copy the whole output to Claude."
}

# 1. back up every .ts file of the connector folder (outside the project)
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item (Join-Path $dir '*.ts') $backup
$originalHashes = @{}
Get-ChildItem $backup -Filter *.ts | ForEach-Object { $originalHashes[$_.Name] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
Write-Host ("Backed up {0} files to {1}" -f $originalHashes.Count, $backup)

$rows = @()
$results = @{}
$stopReason = $null
try {
    foreach ($step in $ladder) {
        $skipReason = $stopReason
        if (-not $skipReason -and $step.When -eq 'v1-accepted' -and $results['ProbeViewPlain'] -ne 'ACCEPTED') {
            $skipReason = 'skipped: the plainest view was refused, so richer views cannot do better'
        }
        if (-not $skipReason -and $step.When -eq 'v1-refused' -and $results['ProbeViewPlain'] -eq 'ACCEPTED') {
            $skipReason = 'skipped: only needed when the plain view is refused'
        }
        if ($skipReason -and -not $RunAll -and -not $DryRun) {
            $rows += [pscustomobject]@{ Step = $step.Step; Entity = $step.Name; What = $step.What; Result = 'NOT TRIED'; Seconds = ''; Detail = $skipReason }
            continue
        }

        Write-Host ""
        Write-Host ("=== {0}: {1} ({2}) ===" -f $step.Step, $step.Name, $step.What)
        Get-ChildItem $dir -Filter *.ts | Remove-Item -Force
        [System.IO.File]::WriteAllText((Join-Path $dir "$($step.Name).ts"), $step.Source, $utf8)
        [System.IO.File]::WriteAllText((Join-Path $dir 'schema.ts'), (New-ProbeSchema $step.Name), $utf8)
        if (Test-Path $compiled) { Remove-Item $compiled -Recurse -Force }

        $watch = [System.Diagnostics.Stopwatch]::StartNew()

        if ($DryRun) {
            $out = Join-Path $env:TEMP "atlas_probe_out_$stamp"
            $text = (cmd /c "npx tsc -p rayfin --outDir ""$out"" --tsBuildInfoFile ""$out\probe.tsbuildinfo"" 2>&1") | Out-String
            $ok = ($LASTEXITCODE -eq 0)
            $watch.Stop()
            $rows += [pscustomobject]@{
                Step = $step.Step; Entity = $step.Name; What = $step.What
                Result = $(if ($ok) { 'COMPILES' } else { 'COMPILE ERROR' })
                Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
                Detail = $(if ($ok) { '(dry run: Fabric not called)' } else { $text.Trim() })
            }
            continue
        }

        $text = (cmd /c "npx rayfin up connector apply --name atlas_sql_db 2>&1") | Out-String
        $watch.Stop()
        Write-Host $text
        $detail = ($text -split "`r?`n" | Where-Object { $_ -match 'Details:|apply failed|Reserved|collision|Error' } | Select-Object -First 2) -join ' | '
        if ($text -match '(\d+) applied, (\d+) skipped, (\d+) failed') {
            $applied = [int]$Matches[1]; $failed = [int]$Matches[3]
            if ($failed -eq 0 -and $applied -ge 1) { $result = 'ACCEPTED' }
            elseif ($failed -ge 1) { $result = 'REFUSED' }
            else { $result = 'UNCLEAR' }
        } else {
            $result = 'UNCLEAR'
        }
        $results[$step.Name] = $result
        $rows += [pscustomobject]@{
            Step = $step.Step; Entity = $step.Name; What = $step.What
            Result = $result; Seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1); Detail = $detail.Trim()
        }

        if ($result -eq 'UNCLEAR') { $stopReason = 'stopped: the previous step gave no clear answer' }
        elseif ($step.Name -eq 'ProbeTable' -and $result -ne 'ACCEPTED') { $stopReason = 'skipped: the control table was refused, so nothing below it can be read' }
    }
}
finally {
    # 2. put everything back, always
    Get-ChildItem $dir -Filter *.ts -ErrorAction SilentlyContinue | Remove-Item -Force
    Copy-Item (Join-Path $backup '*.ts') $dir
    if (Test-Path $compiled) { Remove-Item $compiled -Recurse -Force }
    $bad = @()
    foreach ($name in $originalHashes.Keys) {
        $p = Join-Path $dir $name
        if (-not (Test-Path $p) -or (Get-FileHash $p -Algorithm SHA256).Hash -ne $originalHashes[$name]) { $bad += $name }
    }
    $extra = @(Get-ChildItem $dir -Filter *.ts | Where-Object { -not $originalHashes.ContainsKey($_.Name) })
    Write-Host ""
    if ($bad.Count -eq 0 -and $extra.Count -eq 0) { Write-Host "RESTORED: the connector folder is byte-for-byte as it was ($($originalHashes.Count) files)." -ForegroundColor Green }
    else { Write-Host "RESTORE PROBLEM: $($bad -join ', ') $($extra.Name -join ', '). A copy is in $backup" -ForegroundColor Red }
}

Write-Host ""
Write-Host "=== RESULT (copy this table to Claude) ==="
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
if (-not $DryRun) {
    Write-Host "READING: $(Get-Reading $results)"
    Write-Host ""
}
