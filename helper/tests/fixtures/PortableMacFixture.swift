// Build: swiftc PortableMacFixture.swift -o portable-mac-fixture -framework AppKit
import AppKit
let statePath = CommandLine.arguments[1]
final class FixtureWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
var editorView: FixtureView?
var editorWindow: NSWindow?
var palette: NSPanel?
final class FixtureView: NSView {
    var text = ""
    var clicks = 0
    var scrolls = 0
    override var acceptsFirstResponder: Bool { true }
    func save() {
        let value: [String: Any] = ["text": text, "clicks": clicks, "scrolls": scrolls,
            "windowId": window?.windowNumber ?? 0,
            "editorWindowId": editorWindow?.windowNumber ?? 0,
            "editorText": editorView?.text ?? ""]
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            try? data.write(to: URL(fileURLWithPath: statePath), options: .atomic)
        }
    }
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedRed: 0, green: 2.0/3.0, blue: 4.0/15.0, alpha: 1).setFill()
        bounds.fill()
        NSColor.blue.setFill()
        NSRect(x: 5, y: 5, width: 10, height: 10).fill()
    }
    override func mouseDown(with event: NSEvent) {
        clicks += 1
        window?.makeFirstResponder(self)
        save()
    }
    override func keyDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "a" { text = "" }
        else if let value = event.characters { text += value }
        save()
    }
    override func scrollWheel(with event: NSEvent) { scrolls += 1; save() }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = FixtureWindow(contentRect: NSRect(x: 100,y: 100,width: 400,height: 200),
    styleMask: [.borderless], backing: .buffered, defer: false)
let view = FixtureView(frame: NSRect(x: 0,y: 0,width: 400,height: 200))
window.contentView = view
window.title = "Aevra native parity fixture"
if CommandLine.arguments.contains("--multi-window") {
    let second = FixtureWindow(contentRect: NSRect(x: 550,y: 100,width: 400,height: 200),
        styleMask: [.borderless], backing: .buffered, defer: false)
    let secondView = FixtureView(frame: NSRect(x: 0,y: 0,width: 400,height: 200))
    second.contentView = secondView
    second.title = "Aevra second editor"
    second.makeFirstResponder(secondView)
    second.orderFront(nil)
    editorWindow = second
    editorView = secondView
    let panel = NSPanel(contentRect: NSRect(x: 10,y: 10,width: 80,height: 80),
        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.title = "Aevra non-key palette"
    panel.orderFrontRegardless()
    palette = panel
}
window.makeKeyAndOrderFront(nil)
window.makeFirstResponder(view)
app.activate(ignoringOtherApps: true)
var occluder: NSWindow?
if CommandLine.arguments.contains("--occluder") {
    let overlay = NSWindow(contentRect: NSRect(x: 250,y: 140,width: 100,height: 100),
        styleMask: [.borderless], backing: .buffered, defer: false)
    overlay.sharingType = .none
    overlay.title = ""
    overlay.backgroundColor = .purple
    overlay.orderFrontRegardless()
    occluder = overlay
}
view.save()
let commandPath = statePath + ".focus"
let timer = Timer.scheduledTimer(withTimeInterval: 0.025, repeats: true) { _ in
    if let command = try? String(contentsOfFile: commandPath, encoding: .utf8) {
        let target = command == "2" ? editorWindow : window
        target?.makeKeyAndOrderFront(nil)
        try? FileManager.default.removeItem(atPath: commandPath)
    }
    view.save()
}
app.run()
