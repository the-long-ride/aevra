"""Dedicated accessible fixture; launched only on the test's private X display."""
import json
import os
import sys
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("GdkX11", "3.0")
from gi.repository import Gtk, GLib, GdkX11

state_path = sys.argv[1]
window = Gtk.Window(title="Aevra native backend fixture")
window.set_decorated(False)
window.set_default_size(400, 200)
window.move(0, 0)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
box.set_border_width(20)
entry = Gtk.Entry()
entry.get_accessible().set_name("Native notes")
password = Gtk.Entry()
password.set_visibility(False)
password.get_accessible().set_name("Protected value")
button = Gtk.Button(label="Native action")
clicks = 0

def clicked(*_):
    global clicks
    clicks += 1

button.connect("clicked", clicked)
for child in [entry, password, button]:
    box.pack_start(child, False, False, 0)
window.add(box)
window.connect("destroy", Gtk.main_quit)
window.show_all()
entry.grab_focus()
window.present()

def publish():
    data = {"windowId": GdkX11.X11Window.get_xid(window.get_window()),
            "text": entry.get_text(), "password": password.get_text(), "clicks": clicks}
    temporary = state_path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as output:
        json.dump(data, output, ensure_ascii=False)
    os.replace(temporary, state_path)
    return True

GLib.timeout_add(25, publish)
Gtk.main()
