<#
.SYNOPSIS
  TEMPORARY diagnostic for spike S7 (APP-2): which connector entity does Fabric refuse?

.DESCRIPTION
  `npx rayfin up` answered "400 Bad Request: Source attachment failed" for the connector
  atlas_sql_db, and the error does not say which of the six entities caused it. This script
  applies the entities ONE AT A TIME with `npx rayfin up connector apply --name atlas_sql_db`
  and prints one line per entity.

  How: the CLI sends every entity file it finds in rayfin\connectors\atlas_sql_db. For each
  entity the script (1) removes the other entity files from that folder, (2) writes a tiny
  schema.ts for the one entity, (3) runs the apply, and reads the CLI's own summary line
  ("N applied, N skipped, N failed"). A copy of the folder is taken first and ALWAYS put
  back at the end, even if something goes wrong; the script then compares file hashes and
  says whether your files are byte-for-byte as they were.

  Touches Fabric: yes. It replaces the connector's configuration on the deployed item once
  per entity, so the connector ends up holding whatever was applied last. Nothing in the
  database changes. You run it; Claude never does (project rule).

  -DryRun does everything except the Fabric call (it compiles each variant into a temp
  folder instead), to prove the file shuffling and the generated schema.ts are sound.

.EXAMPLE
  cd C:\Users\gayatri.mangire\Desktop\atlas-mdm
  powershell -ExecutionPolicy Bypass -File tools\probe_connector.ps1
  powershell -ExecutionPolicy Bypass -File tools\probe_connector.ps1 -DryRun
#>
param(
    [string[]] $Entities = @('FieldCatalog', 'VwFieldOwnership', 'VwFlocCurrent', 'VwEquipmentFieldCurrent', 'VwEquipmentCurrent', 'VwEquipmentSearch'),
    [switch] $DryRun
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

function New-ProbeSchema([string] $name) {
    return @"
import type { GraphQLBackedConnector } from '@microsoft/rayfin-connector-fabric-graphql';
import type { ConnectorConfig } from '@microsoft/rayfin-connectors';

import { ${name} } from './${name}.js';

export { ${name} } from './${name}.js';

// TEMPORARY probe schema written by tools/probe_connector.ps1; the real one is restored afterwards.
export const connectorConfig = {
  connector: 'fabric-sqldatabase',
  operations: ['read'],
  entities: { ${name} },
} as const satisfies ConnectorConfig;

export type AtlasSqlDbSchema = GraphQLBackedConnector<{ ${name}: typeof ${name} }, typeof connectorConfig>;
"@
}

# 1. back up every .ts file of the connector folder (outside the project)
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item (Join-Path $dir '*.ts') $backup
$originalHashes = @{}
Get-ChildItem $backup -Filter *.ts | ForEach-Object { $originalHashes[$_.Name] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
Write-Host ("Backed up {0} files to {1}" -f $originalHashes.Count, $backup)
foreach ($e in $Entities) { if (-not $originalHashes.ContainsKey("$e.ts")) { throw "No file $e.ts in the connector folder." } }

$rows = @()
try {
    foreach ($e in $Entities) {
        Write-Host ""
        Write-Host "=== probing $e ==="
        Get-ChildItem $dir -Filter *.ts | Remove-Item -Force
        Copy-Item (Join-Path $backup "$e.ts") $dir
        [System.IO.File]::WriteAllText((Join-Path $dir 'schema.ts'), (New-ProbeSchema $e), $utf8)
        if (Test-Path $compiled) { Remove-Item $compiled -Recurse -Force }

        if ($DryRun) {
            $out = Join-Path $env:TEMP "atlas_probe_out_$stamp"
            $text = (cmd /c "npx tsc -p rayfin --outDir ""$out"" --tsBuildInfoFile ""$out\probe.tsbuildinfo"" 2>&1") | Out-String
            $ok = ($LASTEXITCODE -eq 0)
            $rows += [pscustomobject]@{ Entity = $e; Result = $(if ($ok) { 'COMPILES' } else { 'COMPILE ERROR' }); Detail = $(if ($ok) { '(dry run: Fabric not called)' } else { $text.Trim() }) }
            continue
        }

        $text = (cmd /c "npx rayfin up connector apply --name atlas_sql_db 2>&1") | Out-String
        Write-Host $text
        $detail = ($text -split "`r?`n" | Where-Object { $_ -match 'Details:|apply failed|Reserved|collision|Error' } | Select-Object -First 2) -join ' | '
        if ($text -match '(\d+) applied, (\d+) skipped, (\d+) failed') {
            $applied = [int]$Matches[1]; $failed = [int]$Matches[3]
            if ($failed -eq 0 -and $applied -ge 1) { $result = 'ACCEPTED' } else { $result = 'REFUSED' }
        } else {
            $result = 'UNCLEAR'
        }
        $rows += [pscustomobject]@{ Entity = $e; Result = $result; Detail = $detail.Trim() }
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
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
