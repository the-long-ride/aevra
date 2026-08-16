$ErrorActionPreference = 'Stop'
if (-not (Get-Command aevra -ErrorAction SilentlyContinue)) { throw 'aevra CLI must be installed first' }
& aevra service install
if ($LASTEXITCODE -ne 0) { throw 'Failed to install Aevra user service' }
& aevra service start
if ($LASTEXITCODE -ne 0) { throw 'Failed to start Aevra user service' }
Write-Host 'Aevra user service installed. Run: aevra service status'
