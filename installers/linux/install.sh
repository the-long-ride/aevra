#!/usr/bin/env bash
set -euo pipefail
command -v aevra >/dev/null 2>&1 || { echo 'aevra CLI must be installed first' >&2; exit 1; }
aevra service install
aevra service start
echo 'Aevra user service installed. Run: aevra service status'
