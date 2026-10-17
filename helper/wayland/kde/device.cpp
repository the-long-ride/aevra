// SPDX-License-Identifier: GPL-2.0-or-later
#include "device.h"
#include "policy.h"
#include <chrono>
#include <cursor.h>
#include <input.h>
#include <keyboard_input.h>
#include <wayland/seat.h>
#include <wayland/surface.h>
#include <wayland/textinput.h>
#include <wayland/textinput_v2.h>
#include <wayland/textinput_v3.h>
#include <wayland_server.h>
#include <window.h>
#include <xkb.h>
namespace Aevra {
using namespace KWin;
static auto now() {
  return std::chrono::duration_cast<std::chrono::microseconds>(
      std::chrono::steady_clock::now().time_since_epoch());
}
static void refuse() { throw QString("DESKTOP_INPUT_REFUSED"); }
Device::Device() { input()->addInputDevice(this); }
Device::~Device() {
  release();
  input()->removeInputDevice(this);
}
void Device::sendKey(quint32 code, bool down) {
  Q_EMIT keyChanged(
      code, down ? KeyboardKeyState::Pressed : KeyboardKeyState::Released,
      now(), this);
}
void Device::release() {
  for (auto key : keys) {
    sendKey(key.code, false);
    if (key.shift)
      sendKey(42, false);
  }
  keys.clear();
  if (button) {
    Q_EMIT pointerButtonChanged(0x110, PointerButtonState::Released, now(),
                                this);
    Q_EMIT pointerFrame(this);
  }
  button = false;
}
bool Device::cleanup(const QJsonObject &args) {
  if (args.value("down") != false)
    return false;
  const auto op = args.value("op").toString();
  if (op == "key") {
    auto held = keys.find(args.value("key").toInt());
    if (held != keys.end()) {
      auto key = held.value();
      keys.erase(held);
      sendKey(key.code, false);
      if (key.shift)
        sendKey(42, false);
    }
    return true;
  }
  if (op == "button") {
    if (button)
      Q_EMIT pointerButtonChanged(0x110, PointerButtonState::Released, now(),
                                  this);
    button = false;
    Q_EMIT pointerFrame(this);
    return true;
  }
  return false;
}
void Device::perform(const QJsonObject &args, Window *window) {
  auto seat = waylandServer()->seat();
  const auto op = args.value("op").toString();
  if (op == "key" || op == "text") {
    if (seat->focusedKeyboardSurface() != window->surface())
      refuse();
    auto v2 = seat->textInputV2();
    auto v3 = seat->textInputV3();
    auto protectedPurpose = [](auto purpose) {
      return purpose == TextInputContentPurpose::Password ||
             purpose == TextInputContentPurpose::Pin;
    };
    if ((v2->isEnabled() && protectedPurpose(v2->contentPurpose())) ||
        (v3->isEnabled() && protectedPurpose(v3->contentPurpose())))
      refuse();
    if (op == "text") {
      auto text = args.value("text").toString();
      if (text.toUcs4().size() != 1 || text.contains(QChar(0)))
        refuse();
      if (seat->focusedTextInputSurface() != window->surface())
        refuse();
      if (v3->isEnabled() && v3->surface() == window->surface()) {
        v3->commitString(text);
        v3->done();
      } else if (v2->isEnabled() && v2->surface() == window->surface())
        v2->commitString(text);
      else
        refuse();
    } else {
      auto sym = args.value("key").toInteger();
      if (sym <= 0 || sym > UINT32_MAX || keys.contains(sym))
        refuse();
      auto mapping = input()->keyboard()->xkb()->keycodeFromKeysym(sym);
      if (!mapping || mapping->keyCode == 0 || mapping->level > 1)
        refuse();
      const bool shift =
          mapping->level == 1 &&
          !(input()->keyboard()->xkb()->modifiers() & Qt::ShiftModifier);
      keys.insert(sym, {mapping->keyCode, shift});
      if (shift)
        sendKey(42, true);
      sendKey(mapping->keyCode, true);
    }
  } else {
    auto point = input()->globalPointer();
    if (op == "move")
      point = QPointF(args.value("x").toDouble(qQNaN()),
                      args.value("y").toDouble(qQNaN()));
    const auto r = window->frameGeometry();
    if (op == "move" && !validMovePoint(r.x(), r.y(), r.width(), r.height(),
                                        point.x(), point.y()))
      refuse();
    if (!validPoint(r.x(), r.y(), r.width(), r.height(), point.x(),
                    point.y()) ||
        input()->findToplevel(point) != window)
      refuse();
    if (op == "move")
      Q_EMIT pointerMotionAbsolute(point, now(), this);
    else if (op == "button") {
      button = true;
      Q_EMIT pointerButtonChanged(0x110, PointerButtonState::Pressed, now(),
                                  this);
    } else if (op == "scroll") {
      const auto value = args.value("steps").toDouble(qQNaN());
      if (!std::isfinite(value) || std::floor(value) != value ||
          std::abs(value) > 100)
        refuse();
      Q_EMIT pointerAxisChanged(PointerAxis::Vertical, value * 15,
                                int(value) * 120, PointerAxisSource::Wheel,
                                false, now(), this);
    } else
      refuse();
    Q_EMIT pointerFrame(this);
  }
}
} // namespace Aevra
