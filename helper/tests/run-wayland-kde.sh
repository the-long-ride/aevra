#!/usr/bin/env bash
# Required KWin 6.6 test. Private compositor and fixture plugin only.
set -euo pipefail
helper_root=$(cd "$(dirname "$0")/.." && pwd)
manifest=${AEVRA_WAYLAND_MANIFEST:-"$helper_root/Cargo.toml"}
package=()
if test -n "${AEVRA_WAYLAND_PACKAGE:-}"; then package=(-p "$AEVRA_WAYLAND_PACKAGE"); fi
build=${AEVRA_KDE_TEST_BUILD:-"${CARGO_TARGET_DIR:-$helper_root/target}/aevra-kde-fixture"}
cmake -S "$helper_root/wayland/kde" -B "$build" -G Ninja -DAEVRA_NATIVE_FIXTURE=ON
cmake --build "$build" -j 3
ctest --test-dir "$build" --output-on-failure
cargo test --manifest-path "$manifest" "${package[@]}" --locked native_wayland_ --no-run
base=$(mktemp -d /tmp/aevra-kwin-native.XXXXXX)
export XDG_RUNTIME_DIR="$base/runtime" XDG_CONFIG_HOME="$base/config"
export XDG_DATA_HOME="$base/data" XDG_STATE_HOME="$base/state"
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"
chmod 700 "$XDG_RUNTIME_DIR"
printf "[Plugins]\naevra-desktopEnabled=true\n[Compositing]\nAnimationSpeed=0\n" > "$XDG_CONFIG_HOME/kwinrc"
export QT_PLUGIN_PATH="$build${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}"
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=KDE
export KWIN_COMPOSE=O2 LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=wayland NO_AT_BRIDGE=0 GTK_A11Y=always
export AEVRA_WAYLAND_TEST_SERVICE=org.kde.KWin
export AEVRA_WAYLAND_FIXTURE="$helper_root/tests/fixtures/portable_wayland_fixture.py"
export AEVRA_WAYLAND_FIXTURE_STATE="$base/fixture.json"
export AEVRA_WAYLAND_LOG_DIR=${AEVRA_WAYLAND_LOG_DIR:-"$base/logs"}
mkdir -p "$AEVRA_WAYLAND_LOG_DIR"
unset WAYLAND_DISPLAY DISPLAY
dbus-run-session -- bash -c '
set -euo pipefail
manifest=$1; shift
kwin_wayland --virtual --width 1280 --height 800 --socket aevra-wayland --no-lockscreen --no-global-shortcuts --no-kactivities > "$AEVRA_WAYLAND_LOG_DIR/kwin.log" 2>&1 & shell_pid=$!
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
for n in $(seq 1 60); do
 if gdbus introspect --session --dest org.kde.KWin --object-path /org/aevra/Desktop 2>/dev/null | grep -q org.aevra.Desktop1; then ready=1; break; fi
 kill -0 "$shell_pid" 2>/dev/null || break
 sleep 0.25
done
if test "$ready" != 1; then cat "$AEVRA_WAYLAND_LOG_DIR/kwin.log"; echo "Required private KWin companion failed to start" >&2; exit 1; fi
export WAYLAND_DISPLAY=aevra-wayland
/usr/bin/python3 "$AEVRA_WAYLAND_FIXTURE" "$AEVRA_WAYLAND_FIXTURE_STATE" > "$AEVRA_WAYLAND_LOG_DIR/gtk.log" 2>&1 & fixture_pid=$!
for n in $(seq 1 40); do test -f "$AEVRA_WAYLAND_FIXTURE_STATE" && break; sleep 0.25; done
if ! test -f "$AEVRA_WAYLAND_FIXTURE_STATE"; then cat "$AEVRA_WAYLAND_LOG_DIR/gtk.log"; exit 1; fi
cargo test --manifest-path "$manifest" "$@" --locked native_wayland_ -- --ignored --nocapture --test-threads=1
' bash "$manifest" "${package[@]}"
