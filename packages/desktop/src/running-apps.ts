import {
  catalogAppsFromRows,
  readPowerShellRows,
  type AppSourceScan,
  type RawCatalogApp,
} from './windows-app-scan.js';

const RUNNING_APPS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$rows = [System.Collections.Generic.List[object]]::new()
$scanErrors = @()
try {
  $processes = Get-Process -ErrorVariable +scanErrors -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.ProcessName -notin @('ApplicationFrameHost', 'RuntimeBroker')
  }
  foreach ($process in $processes) {
    if ($rows.Count -ge 501) { break }
    $executable = $null
    $displayName = [string]$process.ProcessName
    $version = $null
    try {
      $candidate = [string]$process.Path
      if ($candidate -and [IO.Path]::GetExtension($candidate) -ieq '.exe' -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $executable = $candidate
        $details = [Diagnostics.FileVersionInfo]::GetVersionInfo($candidate)
        if ($details.ProductName) { $displayName = [string]$details.ProductName }
        elseif ($details.FileDescription) { $displayName = [string]$details.FileDescription }
        if ($details.ProductVersion) { $version = [string]$details.ProductVersion }
      }
    } catch {}
    $rows.Add([ordered]@{ displayName = $displayName; version = $version; executablePath = $executable })
  }
  $warnings = if ($scanErrors.Count -gt 0) { @('Some running app processes could not be read') } else { @() }
  ConvertTo-Json -InputObject ([ordered]@{ rows = $rows.ToArray(); warnings = $warnings }) -Compress -Depth 3
} catch {
  exit 1
}
`;

export async function detectRunningApps(): Promise<AppSourceScan> {
  const result = await readPowerShellRows<RawCatalogApp>('Running app', RUNNING_APPS_SCRIPT);
  const apps = await catalogAppsFromRows(result.rows, 'running');
  return { apps, warnings: result.warnings };
}
