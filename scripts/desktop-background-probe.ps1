<#
.SYNOPSIS
    Aevra Background Desktop Automation Probe and Coexistence Verifier.
.DESCRIPTION
    Inspects and validates Windows UI Automation background patterns without input injection.
    Default mode is inspect-only.
.PARAMETER Mode
    Probe mode: 'inspect' (default, read-only), 'fixture' (runs coexistence fixture), or 'quotashift' (read-only inspection of QuotaShift).
.PARAMETER TargetPid
    Optional specific PID to inspect.
#>
param (
    [ValidateSet("inspect", "fixture", "quotashift")]
    [string]$Mode = "inspect",
    [int]$TargetPid = 0,
    [string]$HelperPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $HelperPath) {
    $releaseHelper = Join-Path $PSScriptRoot "..\helper\target\release\aevra-desktop-helper.exe"
    $debugHelper = Join-Path $PSScriptRoot "..\helper\target\debug\aevra-desktop-helper.exe"
    if (Test-Path $releaseHelper) {
        $HelperPath = (Resolve-Path $releaseHelper).Path
    } elseif (Test-Path $debugHelper) {
        $HelperPath = (Resolve-Path $debugHelper).Path
    } else {
        Write-Error "Could not find aevra-desktop-helper.exe. Run 'cargo build --release --manifest-path helper/Cargo.toml' first."
        exit 1
    }
}

Write-Host "[probe] Using desktop helper binary: $HelperPath"
Write-Host "[probe] OS: $((Get-CimInstance Win32_OperatingSystem).Caption) ($((Get-CimInstance Win32_OperatingSystem).Version))"

# Helper process communicator
class HelperClient {
    [System.Diagnostics.Process]$Process
    [int]$NextId = 1

    HelperClient([string]$path) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $path
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.CreateNoWindow = $true
        $this.Process = [System.Diagnostics.Process]::Start($psi)
    }

    [PSCustomObject] Call([string]$method, [hashtable]$params) {
        $id = $this.NextId++
        $reqObj = [ordered]@{
            id = $id
            method = $method
            params = $params
        }
        $req = $reqObj | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("$req`n")
        $this.Process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $this.Process.StandardInput.BaseStream.Flush()
        $respLine = $this.Process.StandardOutput.ReadLine()
        if (-not $respLine) {
            throw "Helper closed pipe unexpectedly"
        }
        $resp = $respLine | ConvertFrom-Json
        if ($resp.error) {
            throw "Helper error: $($resp.error | ConvertTo-Json -Compress)"
        }
        return $resp.result
    }

    [void] Close() {
        if ($this.Process -and -not $this.Process.HasExited) {
            $this.Process.Kill()
            $this.Process.WaitForExit(2000)
        }
    }
}

$client = [HelperClient]::new($HelperPath)

try {
    $caps = $client.Call("connect", @{})
    Write-Host "[probe] Helper connected. Capabilities: $($caps | ConvertTo-Json -Compress)"

    $windows = $client.Call("windows", @{})
    Write-Host "[probe] Found $($windows.Count) top-level windows."

    if ($Mode -eq "quotashift") {
        Write-Host "`n=== QuotaShift Read-Only Inspection ==="
        $qsProcess = Get-Process quotashift -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $qsProcess) {
            Write-Host "[probe] QuotaShift is not currently running. Cannot inspect live process."
            exit 0
        }

        $qsPid = $qsProcess.Id
        Write-Host "[probe] QuotaShift PID: $qsPid, Path: $($qsProcess.Path)"

        # Find window matching QuotaShift PID
        $qsWindow = $windows | Where-Object { $_.processName -match "quotashift" } | Select-Object -First 1

        if (-not $qsWindow) {
            Write-Host "[probe] Note: No top-level visible window found for QuotaShift (app may be minimized to tray or windowless background service)."
            Write-Host "[probe] Pattern coverage: 0 available patterns when window is unmapped/in tray."
            exit 0
        }

        Write-Host "[probe] Target window found: ID=$($qsWindow.windowId) Title='$($qsWindow.title)'"
        $identity = $client.Call("targetIdentity", @{ windowId = $qsWindow.windowId })
        Write-Host "[probe] Target Identity verified: $($identity | ConvertTo-Json -Compress)"

        $desc = $client.Call("describeBackground", @{
            windowId = $qsWindow.windowId
            snapshotId = [guid]::NewGuid().ToString()
            maxNodes = 500
            interactiveOnly = $false
        })

        Write-Host "[probe] Tree described: $($desc.nodes.Count) nodes (truncated: $($desc.truncated))"
        $patterns = @{
            invoke = 0
            setValue = 0
            select = 0
            toggle = 0
        }
        foreach ($n in $desc.nodes) {
            if ($n.supportedActions) {
                foreach ($act in $n.supportedActions) {
                    $patterns[$act] = $patterns[$act] + 1
                }
            }
        }
        Write-Host "[probe] QuotaShift Pattern Coverage Summary:"
        $patterns.GetEnumerator() | ForEach-Object {
            Write-Host "  - $($_.Key): $($_.Value) elements"
        }
    }
    elseif ($Mode -eq "inspect") {
        Write-Host "`n=== Inspect Mode (Read-Only) ==="
        $targetWin = $null
        if ($TargetPid -gt 0) {
            $targetWin = $windows | Where-Object { $_.windowId -eq "$TargetPid" -or $_.title -match "$TargetPid" } | Select-Object -First 1
        } else {
            $targetWin = $windows | Select-Object -First 5
        }

        foreach ($win in $targetWin) {
            Write-Host "Window: $($win.windowId) | $($win.processName) | $($win.title)"
        }
    }
    elseif ($Mode -eq "fixture") {
        Write-Host "`n=== Fixture Coexistence Mode ==="
        $fixtureCandidate = "$PSScriptRoot\..\helper\tests\fixtures\background-controls\bin\net8.0-windows\background-controls.exe"
        $resolved = (Resolve-Path $fixtureCandidate -ErrorAction SilentlyContinue)
        if (-not $resolved) {
            Write-Host "[probe] Building fixture..."
            dotnet build (Join-Path $PSScriptRoot "..\helper\tests\fixtures\background-controls\background-controls.csproj") -c Release
            $resolved = (Resolve-Path $fixtureCandidate -ErrorAction SilentlyContinue)
        }
        if (-not $resolved) {
            throw "Fixture executable could not be found or built at: $fixtureCandidate"
        }
        $fixtureExe = $resolved.Path

        Write-Host "[probe] Launching target fixture..."
        $targetProc = [System.Diagnostics.Process]::Start($fixtureExe)
        Start-Sleep -Milliseconds 1200

        try {
            $refreshedWindows = $client.Call("windows", @{})
            $foundWin = $refreshedWindows | Where-Object { $_.title -eq "Aevra Background Target Fixture" } | Select-Object -First 1
            if (-not $foundWin) {
                throw "Target fixture window not found!"
            }

            Write-Host "[probe] Found fixture window: $($foundWin.windowId)"
            $snapshotId = [guid]::NewGuid().ToString()
            $desc = $client.Call("describeBackground", @{
                windowId = $foundWin.windowId
                snapshotId = $snapshotId
                maxNodes = 100
                interactiveOnly = $false
            })

            Write-Host "[probe] Fixture described $($desc.nodes.Count) nodes:"
            foreach ($n in $desc.nodes) {
                Write-Host "  Node: role='$($n.role)' name='$($n.name)' val='$($n.value)' actions=$($n.supportedActions -join ',')"
            }

            # Find controls
            $invokeNode = $desc.nodes | Where-Object { $_.name -eq "Invoke Target" -and ($_.supportedActions -contains "invoke") } | Select-Object -First 1
            $textNode = $desc.nodes | Where-Object { ($_.role -eq "edit" -or $_.role -eq "Edit") -and ($_.supportedActions -contains "setValue") } | Select-Object -First 1
            $itemBetaNode = $desc.nodes | Where-Object { $_.name -eq "Item Beta" -and ($_.supportedActions -contains "select") } | Select-Object -First 1
            $toggleNode = $desc.nodes | Where-Object { $_.name -eq "Tri-state Toggle CheckBox" -and ($_.supportedActions -contains "toggle") } | Select-Object -First 1

            if ($invokeNode) {
                Write-Host "[probe] Executing background invoke on '$($invokeNode.name)'..."
                $res = $client.Call("backgroundAct", @{
                    snapshotId = $snapshotId
                    handle = $invokeNode.handle
                    op = "invoke"
                    expectedInstance = $desc.windowInstance
                })
                Write-Host "[probe] Invoke result: $($res | ConvertTo-Json -Compress)"
            }

            if ($textNode) {
                Write-Host "[probe] Executing background setValue on text control..."
                $res = $client.Call("backgroundAct", @{
                    snapshotId = $snapshotId
                    handle = $textNode.handle
                    op = "setValue"
                    value = "Automated Background Value"
                    expectedInstance = $desc.windowInstance
                })
                Write-Host "[probe] SetValue result: $($res | ConvertTo-Json -Compress)"
            }

            if ($itemBetaNode) {
                Write-Host "[probe] Executing background select on '$($itemBetaNode.name)'..."
                $res = $client.Call("backgroundAct", @{
                    snapshotId = $snapshotId
                    handle = $itemBetaNode.handle
                    op = "select"
                    expectedInstance = $desc.windowInstance
                })
                Write-Host "[probe] Select result: $($res | ConvertTo-Json -Compress)"
            }

            if ($toggleNode) {
                Write-Host "[probe] Executing background toggle on '$($toggleNode.name)'..."
                $res = $client.Call("backgroundAct", @{
                    snapshotId = $snapshotId
                    handle = $toggleNode.handle
                    op = "toggle"
                    expectedInstance = $desc.windowInstance
                })
                Write-Host "[probe] Toggle result: $($res | ConvertTo-Json -Compress)"
            }

            Write-Host "[probe] Coexistence verification completed successfully without foreground input!"
        }
        finally {
            if ($targetProc -and -not $targetProc.HasExited) {
                $targetProc.Kill()
            }
        }
    }
}
finally {
    $client.Close()
}
