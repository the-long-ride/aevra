import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Access, eligibleHelper, keyboardAllowed, shellHasKeyFocus } from './policy.js';
import { capture } from './pixels.js';

const XML = `<node><interface name="org.aevra.Desktop1">
<method name="Call"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Capture"><arg type="u" direction="in"/><arg type="ay" direction="out"/></method>
</interface></node>`;

export default class DesktopAccess extends Extension {
  enable() {
    this.access = new Access();
    this.peers = new Map();
    this.approvedPaths = new Set();
    this.pendingPaths = new Map();
    this.captures = new Set();
    this.button = new PanelMenu.Button(0, 'Aevra desktop access');
    this.icon = new St.Icon({
      icon_name: 'input-keyboard-symbolic',
      style_class: 'system-status-icon',
    });
    this.button.add_child(this.icon);
    this.toggle = new PopupMenu.PopupSwitchMenuItem('Allow Aevra desktop access', false);
    this.toggle.connect('toggled', (_item, value) => this.setAccess(value));
    this.button.menu.addMenuItem(this.toggle);
    const explanation = new PopupMenu.PopupMenuItem(
      'Connect Aevra, then approve its helper path below. App grants stay in Aevra.',
      { reactive: false },
    );
    this.button.menu.addMenuItem(explanation);
    Main.panel.addToStatusArea(this.uuid, this.button);
    this.lockSignal = Main.sessionMode.connect('updated', () => {
      if (this.locked()) this.setAccess(false);
    });
    this.object = Gio.DBusExportedObject.wrapJSObject(XML, this);
    this.object.export(Gio.DBus.session, '/org/aevra/Desktop');
  }
  seat() {
    const backend = global.stage.context?.get_backend() ?? Clutter.get_default_backend();
    return backend.get_default_seat();
  }
  locked() {
    // Mutter 50 is Wayland-only and removed is_wayland_compositor().
    const x11 = typeof Meta.is_wayland_compositor === 'function' && !Meta.is_wayland_compositor();
    return Main.sessionMode.isLocked || Main.sessionMode.isGreeter || x11;
  }
  setAccess(value) {
    this.access.enable(value && !this.locked());
    if (!this.access.enabled) for (const owner of [...this.peers.keys()]) this.close(owner);
    if (!this.access.enabled) {
      this.approvedPaths.clear();
      for (const item of this.pendingPaths.values()) item.destroy();
      this.pendingPaths.clear();
    }
    this.toggle.setToggleState(this.access.enabled);
    this.icon.icon_name = this.access.enabled
      ? 'input-keyboard-symbolic'
      : 'changes-prevent-symbolic';
  }
  close(owner) {
    const peer = this.peers.get(owner);
    if (peer) {
      for (const key of peer.keys)
        peer.keyboard?.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
      if (peer.button)
        peer.pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
      // Release events still reference these devices in Mutter's event queue.
      // Let normal GObject/GJS ownership retire them after queued events drain;
      // forced run_dispose() here can crash Shell with a held button on disconnect.
      peer.keyboard = null;
      peer.pointer = null;
      Gio.bus_unwatch_name(peer.watch);
      this.peers.delete(owner);
    }
    this.access.close(owner);
  }
  open(owner) {
    if (this.locked()) throw Error('DESKTOP_PERMISSION_REQUIRED');
    if (!this.isCallerAllowed(owner)) throw Error('DESKTOP_PERMISSION_REQUIRED');
    if (!this.peers.has(owner) && this.peers.size >= 32) throw Error('DESKTOP_INPUT_REFUSED');
    this.access.open(owner);
    if (!this.peers.has(owner)) {
      const peer = {
        keyboard: this.seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE),
        pointer: this.seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE),
        keys: new Set(),
        button: false,
      };
      peer.watch = Gio.bus_watch_name_on_connection(
        Gio.DBus.session,
        owner,
        Gio.BusNameWatcherFlags.NONE,
        null,
        () => this.close(owner),
      );
      this.peers.set(owner, peer);
    }
    return { version: 1 };
  }
  isCallerAllowed(owner) {
    if (!this.access.enabled) return false;
    const get = (method) =>
      Gio.DBus.session
        .call_sync(
          'org.freedesktop.DBus',
          '/org/freedesktop/DBus',
          'org.freedesktop.DBus',
          method,
          new GLib.Variant('(s)', [owner]),
          new GLib.VariantType('(u)'),
          Gio.DBusCallFlags.NONE,
          1000,
          null,
        )
        .deep_unpack()[0];
    const uid = get('GetConnectionUnixUser');
    const path = GLib.file_read_link(`/proc/${get('GetConnectionUnixProcessID')}/exe`);
    if (!eligibleHelper(path, uid, Gio.Credentials.new().get_unix_user())) return false;
    if (this.approvedPaths.has(path)) return true;
    if (!this.pendingPaths.has(path) && this.pendingPaths.size < 8) {
      const item = new PopupMenu.PopupMenuItem(`Allow helper: ${path}`);
      item.connect('activate', () => {
        if (this.access.enabled && !this.locked()) this.approvedPaths.add(path);
        this.pendingPaths.delete(path);
        item.destroy();
      });
      this.pendingPaths.set(path, item);
      this.button.menu.addMenuItem(item);
    }
    return false;
  }
  actors() {
    return global.get_window_actors().filter((a) => {
      const window = a.meta_window;
      const rect = window.get_frame_rect();
      // Native Wayland PID comes from client credentials; an X11 client's
      // self-reported _NET_WM_PID is insufficient for this adapter's binding.
      const native =
        typeof window.get_client_type !== 'function' ||
        window.get_client_type() === Meta.WindowClientType.WAYLAND;
      return (
        native && !window.minimized && window.get_pid() > 0 && rect.width > 0 && rect.height > 0
      );
    });
  }
  windowInfo(window) {
    const rect = window.get_frame_rect();
    const buffer = window.get_buffer_rect();
    return {
      id: window.get_stable_sequence(),
      pid: window.get_pid(),
      focused: global.display.focus_window === window,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      buffer: { x: buffer.x, y: buffer.y, width: buffer.width, height: buffer.height },
    };
  }
  actor(id) {
    return this.actors().find((a) => a.meta_window.get_stable_sequence() === id);
  }
  hit(x, y) {
    let picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
    while (picked) {
      if (picked.meta_window) return picked.meta_window.get_stable_sequence();
      picked = picked.get_parent();
    }
    return 0;
  }
  input(owner, args) {
    const peer = this.peers.get(owner);
    // Cleanup is always allowed for this peer's held inputs, including on lock.
    if (args.down === false && peer) {
      if (args.op === 'key' && peer.keys.delete(args.key))
        peer.keyboard.notify_keyval(GLib.get_monotonic_time(), args.key, Clutter.KeyState.RELEASED);
      if (args.op === 'button' && peer.button) {
        peer.pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        peer.button = false;
      }
      return true;
    }
    const actor = this.actor(args.id);
    const target = actor ? this.windowInfo(actor.meta_window) : null;
    this.access.target(owner, this.locked(), args, target);
    const time = GLib.get_monotonic_time();
    if (args.op === 'key' || args.op === 'text') {
      const focus = Main.inputMethod.currentFocus;
      if (
        !keyboardAllowed(
          {
            modalCount: Main.modalCount,
            overview: Main.overview.visible,
            shellKeyFocus: shellHasKeyFocus(global.stage.get_key_focus(), global.stage),
            normalMode: Main.actionMode === Shell.ActionMode.NORMAL,
            nativeTextFocus:
              focus && GObject.type_name(focus.constructor.$gtype) === 'MetaWaylandTextInputFocus',
          },
          args.op === 'text',
        )
      )
        throw Error('DESKTOP_INPUT_REFUSED');
      const purpose = Main.inputMethod.contentPurpose;
      if ([Clutter.InputContentPurpose.PASSWORD, Clutter.InputContentPurpose.PIN].includes(purpose))
        throw Error('DESKTOP_INPUT_REFUSED');
      if (args.op === 'text') {
        if (
          typeof args.text !== 'string' ||
          [...args.text].length !== 1 ||
          args.text.includes('\0') ||
          !Main.inputMethod.currentFocus
        )
          throw Error('DESKTOP_INPUT_REFUSED');
        Main.inputMethod.commit(args.text);
      } else {
        if (!Number.isInteger(args.key) || args.key <= 0) throw Error('DESKTOP_INPUT_REFUSED');
        peer.keyboard ??= this.seat().create_virtual_device(
          Clutter.InputDeviceType.KEYBOARD_DEVICE,
        );
        peer.keys.add(args.key);
        peer.keyboard.notify_keyval(time, args.key, Clutter.KeyState.PRESSED);
      }
    } else if (['move', 'button', 'scroll'].includes(args.op)) {
      const [px, py] = global.get_pointer();
      const x = args.op === 'move' ? args.x : px;
      const y = args.op === 'move' ? args.y : py;
      this.access.point(target, x, y);
      if (this.hit(x, y) !== args.id) throw Error('DESKTOP_INPUT_REFUSED');
      peer.pointer ??= this.seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
      if (args.op === 'move') peer.pointer.notify_absolute_motion(time, x, y);
      if (args.op === 'button') {
        peer.button = true;
        peer.pointer.notify_button(time, 1, Clutter.ButtonState.PRESSED);
      }
      if (args.op === 'scroll') {
        if (!Number.isInteger(args.steps) || Math.abs(args.steps) > 100)
          throw Error('DESKTOP_INPUT_REFUSED');
        const direction =
          args.steps > 0 ? Clutter.ScrollDirection.DOWN : Clutter.ScrollDirection.UP;
        for (let i = 0; i < Math.abs(args.steps); i++)
          peer.pointer.notify_discrete_scroll(time, direction, Clutter.ScrollSource.WHEEL);
      }
    } else throw Error('DESKTOP_INPUT_REFUSED');
    return true;
  }
  CallAsync([method, json], invocation) {
    try {
      if (json.length > 65536) throw Error('DESKTOP_INPUT_REFUSED');
      const args = JSON.parse(json);
      const owner = invocation.get_sender();
      let value;
      if (method === 'Open') {
        if (args.version !== 1) throw Error('DESKTOP_INPUT_REFUSED');
        value = this.open(owner);
      } else if (method === 'Input') value = this.input(owner, args);
      else {
        this.access.require(owner, this.locked());
        if (method === 'Probe') value = { version: 1 };
        else if (method === 'Windows')
          value = this.actors().map((a) => this.windowInfo(a.meta_window));
        else if (method === 'Hit') value = this.hit(args.x, args.y);
        else if (method === 'Pointer') value = global.get_pointer().slice(0, 2);
        else throw Error('DESKTOP_INPUT_REFUSED');
      }
      invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(value)]));
    } catch (error) {
      const code = /^DESKTOP_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'DESKTOP_PROVIDER_UNAVAILABLE';
      invocation.return_value(new GLib.Variant('(s)', [JSON.stringify({ error: code })]));
    }
  }
  async CaptureAsync([id], invocation) {
    const owner = invocation.get_sender();
    let reserved = false;
    try {
      this.access.require(owner, this.locked());
      if (this.captures.has(owner) || this.captures.size >= 2) throw Error('DESKTOP_INPUT_REFUSED');
      this.captures.add(owner);
      reserved = true;
      const actor = this.actor(id);
      if (!actor) throw Error('DESKTOP_TARGET_CHANGED');
      const bytes = await capture(actor);
      this.access.require(owner, this.locked());
      if (this.actor(id) !== actor) throw Error('DESKTOP_TARGET_CHANGED');
      invocation.return_value(new GLib.Variant('(ay)', [bytes]));
    } catch (_) {
      invocation.return_dbus_error(
        'org.aevra.Desktop.Refused',
        'Capture unavailable; check access and target',
      );
    } finally {
      if (reserved) this.captures.delete(owner);
    }
  }
  disable() {
    this.setAccess(false);
    Main.sessionMode.disconnect(this.lockSignal);
    this.object.unexport();
    this.button.destroy();
  }
}
