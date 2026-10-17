#!/usr/bin/env bash
# Required native test: private GNOME compositor and explicit fixture-only control.
# Does not install/enable anything in the human GNOME session.
set -euo pipefail
helper_root=$(cd "$(dirname "$0")/.." && pwd)
manifest=${AEVRA_WAYLAND_MANIFEST:-"$helper_root/Cargo.toml"}
package=()
if test -n "${AEVRA_WAYLAND_PACKAGE:-}"; then package=(-p "$AEVRA_WAYLAND_PACKAGE"); fi
cargo test --manifest-path "$manifest" "${package[@]}" --locked native_wayland_ --no-run
base=$(mktemp -d /tmp/aevra-wayland-native.XXXXXX)
export AEVRA_WAYLAND_PRIVATE_ROOT="$base"
export XDG_RUNTIME_DIR="$base/runtime" XDG_CONFIG_HOME="$base/config"
export XDG_DATA_HOME="$base/data" XDG_STATE_HOME="$base/state"
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"
chmod 700 "$XDG_RUNTIME_DIR"
extension="$XDG_DATA_HOME/gnome-shell/extensions/aevra-desktop@the-long-ride"
mkdir -p "$extension"
cp "$helper_root"/wayland/gnome/{metadata.json,policy.js,pixels.js} "$extension/"
cp "$helper_root/wayland/gnome/extension.js" "$extension/production.js"
cp "$helper_root/tests/fixtures/gnome_control.js" "$extension/extension.js"
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME GNOME_SHELL_SESSION_MODE=user
export LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=wayland NO_AT_BRIDGE=0 GTK_A11Y=always
export AEVRA_WAYLAND_FIXTURE="$helper_root/tests/fixtures/portable_wayland_fixture.py"
export AEVRA_WAYLAND_FIXTURE_STATE="$base/fixture.json"
export AEVRA_WAYLAND_LOG_DIR=${AEVRA_WAYLAND_LOG_DIR:-"$base/logs"}
mkdir -p "$AEVRA_WAYLAND_LOG_DIR"
unset WAYLAND_DISPLAY
dbus-run-session -- bash -c '
set -euo pipefail
manifest=$1; shift
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.desktop.interface enable-hot-corners false
gsettings set org.gnome.shell enabled-extensions "[\"aevra-desktop@the-long-ride\"]"
gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 > "$AEVRA_WAYLAND_LOG_DIR/gnome.log" 2>&1 & shell_pid=$!
fixture_pid=""
cleanup() {
  if test -n "$fixture_pid"; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  kill "$shell_pid" 2>/dev/null || true
  for n in $(seq 1 50); do kill -0 "$shell_pid" 2>/dev/null || break; sleep 0.1; done
  kill -KILL "$shell_pid" 2>/dev/null || true
  wait "$shell_pid" 2>/dev/null || true
}
trap cleanup EXIT
ready=0
# Cold software-rendered Shell startup can exceed ten seconds on busy CI hosts.
# Poll readiness rather than assuming startup has finished after a fixed delay.
for n in $(seq 1 120); do
  if gdbus introspect --session --dest org.gnome.Shell --object-path /org/aevra/Desktop 2>/dev/null | grep -q org.aevra.Desktop1; then ready=1; break; fi
  kill -0 "$shell_pid" 2>/dev/null || break
  sleep 0.25
done
if test "$ready" != 1; then cat "$AEVRA_WAYLAND_LOG_DIR/gnome.log"; echo "Required private GNOME companion failed to start" >&2; exit 1; fi
export WAYLAND_DISPLAY=$(basename "$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name "wayland-*" | head -1)")
/usr/bin/python3 "$AEVRA_WAYLAND_FIXTURE" "$AEVRA_WAYLAND_FIXTURE_STATE" > "$AEVRA_WAYLAND_LOG_DIR/gtk.log" 2>&1 & fixture_pid=$!
for n in $(seq 1 40); do test -f "$AEVRA_WAYLAND_FIXTURE_STATE" && break; sleep 0.25; done
if ! test -f "$AEVRA_WAYLAND_FIXTURE_STATE"; then cat "$AEVRA_WAYLAND_LOG_DIR/gtk.log"; exit 1; fi
cargo test --manifest-path "$manifest" "$@" --locked native_wayland_ -- --ignored --nocapture --test-threads=1
' bash "$manifest" "${package[@]}"
