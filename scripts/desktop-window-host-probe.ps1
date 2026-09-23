<#
.SYNOPSIS
    Read-only HWND ancestry probe for WebView2 host attribution.
.DESCRIPTION
    Enumerates existing windows and process identities. It does not activate
    windows or read titles, UI text, or control values.
#>
param (
    [string]$HostProcessName = 'quotashift',
    [string]$TargetProcessName = 'msedgewebview2',
    [int]$MaxWindows = 10000
)

$ErrorActionPreference = 'Stop'

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AevraWindowHostProbe
{
    public delegate bool EnumWindowsCallback(IntPtr hwnd, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);

    public static List<IntPtr> TopLevelWindows()
    {
        var result = new List<IntPtr>();
        EnumWindows((hwnd, parameter) => { result.Add(hwnd); return true; }, IntPtr.Zero);
        return result;
    }

    public static List<IntPtr> ChildWindows(IntPtr parent)
    {
        var result = new List<IntPtr>();
        EnumChildWindows(parent, (hwnd, parameter) => { result.Add(hwnd); return true; }, IntPtr.Zero);
        return result;
    }

    public static uint ProcessId(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out var processId);
        return processId;
    }

    public static string ClassName(IntPtr hwnd)
    {
        var value = new StringBuilder(256);
        return GetClassName(hwnd, value, value.Capacity) > 0 ? value.ToString() : "";
    }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp

$handleValues = [System.Collections.Generic.HashSet[long]]::new()
foreach ($topLevel in [AevraWindowHostProbe]::TopLevelWindows()) {
    [void]$handleValues.Add($topLevel.ToInt64())
    foreach ($child in [AevraWindowHostProbe]::ChildWindows($topLevel)) {
        [void]$handleValues.Add($child.ToInt64())
    }
}

if ($handleValues.Count -gt $MaxWindows) {
    throw "Window enumeration exceeded the configured $MaxWindows window limit."
}

$processCache = @{}
function Get-ProcessIdentity([uint32]$ProcessId) {
    if ($processCache.ContainsKey($ProcessId)) { return $processCache[$ProcessId] }
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        $executablePath = $null
        $processStartedAt = $null
        try { $executablePath = $process.Path } catch {}
        try { $processStartedAt = $process.StartTime.ToUniversalTime().ToString('o') } catch {}
        $basename = if ($executablePath) {
            [IO.Path]::GetFileName($executablePath)
        } else {
            "$($process.ProcessName).exe"
        }
        $identity = [PSCustomObject]@{
            processId = $ProcessId
            processName = [string]$process.ProcessName
            executableBasename = [string]$basename
            processStartedAt = $processStartedAt
            alive = $true
        }
    } catch {
        $identity = [PSCustomObject]@{
            processId = $ProcessId
            processName = 'unavailable'
            executableBasename = ''
            processStartedAt = $null
            alive = $false
        }
    }
    $processCache[$ProcessId] = $identity
    return $identity
}

function Get-WindowIdentity([IntPtr]$Handle) {
    $processId = [AevraWindowHostProbe]::ProcessId($Handle)
    [PSCustomObject]@{
        hwnd = ('0x{0:X}' -f $Handle.ToInt64())
        process = Get-ProcessIdentity $processId
        isWindow = [AevraWindowHostProbe]::IsWindow($Handle)
        visible = [AevraWindowHostProbe]::IsWindowVisible($Handle)
        windowClass = [AevraWindowHostProbe]::ClassName($Handle)
    }
}

function Get-WindowChain([IntPtr]$Start, [ValidateSet('parent', 'owner')][string]$Relation) {
    $items = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[long]]::new()
    $current = $Start
    for ($depth = 0; $depth -lt 16 -and $current -ne [IntPtr]::Zero; $depth++) {
        if (-not $seen.Add($current.ToInt64())) { break }
        $items.Add((Get-WindowIdentity $current))
        if ($Relation -eq 'parent') {
            $current = [AevraWindowHostProbe]::GetParent($current)
        } else {
            $current = [AevraWindowHostProbe]::GetWindow($current, 4)
        }
    }
    return $items.ToArray()
}

$hostName = [IO.Path]::GetFileNameWithoutExtension($HostProcessName.Trim()).ToLowerInvariant()
$targetName = [IO.Path]::GetFileNameWithoutExtension($TargetProcessName.Trim()).ToLowerInvariant()
$hostWindows = [System.Collections.Generic.List[object]]::new()
$targetWindows = [System.Collections.Generic.List[object]]::new()
$targetWindowScanCount = 0
$unrelatedTargetWindowCount = 0
$otherRootHosts = @{}

foreach ($value in $handleValues) {
    $handle = [IntPtr]$value
    if (-not [AevraWindowHostProbe]::IsWindow($handle)) { continue }
    $identity = Get-WindowIdentity $handle
    $basename = $identity.process.executableBasename.ToLowerInvariant()
    if ($identity.isWindow -and $identity.visible -and $identity.process.alive -and $identity.process.processStartedAt -and $basename -eq "$hostName.exe") {
        $hostWindows.Add($identity)
    }
    if ($basename -ne "$targetName.exe") { continue }
    $targetWindowScanCount++

    $rootHandle = [AevraWindowHostProbe]::GetAncestor($handle, 2)
    $rootIdentity = if ($rootHandle -ne [IntPtr]::Zero) { Get-WindowIdentity $rootHandle } else { $null }
    if ($rootIdentity -and $rootIdentity.visible -and $rootIdentity.process.alive -and
        $rootIdentity.process.executableBasename.ToLowerInvariant() -ne "$targetName.exe") {
        $rootKey = "$($rootIdentity.process.processId)|$($rootIdentity.process.processStartedAt)|$($rootIdentity.windowClass)"
        if (-not $otherRootHosts.ContainsKey($rootKey)) {
            $otherRootHosts[$rootKey] = [PSCustomObject]@{
                process = $rootIdentity.process
                rootClass = $rootIdentity.windowClass
                visibleWebViewWindowCount = 0
            }
        }
        $otherRootHosts[$rootKey].visibleWebViewWindowCount++
    }
    $parentChain = @(Get-WindowChain $handle 'parent')
    $ownerChain = @(Get-WindowChain $handle 'owner')
    $rootOwnerChain = if ($rootHandle -ne [IntPtr]::Zero) {
        @(Get-WindowChain $rootHandle 'owner')
    } else {
        @()
    }
    $chain = @($parentChain) + @($ownerChain) + @($rootOwnerChain)
    $hostMatches = @($chain | Where-Object {
        $_.isWindow -and $_.visible -and $_.process.alive -and $_.process.processStartedAt -and
            $_.hwnd -ne $identity.hwnd -and
            $_.process.executableBasename.ToLowerInvariant() -eq "$hostName.exe"
    } | Sort-Object hwnd -Unique)
    $hostInstances = @($hostMatches | ForEach-Object {
        "$($_.process.processId)|$($_.process.processStartedAt)"
    } | Sort-Object -Unique)
    $targetInstanceIsKnown = $identity.isWindow -and $identity.visible -and $identity.process.alive -and $identity.process.processStartedAt
    $rootIsLiveHost = $rootIdentity -and $rootIdentity.hwnd -ne $identity.hwnd -and
        $rootIdentity.isWindow -and $rootIdentity.visible -and $rootIdentity.process.alive -and
        $rootIdentity.process.processStartedAt -and
        $rootIdentity.process.executableBasename.ToLowerInvariant() -eq "$hostName.exe"

    if ($hostMatches.Count -eq 0) {
        $unrelatedTargetWindowCount++
        continue
    }

    $targetWindows.Add([PSCustomObject]@{
        target = $identity
        rootHwnd = if ($rootHandle -eq [IntPtr]::Zero) { $null } else { '0x{0:X}' -f $rootHandle.ToInt64() }
        rootHost = $rootIdentity
        parentChain = $parentChain
        ownerChain = $ownerChain
        rootOwnerChain = $rootOwnerChain
        hostMatchCount = $hostMatches.Count
        hostHwndCount = @($hostMatches | Select-Object -ExpandProperty hwnd -Unique).Count
        hostInstanceCount = $hostInstances.Count
        relationship = if ($targetInstanceIsKnown -and $rootIsLiveHost -and $hostInstances.Count -eq 1) { 'verified' } else { 'unverified' }
    })
}

[PSCustomObject]@{
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    hostProcess = "$hostName.exe"
    targetProcess = "$targetName.exe"
    enumeratedWindowCount = $handleValues.Count
    targetWindowScanCount = $targetWindowScanCount
    unrelatedTargetWindowCount = $unrelatedTargetWindowCount
    otherRootHosts = @($otherRootHosts.Values)
    hostWindows = @($hostWindows.ToArray())
    targetWindows = @($targetWindows.ToArray())
} | ConvertTo-Json -Depth 12
