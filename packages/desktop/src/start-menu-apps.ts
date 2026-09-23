import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  catalogAppsFromRows,
  readPowerShellRows,
  type AppSourceScan,
  type RawCatalogApp,
} from './windows-app-scan.js';

const START_MENU_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$rows = [System.Collections.Generic.List[object]]::new()
$scanWarnings = [System.Collections.Generic.List[string]]::new()
try {
  $shell = New-Object -ComObject WScript.Shell
  $roots = @($env:AEVRA_USER_START_MENU, $env:AEVRA_COMMON_START_MENU) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
  if ($roots.Count -eq 0) { exit 1 }
  foreach ($root in $roots) {
    $scanErrors = @()
    $links = Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorVariable +scanErrors -ErrorAction SilentlyContinue
    foreach ($link in $links) {
      if ($rows.Count -ge 501) { break }
      try {
        $shortcut = $shell.CreateShortcut($link.FullName)
        $target = [string]$shortcut.TargetPath
        $executable = $null
        if ($target -and [IO.Path]::GetExtension($target) -ieq '.exe' -and (Test-Path -LiteralPath $target -PathType Leaf)) { $executable = $target }
        $rows.Add([ordered]@{ displayName = $link.BaseName; version = $null; executablePath = $executable })
      } catch {
        $rows.Add([ordered]@{ displayName = $link.BaseName; version = $null; executablePath = $null })
      }
    }
    if ($scanErrors.Count -gt 0) { $scanWarnings.Add('Some Start Menu entries could not be read') }
    if ($rows.Count -ge 501) { break }
  }
  ConvertTo-Json -InputObject ([ordered]@{ rows = $rows.ToArray(); warnings = $scanWarnings.ToArray() }) -Compress -Depth 3
} catch {
  exit 1
}
`;

export async function detectStartMenuApps(): Promise<AppSourceScan> {
  const userData = process.env.APPDATA;
  const commonData = process.env.PROGRAMDATA;
  const roots = [
    userData
      ? path.win32.join(userData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : undefined,
    commonData
      ? path.win32.join(commonData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : undefined,
  ];
  const rootAvailability = await Promise.all(roots.map(async (root) => {
    if (!root) return false;
    try {
      return (await stat(root)).isDirectory();
    } catch {
      return false;
    }
  }));
  const result = await readPowerShellRows<RawCatalogApp>('Start Menu', START_MENU_SCRIPT, {
    AEVRA_USER_START_MENU: roots[0] ?? '',
    AEVRA_COMMON_START_MENU: roots[1] ?? '',
  });
  const apps = await catalogAppsFromRows(result.rows, 'start-menu');
  const rootWarning = rootAvailability.some((available) => !available)
    ? ['One or more Start Menu folders could not be read']
    : [];
  return { apps, warnings: [...new Set([...result.warnings, ...rootWarning])] };
}
