# Aevra KDE Wayland companion (KWin 6.6)

This native plugin must be compiled against the exact installed KWin release. It is disabled by default. It reads a human-created, private `$XDG_CONFIG_HOME/aevra-wayland.json` grant; Aevra never writes this file. Use a native Wayland application with AT-SPI enabled.

Build with KWin development headers, Qt6, Extra CMake Modules, Wayland, libdrm and libxkbcommon:

```sh
cmake -S . -B build -G Ninja -DAEVRA_NATIVE_FIXTURE=OFF
cmake --build build -j 3
ctest --test-dir build --output-on-failure
```

Copy `build/kwin/plugins/aevra-desktop.so` into the KWin native plugin directory for your distribution (shown by `qtpaths6 --plugin-dir`, then `kwin/plugins`). Rebuild after every KWin upgrade. Enable explicitly with `kwriteconfig6 --file kwinrc --group Plugins --key aevra-desktopEnabled true`, then log out/in. Do not attempt to replace a running loaded plugin.

Create a grant as your graphical-session user, replacing the actual helper path:

```sh
python3 - /absolute/path/to/aevra-desktop-helper <<'PY'
import json, os, pathlib, sys, uuid
path = pathlib.Path(os.environ.get('XDG_CONFIG_HOME', str(pathlib.Path.home()/'.config'))) / 'aevra-wayland.json'
path.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as f:
    json.dump({'enabled': True, 'helperPath': str(pathlib.Path(sys.argv[1]).resolve()), 'grant': str(uuid.uuid4())}, f)
PY
```

For standalone use, supply the actual `aevra-desktop` executable. Reconnect Aevra after granting. To pause, remove the grant file or set `enabled` to false. Grant nonces are persisted as consumed before publishing access. Plugin/compositor restart and session lock require a fresh grant; after unlocking or restarting, create a new grant with a fresh nonce using the command above and reconnect. App allowlists and connection permissions still apply. Monitor capture and XWayland fallback are refused.

`AEVRA_NATIVE_FIXTURE=ON` enables private test controls and must never be used for a distributed plugin. `helper/tests/run-wayland-kde.sh` creates a private virtual compositor for acceptance; it does not change the human desktop. Production binaries must be built with the default OFF value.
