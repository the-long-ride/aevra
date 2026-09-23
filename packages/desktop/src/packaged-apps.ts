import {
  catalogAppsFromRows,
  readPowerShellRows,
  type AppSourceScan,
  type RawCatalogApp,
} from './windows-app-scan.js';

const PACKAGED_APPS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$rows = [System.Collections.Generic.List[object]]::new()
$scanWarnings = [System.Collections.Generic.List[string]]::new()
$manifestFailureCount = 0
try {
  if (-not (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue)) { exit 1 }
  if (-not (Get-Command Get-StartApps -ErrorAction SilentlyContinue)) { exit 1 }
  $startNames = @{}
  $startErrors = @()
  $startApps = Get-StartApps -ErrorVariable +startErrors -ErrorAction SilentlyContinue
  foreach ($startApp in $startApps) {
    if ($startApp.AppID) { $startNames[[string]$startApp.AppID] = [string]$startApp.Name }
  }
  if ($startErrors.Count -gt 0) { $scanWarnings.Add('Some registered app names could not be read') }
  $seen = @{}
  $packageErrors = @()
  $packages = @(Get-AppxPackage -ErrorVariable +packageErrors -ErrorAction SilentlyContinue | Select-Object -First 501)
  if ($packageErrors.Count -gt 0) { $scanWarnings.Add('Some registered packages could not be read') }
  foreach ($package in $packages) {
    if ($rows.Count -ge 501) { break }
    $manifestPath = Join-Path ([string]$package.InstallLocation) 'AppxManifest.xml'
    $nodes = @()
    try {
      if ($package.InstallLocation -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
        $nodes = @($manifest.SelectNodes("//*[local-name()='Applications']/*[local-name()='Application']"))
      }
    } catch { $manifestFailureCount++ }
    if ($nodes.Count -eq 0) {
      $prefix = [string]$package.PackageFamilyName + '!'
      $packageApps = @($startNames.Keys | Where-Object { $_.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
      if ($packageApps.Count -eq 0) {
        $rows.Add([ordered]@{ displayName = [string]$package.Name; version = [string]$package.Version; executablePath = $null })
      } else {
        foreach ($appId in $packageApps) {
          if ($rows.Count -ge 501) { break }
          $rows.Add([ordered]@{ displayName = $startNames[$appId]; version = [string]$package.Version; executablePath = $null })
          $seen[$appId] = $true
        }
      }
      continue
    }
    foreach ($application in $nodes) {
      if ($rows.Count -ge 501) { break }
      $applicationId = [string]$application.GetAttribute('Id')
      $aumid = [string]$package.PackageFamilyName + '!' + $applicationId
      $name = if ($startNames.ContainsKey($aumid)) { $startNames[$aumid] } else { [string]$package.Name }
      $executable = $null
      $relativeExecutable = [string]$application.GetAttribute('Executable')
      try {
        if ($relativeExecutable -and [IO.Path]::GetExtension($relativeExecutable) -ieq '.exe') {
          $root = [IO.Path]::GetFullPath([string]$package.InstallLocation).TrimEnd('\') + '\'
          $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relativeExecutable))
          if ($candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $executable = $candidate }
        }
      } catch {}
      $rows.Add([ordered]@{ displayName = $name; version = [string]$package.Version; executablePath = $executable })
      $seen[$aumid] = $true
    }
  }
  foreach ($appId in $startNames.Keys) {
    if ($rows.Count -ge 501) { break }
    if ($appId -match '!' -and -not $seen.ContainsKey($appId)) {
      $rows.Add([ordered]@{ displayName = $startNames[$appId]; version = $null; executablePath = $null })
      $seen[$appId] = $true
    }
  }
  if ($manifestFailureCount -gt 0) { $scanWarnings.Add('Some packaged app manifests could not be read') }
  ConvertTo-Json -InputObject ([ordered]@{ rows = $rows.ToArray(); warnings = $scanWarnings.ToArray() }) -Compress -Depth 3
} catch {
  exit 1
}
`;

export async function detectPackagedApps(): Promise<AppSourceScan> {
  const result = await readPowerShellRows<RawCatalogApp>('Packaged app', PACKAGED_APPS_SCRIPT);
  const apps = await catalogAppsFromRows(result.rows, 'packaged');
  return { apps, warnings: result.warnings };
}
