# GNOME and KDE Wayland desktop access

Aevra and standalone desktop share a native GNOME Wayland adapter. It captures an explicitly allowed window and sends foreground click, text, key and wheel input through GNOME's compositor. It never substitutes XWayland, privileged uinput or a crop of the monitor. KDE KWin 6.6 also has a native plugin with the same window authorization contract; setup differs as described below. Other compositors remain unsupported.

## Enable access

1. Install the companion archive included with Linux helper/desktop release files:

   ```sh
   gnome-extensions install ./aevra-desktop@the-long-ride.shell-extension.zip
   ```

2. Log out/in if GNOME does not discover the newly installed extension, then enable it:

   ```sh
   gnome-extensions enable aevra-desktop@the-long-ride
   ```

3. In the keyboard icon's panel menu, enable **Allow Aevra desktop access**. Connect the Aevra desktop client once. Approve the actual **Allow helper: /absolute/path** item that appears in that menu, then reconnect. Only the human-approved `aevra-desktop-helper` or `aevra-desktop` executable path can open compositor sessions. A custom-renamed helper binary is refused.
4. Grant the application in Aevra's existing desktop policy or standalone's Allowed apps list. OS access does not replace that application authorization.

Pausing access, locking the session or disabling the companion revokes existing connections and releases held input. Re-enable access and approve the helper path again after unlocking. The companion does not install/enable itself or silently restore authority. A helper that loses its compositor owner does not reconnect halfway through an authorized action.

## KDE KWin 6.6 setup

The Linux release also includes `aevra-wayland-kde-source.zip`. Compile it against the exact installed KWin 6.6 release; binary plugins must be rebuilt after KWin upgrades. Follow the archive's README or [canonical build and grant instructions](../../helper/wayland/kde/README.md). The plugin is disabled by default. Human installation, explicit plugin enablement and a private grant file containing the actual helper executable path and a fresh nonce are required. Aevra does not write this grant file.

Grant nonces are persisted as consumed before publishing access. Pause, lock, plugin/compositor restart or changing the approved path requires a fresh grant and explicit reconnect. Removing the grant file or setting `enabled` false pauses access. The consumed-nonce store is owner-only and bounded to 4096 grants; corruption or exhaustion refuses access until the user repairs the state. Ordinary backend reconnect during a still-enabled grant is supported. KWin file capabilities can hide `/proc/exe`; the helper authenticates the exact D-Bus PID against the kernel peer credentials of its actual Wayland socket instead of trusting a process name.

Native local evidence covers KWin 6.6.6 with its software renderer on Ubuntu 26.04. Both software and OpenGL window-item rendering paths are implemented; physical-GPU/OpenGL capture acceptance remains outstanding. Other KWin minor versions are refused at build time. True lock and production grant-file/path UI flows still need native desktop acceptance; the fixture simulates permission decisions and uses a separate test-only plugin.

## Scope and recovery

The extension declares GNOME 45–50 compatibility; current native evidence is GNOME 50 on Ubuntu 26.04, with GNOME 46 coverage configured in the native CI runner. Unsupported versions, absent companion, missing access, ambiguous window mapping or locked sessions produce an explicit refusal. Build/CI configuration alone is not native runtime evidence.

Capture/input target native Wayland clients. XWayland clients are refused because their self-reported PID cannot provide this adapter’s attribution guarantee. Capture is window-scoped. Use an explicit `windowId`; primary-monitor capture is refused on this adapter. Captures come from the target's compositor texture, including when another window overlaps it. Pointer input requires the actual reactive surface under the point to belong to the authorized window; shell overlays, menus and overlapping windows block it. AT-SPI reports window-relative coordinates on some Wayland clients: Aevra binds a unique PID and exact compositor frame or client-buffer size, then translates the verified element offset using that rectangle. Client-side decoration/shadow padding is explicit metadata; the captured actor is cropped to the logical frame, with matching scale. Ambiguous same-process windows are refused. Do not treat a window image's origin as the monitor origin.

Unicode text uses the compositor input method and requires a live editable input-method focus. Raw chords use the virtual keyboard. Protected-field checks and the authorized window/process/executable/host identity remain enforced. If an action reports `DESKTOP_OUTCOME_UNKNOWN`, observe again before continuing; do not blindly retry a click or text insertion.

Standalone `aevra-desktop doctor --json` and Settings show runtime readiness. Root clients can inspect `desktop_status`; when permission is missing, enable/approve the companion and reconnect. Explicit reconnect invalidates old element refs, background snapshots and native window mappings; observe again before using input. GNOME 46 returns the stage itself when no Shell actor owns keyboard focus; this fallback permits normal application input, as does the null focus on newer GNOME. Shell modal dialogs, overview search and Shell-owned keyboard focus refuse native input even when the application MetaWindow remains focused. KDE wheel input preserves fractional native pointer positions while public move coordinates remain integers. AT-SPI semantic actions remain available independently when their provider can identify the target.

## Build and test

Build an installable archive from canonical source without installing it:

```sh
python3 helper/wayland/package-companion.py ./artifacts
```

Run `node --test helper/wayland/gnome/policy.test.mjs` for the compositor permission and GNOME 46/newer keyboard-focus regression checks.

Native prerequisites: GNOME Shell, GTK3/PyGObject, AT-SPI, D-Bus, Mesa software rendering and `python3-gi-cairo`. Run:

```sh
bash helper/tests/run-wayland-gnome.sh
```

For standalone, first prepare its canonical overlay, then run:

```sh
AEVRA_WAYLAND_MANIFEST="$PWD/Cargo.toml" AEVRA_WAYLAND_PACKAGE=aevra-desktop-helper \
  bash vendor/aevra/helper/tests/run-wayland-gnome.sh
```

The runner creates a private headless GNOME session and temporary extension directory. Its fixture-only controller simulates permission decisions and window layout; it is excluded from the distributed companion. The actual backend verifies button/wheel events, exact Unicode text and selection/replacement, isolated pixels beneath a sentinel, protected-field refusal, focus changes and pause revocation. Missing prerequisites fail the required run. Held-button disconnect must deliver a release without later pointer traffic. Windows/macOS/X11 fixtures remain separate acceptance checks.

For KWin, install its development headers, Qt6, Extra CMake Modules, CMake/Ninja, Wayland and libdrm, then run `bash helper/tests/run-wayland-kde.sh`. Use the same standalone manifest/package overrides shown above. This creates a private virtual KWin compositor and builds a separate fixture plugin; it never installs or enables the plugin in the human desktop.

The native implementation is a canonical Rust library consumed by both the stdio helper and standalone actor. Its library tests run as package `aevra-desktop-helper` in the standalone workspace; `desktop-core` owns the actor rather than a second native module/dependency graph. To repeat the decorated GTK acceptance, set `AEVRA_WAYLAND_DECORATED=1` before running the GNOME fixture. The fixture also checks compositor-boundary Shell refusal, fractional KDE wheel input and explicit reconnect after a full/stale native binding cache.
