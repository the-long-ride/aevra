"""Dedicated native Wayland GTK target. Never connects to the human session."""
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib, Gdk
import json
import os
import sys

path = sys.argv[1]
sentinel = "--sentinel" in sys.argv
window = Gtk.Window(title="Aevra native Wayland fixture")
window.set_default_size(400, 240)
window.set_decorated(os.environ.get("AEVRA_WAYLAND_DECORATED")=="1")
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
window.add(box)
notes = Gtk.Entry()
notes.get_accessible().set_name("Native notes")
box.pack_start(notes, False, False, 0)
password = Gtk.Entry()
password.set_visibility(False)
password.get_accessible().set_name("Protected value")
box.pack_start(password, False, False, 0)
clicks = 0
scrolls = 0
presses = 0
releases = 0
def clicked(_):
    global clicks
    clicks += 1
button = Gtk.Button(label="Fixture button")
button.connect("clicked", clicked)
def pressed(*_):
    global presses
    presses += 1
    return False
def released(*_):
    global releases
    releases += 1
    return False
button.connect("button-press-event", pressed)
button.connect("button-release-event", released)
box.pack_start(button, False, False, 0)
area = Gtk.DrawingArea()
def draw(_, cr):
    cr.set_source_rgb(*( (0.8, 0, 0.8) if sentinel else (0, 2 / 3, 4 / 15) ))
    cr.paint()
area.connect("draw", draw)
box.pack_start(area, True, True, 0)
window.add_events(Gdk.EventMask.SCROLL_MASK | Gdk.EventMask.SMOOTH_SCROLL_MASK)
def scrolled(_, event):
    global scrolls
    scrolls += 1
    return True
window.connect("scroll-event", scrolled)
window.connect("destroy", Gtk.main_quit)
window.show_all()
notes.grab_focus()
window.present()
def publish():
    value = {"pid": os.getpid(), "text": notes.get_text(), "selection": notes.get_selection_bounds(), "password": password.get_text(), "clicks": clicks, "scrolls": scrolls, "presses": presses, "releases": releases}
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as output:
        json.dump(value, output)
    os.replace(temp, path)
    return GLib.SOURCE_CONTINUE
GLib.timeout_add(25, publish)
publish()
Gtk.main()
